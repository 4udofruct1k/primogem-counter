import { describe, expect, it } from 'vitest';
import {
  allowedInScenario,
  forecast,
  oneTimeAccrual,
  type ForecastInput,
  type OneTimeUnit,
} from './forecast';
import { oneTimeUnits } from './onetime';
import { applyStatuses, materialize } from './recurrence';
import { normalizeSeed, type RawSeed } from './regions';
import { noPayments, packFor } from './test/context';
import { seed as seedJson } from './test/fixtures';
import type { Balance, Occurrence, PaymentProfile } from './types';
import { EMPTY_BALANCE } from './wallet';

const NOW = '2026-10-19T05:00:00Z'; // 10:00 UTC+5
const T_0411 = '2026-11-03T22:00:00Z'; // 2026-11-04 03:00 UTC+5
const pullSettings = { countCrystals: true, countStarglitter: false };

function occurrences(extra: { payment?: PaymentProfile; stardustShop?: { if: number; af: number } } = {}) {
  const ctx = packFor('europe', NOW);
  return materialize({
    now: NOW,
    server: 'europe',
    ...ctx,
    payment: extra.payment ?? noPayments,
    newContentVersions: ['7.2'],
    settings: extra.stardustShop ? { stardustShop: extra.stardustShop } : {},
  });
}

function run(partial: Partial<ForecastInput> & { occurrences: Occurrence[] }) {
  return forecast({
    now: NOW,
    target: T_0411,
    scenario: 'expected',
    balance: EMPTY_BALANCE,
    pullSettings,
    payment: noPayments,
    deviceOffset: 5,
    ...partial,
  });
}

const cat = (r: ReturnType<typeof forecast>, c: string) => r.byCategory.find((x) => x.category === c)?.reward;

describe('forecast: сценарии (8.2)', () => {
  it('метки сумм по сценариям', () => {
    expect(allowedInScenario('tally', 'min')).toBe(true);
    expect(allowedInScenario('announced', 'min')).toBe(true);
    expect(allowedInScenario('projected', 'min')).toBe(false);
    expect(allowedInScenario('projected', 'expected')).toBe(true);
    expect(allowedInScenario('leak', 'expected')).toBe(false);
    expect(allowedInScenario('leak', 'max')).toBe(true);
  });

  it('TC-04 в прогнозе: дейлики к 2026-11-04 03:00 UTC+5 — 960', () => {
    const occs = occurrences().filter((o) => o.ruleId === 'daily_commissions');
    const r = run({ occurrences: applyStatuses(occs, [], NOW).occurrences });
    expect(cat(r, 'daily')).toEqual({ primo: 960 });
    expect(r.primo).toBe(960);
  });

  it('TC-09: claimed не попадает в прогноз — без задвоения с балансом', () => {
    const occs = occurrences().filter((o) => o.ruleId === 'daily_commissions');
    const claimed = applyStatuses(
      occs,
      [{ id: 'daily_commissions:2026-10-19', status: 'claimed' }],
      NOW,
    ).occurrences;
    const balance: Balance = { ...EMPTY_BALANCE, primo: 1060 }; // 1000 + 60 из LedgerEntry(claim)
    const r = run({ occurrences: claimed, balance });
    expect(cat(r, 'daily')).toEqual({ primo: 900 });
    expect(r.primo).toBe(1960);
  });

  it('уже доступное, но не отмеченное — в прогнозе, пока срок не вышел (D-101)', () => {
    const occs = applyStatuses(occurrences(), [], NOW).occurrences;
    const r = run({ occurrences: occs });
    const ids = r.contributions.map((c) => c.id);
    expect(ids).toContain('7.1-missive-of-grace:m1');
    expect(r.contributions.find((c) => c.id === '7.1-missive-of-grace:m1')!.at).toBe(NOW);
    expect(ids).not.toContain('daily_commissions:2026-10-18');
  });

  it('TC-12 (D-104): магазин пыли — настройка «2 IF в месяц, AF 0»', () => {
    const T = '2026-12-15T00:00:00Z';
    const set = applyStatuses(occurrences({ stardustShop: { if: 2, af: 0 } }), [], NOW).occurrences;
    const r = run({ occurrences: set, target: T });
    expect(cat(r, 'shop')).toEqual({ if: 6 }); // октябрь (ещё доступен), ноябрь, декабрь
    const byDefault = run({ occurrences: applyStatuses(occurrences(), [], NOW).occurrences, target: T });
    expect(cat(byDefault, 'shop')).toBeUndefined();
  });

  it('TC-13: ивент с primo: null — вклад 0, в unknown[]', () => {
    const r = run({ occurrences: applyStatuses(occurrences(), [], NOW).occurrences });
    const unknownIds = r.unknown.map((u) => u.id);
    expect(unknownIds).toContain('7.1-archon-bonus');
    expect(unknownIds).toContain('7.1-overflowing-favor');
    expect(r.contributions.find((c) => c.id === '7.1-archon-bonus')).toBeUndefined();
  });

  it('Минимум без projected/leak, эндгейм по expectedMin; Максимум — номинал и leak', () => {
    const T = '2027-01-31T00:00:00Z';
    const occs = applyStatuses(occurrences(), [], NOW).occurrences;
    const min = run({ occurrences: occs, target: T, scenario: 'min' });
    const exp = run({ occurrences: occs, target: T, scenario: 'expected' });
    const max = run({ occurrences: occs, target: T, scenario: 'max' });

    const ids = (r: typeof min) => r.contributions.map((c) => c.id);
    expect(ids(min)).not.toContain('events_tpl:7.2');
    expect(ids(exp)).toContain('events_tpl:7.2');
    expect(ids(exp)).not.toContain('trials:7.3:p1');
    expect(ids(max)).toContain('trials:7.3:p1');

    const abyssNov = (r: typeof min) => r.contributions.find((c) => c.id === 'abyss:2026-11')!.reward;
    expect(abyssNov(min)).toEqual({ primo: 600 });
    expect(abyssNov(exp)).toEqual({ primo: 800 });
    expect(abyssNov(max)).toEqual({ primo: 800 });
    const theater = (r: typeof min) => r.contributions.find((c) => c.id === 'theater:2026-11')!.reward;
    expect(theater(min)).toEqual({ primo: 800 });
    expect(theater(max)).toEqual({ primo: 1000 });
    expect(min.primo).toBeLessThan(exp.primo);
    expect(exp.primo).toBeLessThan(max.primo);
  });

  it('трекер: в прогноз идёт ожидание минус уже начисленное прогрессом', () => {
    const occs = applyStatuses(occurrences(), [], NOW).occurrences;
    const r = run({
      occurrences: occs,
      trackerProgress: { 'abyss:2026-10': { primo: 500 } },
      expectations: { abyss: { expected: { primo: 700 }, expectedMin: { primo: 600 } } },
    });
    expect(r.contributions.find((c) => c.id === 'abyss:2026-10')!.reward).toEqual({ primo: 200 });
  });

  it('платное: Минимум — только купленное', () => {
    const payment: PaymentProfile = {
      welkinPurchases: [{ id: 'p1', at: NOW }],
      welkinPlanned: 'keepActive',
      bpPaid: 'everyVersion',
      plannedTopUps: [{ at: '2026-11-01T00:00:00Z', crystal: 980 }],
    };
    const occs = applyStatuses(occurrences({ payment }), [], NOW).occurrences;
    const T = '2027-01-31T00:00:00Z';
    const min = run({ occurrences: occs, payment, target: T, scenario: 'min' });
    const exp = run({ occurrences: occs, payment, target: T, scenario: 'expected' });
    const ids = (r: typeof min) => r.contributions.map((c) => c.id);

    expect(ids(min)).toContain('welkin:p1:d29');
    expect(ids(min)).not.toContain('welkin:v2026-11-17:d0');
    expect(ids(exp)).toContain('welkin:v2026-11-17:d0');
    expect(ids(min)).toContain('bp_paid:7.1');
    expect(ids(min)).not.toContain('bp_paid:7.2');
    expect(ids(exp)).toContain('bp_paid:7.2');
    expect(ids(min)).not.toContain('topup:2026-11-01T00:00:00Z');
    expect(exp.contributions.find((c) => c.id === 'topup:2026-11-01T00:00:00Z')!.reward).toEqual({
      crystal: 980,
    });
  });

  it('итог: крутки, дедлайны, серия по дням', () => {
    const balance: Balance = { ...EMPTY_BALANCE, primo: 5000, crystal: 300, if: 12, af: 20 };
    const r = run({ occurrences: applyStatuses(occurrences(), [], NOW).occurrences, balance });
    expect(r.limitedPulls).toBe(Math.floor((r.primo + r.crystal) / 160) + r.if);
    expect(r.standardPulls).toBe(r.af);
    expect(r.series[0]!.date).toBe('2026-10-19');
    expect(r.series.at(-1)!.date).toBe('2026-11-04');
    expect(r.series.at(-1)!.limitedPulls).toBe(r.limitedPulls);
    for (let i = 1; i < r.series.length; i++) {
      expect(r.series[i]!.limitedPulls).toBeGreaterThanOrEqual(r.series[i - 1]!.limitedPulls);
    }
    const deadlines = r.deadlines.map((d) => d.deadline);
    expect([...deadlines].sort()).toEqual(deadlines);
    expect(r.deadlines.every((d) => d.deadline > NOW && d.deadline <= T_0411)).toBe(true);
  });
});

describe('forecast: разовый контент (11.6)', () => {
  const unit = (
    id: string,
    plan: OneTimeUnit['plan'],
    primo: number,
    extra: Partial<OneTimeUnit> = {},
  ): OneTimeUnit => ({
    id,
    title: id,
    order: 0,
    plan,
    parts: [{ title: id, reward: { primo }, confidence: 'video', unknown: false }],
    ...extra,
  });

  it('Минимум — без разового контента; byDate — к дате плана; none — не прогнозируется', () => {
    const units = [
      unit('a', { kind: 'byDate', at: '2026-10-25T00:00:00Z' }, 500),
      unit('b', { kind: 'none' }, 900),
    ];
    const base = { now: NOW, target: T_0411, weeklyOneTimePrimo: 0 };
    expect(oneTimeAccrual(units, { ...base, scenario: 'min' }).items).toEqual([]);
    expect(oneTimeAccrual(units, { ...base, scenario: 'expected' }).items).toEqual([
      { id: 'onetime:a', title: 'a', at: '2026-10-25T00:00:00Z', reward: { primo: 500 } },
    ]);
    expect(
      oneTimeAccrual(units, { ...base, target: '2026-10-20T00:00:00Z', scenario: 'expected' }).items,
    ).toEqual([]);
    // Максимум — весь остаток с планом сразу
    expect(
      oneTimeAccrual(units, { ...base, target: '2026-10-20T00:00:00Z', scenario: 'max' }).items,
    ).toHaveLength(1);
  });

  it('rate: общий пул списывается по weeklyOneTimePrimo, сначала меньший addedIn', () => {
    const units = [
      unit('new', { kind: 'rate' }, 300, { order: 0, addedIn: '7.0' }),
      unit('old', { kind: 'rate' }, 250, { order: 5 }),
    ];
    const items = oneTimeAccrual(units, {
      now: NOW,
      target: '2026-12-31T00:00:00Z',
      scenario: 'expected',
      weeklyOneTimePrimo: 200,
    }).items;
    expect(items.map((i) => [i.id, i.reward.primo])).toEqual([
      ['onetime:old', 200],
      ['onetime:old', 50],
      ['onetime:new', 150],
      ['onetime:new', 150],
    ]);
    expect(items[0]!.at).toBe('2026-10-26T05:00:00Z');
    expect(
      oneTimeAccrual(units, { now: NOW, target: T_0411, scenario: 'expected', weeklyOneTimePrimo: 0 }).items,
    ).toEqual([]);
  });

  it('leak-категории — только в Максимуме; неизвестные суммы — в «не учтено»', () => {
    const seed = normalizeSeed(seedJson as unknown as RawSeed);
    const ctx = { chestTypes: seed.chestTypes, schedules: seed.schedules };
    const { versions } = packFor('europe', NOW);
    const units = oneTimeUnits(
      seed,
      {},
      {
        snezhnaya_general: {
          areaId: 'snezhnaya_general',
          chests100: false,
          closed: false,
          plan: { kind: 'byDate', at: '2026-10-20T00:00:00Z' },
        },
      },
      {},
      ctx,
      versions,
    );
    const snezh = units.find((u) => u.id === 'snezhnaya_general')!;
    const opts = { now: NOW, target: T_0411, weeklyOneTimePrimo: 0 };
    const exp = oneTimeAccrual([snezh], { ...opts, scenario: 'expected' });
    const max = oneTimeAccrual([snezh], { ...opts, scenario: 'max' });
    // 3 255 + 4 IF + 8 AF доступно сейчас; leak: архонт 7.0 (90 + 2 IF) и местные легенды (180)
    expect(max.items[0]!.reward).toEqual({ primo: 3255, if: 4, af: 8 });
    expect(exp.items[0]!.reward).toEqual({ primo: 3255 - 90 - 180, if: 2, af: 8 });
    expect(exp.unknown.map((u) => u.id)).toContain('snezhnaya_general:side_quests');
  });

  it('область будущей версии попадает в прогноз не раньше старта версии', () => {
    const seed = normalizeSeed(seedJson as unknown as RawSeed);
    const ctx = { chestTypes: seed.chestTypes, schedules: seed.schedules };
    const { versions } = packFor('europe', NOW);
    const units = oneTimeUnits(
      seed,
      {},
      {
        snezhnaya_72: {
          areaId: 'snezhnaya_72',
          chests100: false,
          closed: false,
          plan: { kind: 'byDate', at: '2026-10-20T00:00:00Z' },
        },
      },
      {},
      ctx,
      versions,
    );
    const area72 = units.find((u) => u.id === 'snezhnaya_72')!;
    expect(area72.availableFrom).toBe('2026-11-03T22:00:00Z');
    const r = oneTimeAccrual([area72], {
      now: NOW,
      target: '2026-12-01T00:00:00Z',
      scenario: 'max',
      weeklyOneTimePrimo: 0,
    });
    expect(r.items[0]).toMatchObject({ at: '2026-11-03T22:00:00Z', reward: { primo: 2447 } });
  });

  it('разовый контент входит в итог прогноза', () => {
    const r = run({
      occurrences: [],
      oneTime: [unit('a', { kind: 'byDate', at: '2026-10-25T00:00:00Z' }, 500)],
    });
    expect(cat(r, 'one_time')).toEqual({ primo: 500 });
    expect(r.primo).toBe(500);
  });
});
