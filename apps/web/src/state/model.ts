// Модель клиента: все игровые расчёты по документам пользователя (раздел 2: расчёты только в браузере).
import {
  abyssCyclePrimo,
  applyOverrides,
  applyStatuses,
  currentBalance,
  type CalcContext,
  type Banner,
  type Balance,
  type ChestType,
  forecast,
  type ForecastResult,
  hoyolabPrimo,
  type ISO,
  type LimitedEvent,
  materialize,
  ms,
  newContentVersions,
  normalizeRules,
  normalizeSeed,
  type Occurrence,
  type Override,
  oneTimeUnits,
  type OneTimeUnit,
  type PaymentProfile,
  type Pity,
  resolveBanners,
  resolveEvents,
  resolveVersions,
  type Reward,
  type Scenario,
  type Seed,
  type SourceRule,
  stygianPrimo,
  theaterPrimo,
  trackerExpectation,
  type ExpectationMode,
  type Version,
  versionAt,
  addDays,
  applySeedPatch,
  type PackSeedPatch,
} from '@primo/domain';
import { DEFAULT_SETTINGS, type Settings } from '@primo/shared';
import type { GameData } from '../data/gamedata';
import { areaContext, customizeSeed, orphanProgress } from './seedCustom';
import type { DocsState } from './docs';

export const DEFAULT_PAYMENT: PaymentProfile = {
  welkinPurchases: [],
  welkinPlanned: 'none',
  bpPaid: 'never',
  plannedTopUps: [],
};

export const ZERO_PITY: Pity = {
  char: 0,
  charGuaranteed: false,
  radiance: 0,
  weapon: 0,
  weaponGuaranteed: false,
  weaponFatePoint: 0,
};

/** Глубина истории эндгейма: больше 3 циклов натиска (≈ 3 версии по 42 дня). */
export const TRACKER_HISTORY_DAYS = 200;

export interface Model {
  now: ISO;
  deviceOffset: number;
  settings: Settings;
  payment: PaymentProfile;
  versions: Version[];
  currentVersion: Version | undefined;
  banners: Banner[];
  events: LimitedEvent[];
  rules: SourceRule[];
  seed: Seed;
  calc: CalcContext;
  /** Контекст расчёта области — с ценами сундуков, переопределёнными для неё. */
  ctxForArea: (areaId: string) => CalcContext;
  overrides: Override[];
  /** Прогресс категорий, которых нет в данных, — «устарела». */
  orphans: string[];
  occurrences: Occurrence[];
  /** id вхождений, ставших missed при открытии (I3) — сохраняются в occ_status. */
  autoMissed: string[];
  balance: Balance;
  pity: Pity;
  /** Суммы трекеров по id цикла. */
  trackerSums: Record<string, number>;
  /** Прошедшие циклы эндгейма (бездна, театр, натиск) за TRACKER_HISTORY_DAYS — по времени. */
  trackerHistory: Occurrence[];
  expectations: Record<string, { expected: Reward; expectedMin: Reward }>;
  oneTime: OneTimeUnit[];
}

/** Смещение часового пояса устройства, часы (UI переводит UTC в зону устройства, I1). */
export function deviceOffsetHours(date = new Date()): number {
  return -date.getTimezoneOffset() / 60;
}

export function computeModel(game: GameData, docs: DocsState, now: ISO, deviceOffset: number): Model {
  const settings: Settings = { ...DEFAULT_SETTINGS, ...docs.settings.main };
  const payment: PaymentProfile = docs.payment.main ?? DEFAULT_PAYMENT;
  const overrides = Object.values(docs.override);
  const server = settings.server;
  const pack = game.datapack;

  const versions = resolveVersions(pack.versions, server, { until: addDays(now, 400) });
  const banners = resolveBanners(pack.banners, server);
  const events = resolveEvents(pack.events, server);
  const rules = applyOverrides('rule', normalizeRules(pack.rules), overrides);

  // патчи регионов, уровней и сундуков из пака — поверх seed, пользовательские правки — поверх них (16)
  const baseSeed = normalizeSeed(applySeedPatch(game.seed, pack as PackSeedPatch));
  const userEntities = Object.values(docs.user_entity);
  const seed = customizeSeed(baseSeed, userEntities, overrides);
  const chestTypes = applyOverrides<ChestType>('chestType', seed.chestTypes, overrides);
  const calc: CalcContext = { chestTypes, schedules: seed.schedules };
  const ctxForArea = (areaId: string) => areaContext(calc, areaId, overrides);

  const input = {
    now,
    server,
    versions,
    banners,
    events,
    rules,
    payment,
    newContentVersions: newContentVersions(seed),
    eventTemplate: pack.eventTemplate,
    settings: { claimLagHours: settings.claimLagHours, stardustShop: settings.stardustShop },
  };
  const materialized = materialize(input);
  const { occurrences, autoMissed } = applyStatuses(materialized, docs.occ_status, now);
  // прошедшие циклы эндгейма глубже горизонта вхождений: «среднее за 3 цикла» и «История» (6, 10.5)
  const trackerHistory = materialize({
    ...input,
    rules: rules.filter((r) => r.tracker && r.tracker !== 'hoyolab'),
    horizon: { from: addDays(now, -TRACKER_HISTORY_DAYS), to: now },
  })
    .filter((o) => o.deadline && ms(o.deadline) <= ms(now))
    .sort((a, b) => ms(a.from) - ms(b.from));

  const snapshots = Object.values(docs.wallet_snapshot);
  const wallet = currentBalance(snapshots, Object.values(docs.ledger));
  const { at: _at, pity, ...balance } = wallet;

  const known = new Set(occurrences.map((o) => o.id));
  const trackerSums = computeTrackerSums(
    [...trackerHistory.filter((o) => !known.has(o.id)), ...occurrences],
    docs,
    seed,
  );
  const expectations: Model['expectations'] = {};
  for (const rule of rules) {
    if (!rule.tracker || rule.tracker === 'hoyolab') continue;
    const history = trackerHistory
      .filter((o) => o.ruleId === rule.id && o.id in trackerSums)
      .map((o) => trackerSums[o.id]!);
    const mode = (settings.expectations[rule.id] as ExpectationMode | undefined) ?? { mode: 'pack' };
    expectations[rule.id] = trackerExpectation(rule, mode, history);
  }

  const oneTime = oneTimeUnits(
    seed,
    docs.cat_progress,
    docs.area_state,
    docs.region_state,
    calc,
    versions,
    ctxForArea,
  );
  const orphans = orphanProgress(customizeSeed(baseSeed, userEntities, []), Object.keys(docs.cat_progress));

  return {
    now,
    deviceOffset,
    settings,
    payment,
    versions,
    currentVersion: versionAt(versions, now),
    banners,
    events,
    rules,
    seed,
    calc,
    ctxForArea,
    overrides,
    orphans,
    occurrences,
    autoMissed,
    balance,
    pity: pity ?? ZERO_PITY,
    trackerSums,
    trackerHistory,
    expectations,
    oneTime,
  };
}

/** Сумма трекера цикла (раздел 12): id цикла = id вхождения правила. */
export function computeTrackerSums(
  occurrences: Occurrence[],
  docs: DocsState,
  seed: Seed,
): Record<string, number> {
  const sums: Record<string, number> = {};
  for (const o of occurrences) {
    if (!o.tracker) continue;
    switch (o.tracker) {
      case 'abyss': {
        const d = docs.abyss[o.id];
        if (d) sums[o.id] = abyssCyclePrimo(d, seed.endgame);
        break;
      }
      case 'theater': {
        const d = docs.theater[o.id];
        if (d) sums[o.id] = theaterPrimo(d, seed.endgame);
        break;
      }
      case 'stygian': {
        const d = docs.stygian[o.id];
        if (d) sums[o.id] = stygianPrimo(d.maxDifficulty, seed.endgame);
        break;
      }
      case 'hoyolab': {
        const d = docs.hoyolab[o.id];
        if (d) sums[o.id] = hoyolabPrimo(d.checkIns);
        break;
      }
    }
  }
  return sums;
}

export function runForecast(
  model: Model,
  target: ISO,
  scenario: Scenario = model.settings.scenario,
): ForecastResult {
  const trackerProgress: Record<string, Reward> = {};
  for (const [id, primo] of Object.entries(model.trackerSums)) trackerProgress[id] = { primo };
  return forecast({
    now: model.now,
    target,
    scenario,
    balance: model.balance,
    occurrences: model.occurrences,
    pullSettings: model.settings,
    payment: model.payment,
    trackerProgress,
    expectations: model.expectations,
    oneTime: model.oneTime,
    weeklyOneTimePrimo: model.settings.weeklyOneTimePrimo,
    deviceOffset: model.deviceOffset,
  });
}
