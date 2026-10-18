// Прогноз к дате по трём сценариям (раздел 8) и учёт разового контента (11.6).
import { claimAt, confidenceRank, isClaimableBy } from './recurrence';
import { addRewards, hasNull, isZero, subtractClamped } from './reward';
import { addDays, dateInOffset, fromMs, ms } from './time';
import type {
  AreaPlan,
  Balance,
  Category,
  Confidence,
  ISO,
  Occurrence,
  PaymentProfile,
  Reward,
} from './types';
import { versionIdOf } from './versions';
import { applyReward, limitedPulls, type PullSettings, standardPulls } from './wallet';

export type Scenario = 'min' | 'expected' | 'max';

/**
 * Метки сумм по сценариям (8.2): Минимум — без projected / leak; Ожидаемо — + projected; Максимум — + leak.
 * `unknown` проходит везде: его суммы null → 0 и попадают в «не учтено» (I5).
 */
export function allowedInScenario(c: Confidence, s: Scenario): boolean {
  if (c === 'unknown') return true;
  const rank = confidenceRank(c);
  return s === 'min' ? rank === 0 : s === 'expected' ? rank <= 1 : rank <= 2;
}

// ── разовый контент ────────────────────────────────────────────────────────

export interface OneTimePart {
  title: string;
  /** Остаток «доступно сейчас» категории (remainingNow). */
  reward: Reward;
  confidence: Confidence;
  unknown: boolean;
  id?: string;
}

/** Область или общий источник с планом прохождения (AreaState.plan). */
export interface OneTimeUnit {
  id: string;
  title: string;
  /** Порядок регионов и областей — для темпа `rate`. */
  order: number;
  addedIn?: string;
  /** Старт версии, в которой появилась область: раньше прогнозировать нельзя. */
  availableFrom?: ISO;
  plan: AreaPlan;
  parts: OneTimePart[];
}

export interface AccrualItem {
  id: string;
  title: string;
  at: ISO;
  reward: Reward;
}

export interface UnknownItem {
  id: string;
  title: string;
}

const WEEK_MS = 7 * 86_400_000;

export function oneTimeAccrual(
  units: OneTimeUnit[],
  o: { now: ISO; target: ISO; scenario: Scenario; weeklyOneTimePrimo: number },
): { items: AccrualItem[]; unknown: UnknownItem[] } {
  const items: AccrualItem[] = [];
  const unknown: UnknownItem[] = [];
  if (o.scenario === 'min') return { items, unknown };
  const T = ms(o.target);
  const rateQueue: { unit: OneTimeUnit; reward: Reward; start: number }[] = [];

  for (const u of units) {
    if (u.plan.kind === 'none') continue;
    const parts = u.parts.filter((p) => allowedInScenario(p.confidence, o.scenario));
    for (const p of parts) if (p.unknown) unknown.push({ id: p.id ?? u.id, title: p.title });
    const reward = addRewards(...parts.map((p) => p.reward));
    if (isZero(reward)) continue;
    const start = Math.max(ms(o.now), u.availableFrom ? ms(u.availableFrom) : -Infinity);

    if (o.scenario === 'max') {
      // «весь остаток с планом» — сразу, как только область доступна
      if (start <= T) items.push(item(u, start, reward));
    } else if (u.plan.kind === 'byDate') {
      const at = Math.max(ms(u.plan.at), start);
      if (at <= T) items.push(item(u, at, reward));
    } else {
      rateQueue.push({ unit: u, reward, start });
    }
  }

  if (o.scenario === 'expected' && o.weeklyOneTimePrimo > 0) {
    items.push(...drainAtRate(rateQueue, ms(o.now), T, o.weeklyOneTimePrimo));
  }
  items.sort((a, b) => ms(a.at) - ms(b.at));
  return { items, unknown };
}

function item(u: OneTimeUnit, at: number, reward: Reward): AccrualItem {
  return { id: `onetime:${u.id}`, title: u.title, at: fromMs(at), reward };
}

/** Темп `rate`: общий пул списывается weeklyOneTimePrimo в неделю — сначала меньший addedIn, затем по порядку. */
function drainAtRate(
  queue: { unit: OneTimeUnit; reward: Reward; start: number }[],
  now: number,
  T: number,
  weekly: number,
): AccrualItem[] {
  const sorted = [...queue].sort(
    (a, b) => compareVersions(a.unit.addedIn, b.unit.addedIn) || a.unit.order - b.unit.order,
  );
  const perMs = weekly / WEEK_MS;
  const out: AccrualItem[] = [];
  let t = now; // время, до которого пул уже выработан
  let weekEnd = now + WEEK_MS;
  let weekBudget = weekly;

  for (const { unit, reward, start } of sorted) {
    if (start > t) {
      t = start;
      weekEnd = t + WEEK_MS;
      weekBudget = weekly;
    }
    let left = reward.primo ?? 0;
    while (left > 0) {
      if (t > T) return out;
      const take = Math.min(left, weekBudget);
      left -= take;
      weekBudget -= take;
      if (left > 0 || weekBudget === 0) {
        // неделя исчерпана — начисление в конце недели
        t = weekEnd;
        if (t <= T) out.push(item(unit, t, { primo: take }));
        weekEnd += WEEK_MS;
        weekBudget = weekly;
      } else {
        // область закончилась посреди недели
        t = weekEnd - weekBudget / perMs;
        if (t <= T) out.push(item(unit, t, { primo: take }));
      }
    }
    const rest = addRewards(reward, { primo: -(reward.primo ?? 0) });
    if (!isZero(rest) && t <= T) out.push(item(unit, Math.max(t, start), rest));
  }
  return out;
}

function compareVersions(a?: string, b?: string): number {
  const key = (v?: string) => (v ? versionIdOf(v).split('.').map(Number) : [0, 0]);
  const [a1 = 0, a2 = 0] = key(a);
  const [b1 = 0, b2 = 0] = key(b);
  return a1 - b1 || a2 - b2;
}

// ── прогноз ────────────────────────────────────────────────────────────────

export interface ForecastInput {
  now: ISO;
  target: ISO;
  scenario: Scenario;
  balance: Balance;
  /** Вхождения с наложенными статусами (applyStatuses). */
  occurrences: Occurrence[];
  pullSettings: PullSettings;
  payment: PaymentProfile;
  /** Суммы трекеров по id цикла, уже начисленные прогрессом (5.1). */
  trackerProgress?: Record<string, Reward>;
  /** Ожидания трекерных источников по id правила (настройки, раздел 6). */
  expectations?: Record<string, { expected: Reward; expectedMin: Reward }>;
  oneTime?: OneTimeUnit[];
  weeklyOneTimePrimo?: number;
  /** Смещение часового пояса устройства (часы) — границы дней серии. */
  deviceOffset?: number;
}

export interface Contribution {
  id: string;
  title: string;
  category: Category;
  at: ISO;
  reward: Reward;
}

export interface ForecastResult extends Balance {
  limitedPulls: number;
  standardPulls: number;
  byCategory: { category: Category; reward: Reward }[];
  unknown: UnknownItem[];
  deadlines: { id: string; title: string; deadline: ISO; reward: Reward }[];
  series: { date: string; limitedPulls: number; standardPulls: number }[];
  contributions: Contribution[];
}

export function forecast(input: ForecastInput): ForecastResult {
  const { now, target, scenario } = input;
  const contributions: Contribution[] = [];
  const unknown: UnknownItem[] = [];
  const deadlines: ForecastResult['deadlines'] = [];

  for (const o of input.occurrences) {
    if (o.status === 'planned' && o.deadline && ms(o.deadline) > ms(now) && ms(o.deadline) <= ms(target)) {
      deadlines.push({ id: o.id, title: o.title, deadline: o.deadline, reward: o.reward });
    }
    if (!isClaimableBy(o, now, target)) continue;
    const value = occurrenceValue(o, input);
    if (value === null) continue;
    if (hasNull(value)) unknown.push({ id: o.id, title: o.title });
    if (isZero(value)) continue;
    contributions.push({
      id: o.id,
      title: o.title,
      category: o.category,
      at: claimAt(o, now),
      reward: addRewards(value),
    });
  }

  if (scenario !== 'min') {
    for (const t of input.payment.plannedTopUps) {
      if (ms(t.at) > ms(now) && ms(t.at) <= ms(target)) {
        contributions.push({
          id: `topup:${t.at}`,
          title: 'Пополнение',
          category: 'paid',
          at: t.at,
          reward: { crystal: t.crystal },
        });
      }
    }
  }

  if (input.oneTime?.length) {
    const acc = oneTimeAccrual(input.oneTime, {
      now,
      target,
      scenario,
      weeklyOneTimePrimo: input.weeklyOneTimePrimo ?? 0,
    });
    for (const i of acc.items) contributions.push({ ...i, category: 'one_time' });
    unknown.push(...acc.unknown);
  }

  contributions.sort((a, b) => ms(a.at) - ms(b.at));
  deadlines.sort((a, b) => ms(a.deadline) - ms(b.deadline));

  const total = contributions.reduce((b, c) => applyReward(b, c.reward), { ...input.balance });
  return {
    ...total,
    limitedPulls: limitedPulls(total, input.pullSettings),
    standardPulls: standardPulls(total),
    byCategory: groupByCategory(contributions),
    unknown,
    deadlines,
    series: dailySeries(input, contributions),
    contributions,
  };
}

/** Сумма вхождения в сценарии; null — вхождение в сценарий не входит. */
function occurrenceValue(o: Occurrence, input: ForecastInput): Reward | null {
  const { scenario, now } = input;
  if (!allowedInScenario(o.confidence, scenario)) return null;
  if (o.paid && scenario === 'min') {
    // Минимум — только купленное: реальные покупки луны и БП уже начавшихся версий
    if (o.virtual) return null;
    if (o.ruleId === 'bp_paid' && ms(o.from) > ms(now)) return null;
  }
  if (o.tracker && o.ruleId) {
    const exp = input.expectations?.[o.ruleId];
    const base =
      scenario === 'min'
        ? (exp?.expectedMin ?? o.expectedMin ?? o.expected)
        : scenario === 'expected'
          ? (exp?.expected ?? o.expected)
          : o.reward;
    return subtractClamped(base, input.trackerProgress?.[o.id]);
  }
  return o.actual ?? o.reward;
}

function groupByCategory(contributions: Contribution[]): ForecastResult['byCategory'] {
  const map = new Map<Category, Reward>();
  for (const c of contributions) map.set(c.category, addRewards(map.get(c.category), c.reward));
  return [...map].map(([category, reward]) => ({ category, reward }));
}

function dailySeries(input: ForecastInput, contributions: Contribution[]): ForecastResult['series'] {
  const offset = input.deviceOffset ?? 0;
  const out: ForecastResult['series'] = [];
  const lastDate = dateInOffset(input.target, offset);
  let balance = { ...input.balance };
  let i = 0;
  for (let date = dateInOffset(input.now, offset); date <= lastDate;) {
    const nextDate = dateInOffset(addDays(`${date}T00:00:00Z`, 1), 0);
    const dayEnd = Math.min(ms(`${nextDate}T00:00:00Z`) - offset * 3_600_000, ms(input.target));
    while (i < contributions.length && ms(contributions[i]!.at) <= dayEnd) {
      balance = applyReward(balance, contributions[i]!.reward);
      i++;
    }
    out.push({
      date,
      limitedPulls: limitedPulls(balance, input.pullSettings),
      standardPulls: standardPulls(balance),
    });
    date = nextDate;
  }
  return out;
}
