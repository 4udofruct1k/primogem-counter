// Точный расчёт (без Монте-Карло): тесты модели и таблицы UI (13.2.2, 13.2.3, 13.3).
// Число круток между 5★ не зависит от того, кто выпал, поэтому распределение «круток до цели» =
// Σ_k P(понадобилось k пятизвёздочных) × (круток до первой 5★) ⊛ (круток между 5★)^(k − 1).
import type { Pity } from '../types';
import { FATE_POINT_MAX, featuredWinChance, RADIANCE_SAFETY, rampChance, weaponStandardShare } from './model';
import type { FiftyFifty, GachaModel, Ramp } from './types';

/** Масса, ниже которой цепочка исходов считается исчерпанной (только у «1.x» без потолка). */
const EVENTS_EPS = 1e-15;
const MAX_EVENTS = 10_000;
/** Предел распределения круток, если худший случай не ограничен («1.x»). */
export const EXACT_MAX_PULLS = 3000;

/** pmf[k] = P(следующая 5★ ровно на k-й крутке от текущего pity); pmf[0] = 0. */
export function fiveStarPmf(ramp: Ramp, pity = 0): number[] {
  const pmf = [0];
  let survive = 1;
  for (let n = pity + 1; ; n++) {
    const p = rampChance(ramp, n);
    pmf.push(survive * p);
    survive *= 1 - p;
    if (p >= 1) return pmf;
  }
}

/** Σ k × pmf[k]. */
export function meanOf(pmf: readonly number[]): number {
  let s = 0;
  for (let k = 1; k < pmf.length; k++) s += k * pmf[k];
  return s;
}

/** Среднее число круток до следующей 5★ (или 4★ — для рампы 4★). */
export function expectedPulls(ramp: Ramp, pity = 0): number {
  return meanOf(fiveStarPmf(ramp, pity));
}

/** Сводная вероятность с учётом гарантов = 1 / E[круток] при нулевом pity (доля, не %). */
export function consolidatedRate(ramp: Ramp): number {
  return 1 / expectedPulls(ramp);
}

export interface PullChanceRow {
  /** Номер крутки с последней 5★. */
  pull: number;
  /** Шанс на этой крутке, если до неё 5★ не было. */
  chance: number;
  /** «5★ к этой крутке» — не позже неё, от текущего pity. */
  cumulative: number;
}

/** Таблица 13.2.3 для любой рампы и текущего pity. */
export function pullChanceTable(ramp: Ramp, pity = 0): PullChanceRow[] {
  const rows: PullChanceRow[] = [];
  let survive = 1;
  for (let n = pity + 1; ; n++) {
    const chance = rampChance(ramp, n);
    survive *= 1 - chance;
    rows.push({ pull: n, chance, cumulative: 1 - survive });
    if (chance >= 1) return rows;
  }
}

/** Доля выигранных 50/50 в долгую — стационарное распределение счётчика сияния (TC-32). */
export function longRunWinRate(ff: FiftyFifty): number {
  const w = featuredWinChance(ff);
  if (ff === 'classic') return w;
  // π_c ∝ (1 − w)^c, c = 0…3; из состояния 3 — «Захват сияния», это выигрыш.
  let norm = 0;
  let wins = 0;
  for (let c = 0, pi = 1; c <= RADIANCE_SAFETY; c++, pi *= 1 - w) {
    norm += pi;
    wins += c < RADIANCE_SAFETY ? pi * w : pi;
  }
  return wins / norm;
}

// ── цепочки исходов 5★ ────────────────────────────────────────────────────

/** Переход цепочки: вероятность, следующее состояние, получена ли нужная копия. */
type Step = readonly [p: number, next: number, hit: boolean];

/** q[k] = P(для `copies` копий понадобилось ровно k пятизвёздочных); rest — масса за пределом. */
function eventsPmf(steps: readonly Step[][], start: number, copies: number): { q: number[]; rest: number } {
  const S = steps.length;
  let dist = new Float64Array(copies * S); // [копий уже есть][состояние]
  dist[start] = 1;
  const q = [0];
  let rest = 1;
  for (let k = 1; k <= MAX_EVENTS && rest > EVENTS_EPS; k++) {
    const next = new Float64Array(copies * S);
    let done = 0;
    for (let i = 0; i < dist.length; i++) {
      const m = dist[i];
      if (m === 0) continue;
      const got = Math.floor(i / S);
      for (const [p, s, hit] of steps[i % S]) {
        if (!hit) next[got * S + s] += m * p;
        else if (got + 1 === copies) done += m * p;
        else next[(got + 1) * S + s] += m * p;
      }
    }
    q.push(done);
    dist = next;
    rest = next.reduce((a, v) => a + v, 0);
  }
  return { q, rest };
}

/** Переходы персонажа из состояния s = гарант × 4 + счётчик сияния (13.3.1). */
function charStep(ff: FiftyFifty, s: number): Step[] {
  const w = featuredWinChance(ff);
  const c = s % 4;
  if (s >= 4) return [[1, c, true]]; // гарант: счётчик не меняется
  if (ff === 'classic')
    return [
      [w, 0, true],
      [1 - w, 4, false],
    ];
  if (c >= RADIANCE_SAFETY) return [[1, 0, true]]; // «Захват сияния»
  return [
    [w, 0, true],
    [1 - w, 4 + c + 1, false],
  ];
}

/** Переходы оружия из состояния s = гарант75 × (max + 1) + очки судьбы (13.3.3). */
function weaponStep(m: GachaModel, s: number): Step[] {
  const max = FATE_POINT_MAX[m.epitomized];
  const P = max + 1;
  const pt = s % P;
  const miss = max > 0 ? pt + 1 : 0; // очко за не выбранное
  if (max > 0 && pt >= max) return [[1, 0, true]];
  if (s >= P) {
    const chosen = m.weaponChosen / (m.weaponChosen + m.weaponOtherFeatured);
    return [
      [chosen, 0, true],
      [1 - chosen, miss, false],
    ];
  }
  return [
    [m.weaponChosen, 0, true],
    [m.weaponOtherFeatured, miss, false],
    [weaponStandardShare(m), P + miss, false],
  ];
}

function charChain(ff: FiftyFifty, guaranteed: boolean, radiance: number, copies: number) {
  const c = ff === 'radiance' ? Math.min(Math.max(radiance, 0), RADIANCE_SAFETY) : 0;
  const steps = Array.from({ length: 8 }, (_, s) => charStep(ff, s));
  return eventsPmf(steps, (guaranteed ? 4 : 0) + c, copies);
}

function weaponChain(m: GachaModel, guaranteed: boolean, fatePoint: number, copies: number) {
  const max = FATE_POINT_MAX[m.epitomized];
  const pt = max > 0 ? Math.min(Math.max(fatePoint, 0), max) : 0;
  const steps = Array.from({ length: 2 * (max + 1) }, (_, s) => weaponStep(m, s));
  return eventsPmf(steps, (guaranteed ? max + 1 : 0) + pt, copies);
}

/** P(для `copies` ивентовых персонажей понадобилось ровно k пятизвёздочных). */
export function charEventsPmf(
  ff: FiftyFifty,
  start: { guaranteed: boolean; radiance: number },
  copies: number,
): number[] {
  return charChain(ff, start.guaranteed, start.radiance, copies).q;
}

/** P(для `copies` выбранных оружий понадобилось ровно k пятизвёздочных). */
export function weaponEventsPmf(
  m: GachaModel,
  start: { guaranteed: boolean; fatePoint: number },
  copies: number,
): number[] {
  return weaponChain(m, start.guaranteed, start.fatePoint, copies).q;
}

// ── распределение круток до цели ──────────────────────────────────────────

export interface ExactDist {
  /** pmf[n] = P(цель ровно на n-й крутке); длина не больше maxPulls + 1. */
  pmf: number[];
  /** Среднее без обрезки (по тождеству Вальда). */
  mean: number;
  /** Худший случай; null — не ограничен («1.x»). */
  worstCase: number | null;
  /** Масса за пределом maxPulls (и хвост цепочки исходов). */
  truncated: number;
}

function combine(first: number[], base: number[], q: number[], rest: number, maxPulls?: number): ExactDist {
  const kmax = q.length - 1;
  const worstCase = rest === 0 ? first.length - 1 + (kmax - 1) * (base.length - 1) : null;
  const limit = maxPulls ?? worstCase ?? EXACT_MAX_PULLS;
  const pmf = new Array<number>(limit + 1).fill(0);
  let sum = first.slice(0, limit + 1); // распределение суммы k промежутков
  for (let k = 1; k <= kmax; k++) {
    if (q[k] > 0) for (let n = k; n < sum.length; n++) pmf[n] += q[k] * sum[n];
    if (k === kmax) break;
    const next = new Array<number>(Math.min(sum.length + base.length - 1, limit + 1)).fill(0);
    for (let i = k; i < sum.length; i++) {
      const a = sum[i];
      if (a === 0) continue;
      for (let j = 1; j < base.length && i + j <= limit; j++) next[i + j] += a * base[j];
    }
    sum = next;
  }
  const e1 = meanOf(first);
  const e0 = meanOf(base);
  let mean = 0;
  for (let k = 1; k <= kmax; k++) mean += q[k] * (e1 + (k - 1) * e0);
  const total = pmf.reduce((a, v) => a + v, 0);
  return { pmf, mean, worstCase, truncated: Math.max(0, 1 - total) };
}

/** Круток до `copies` ивентовых 5★ персонажа (C0 = 1 копия) из текущего Pity. */
export function charCopiesDist(m: GachaModel, pity: Pity, copies: number, maxPulls?: number): ExactDist {
  const { q, rest } = charChain(m.fiftyFifty, pity.charGuaranteed, pity.radiance, copies);
  const first = fiveStarPmf(m.char5, Math.min(pity.char, m.char5.hard - 1));
  return combine(first, fiveStarPmf(m.char5), q, rest, maxPulls);
}

/** Круток до `copies` выбранного 5★ оружия (R1 = 1 копия) из текущего Pity. */
export function weaponCopiesDist(m: GachaModel, pity: Pity, copies: number, maxPulls?: number): ExactDist {
  const { q, rest } = weaponChain(m, pity.weaponGuaranteed, pity.weaponFatePoint, copies);
  const first = fiveStarPmf(m.weapon5, Math.min(pity.weapon, m.weapon5.hard - 1));
  return combine(first, fiveStarPmf(m.weapon5), q, rest, maxPulls);
}

/** P(цель не позже n-й крутки). */
export function cdfAt(d: ExactDist, n: number): number {
  let s = 0;
  for (let i = 0; i <= n && i < d.pmf.length; i++) s += d.pmf[i];
  return s;
}
