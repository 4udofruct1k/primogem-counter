// Сводка симулятора (13.5). Накопитель складывается из пакетов в любом порядке —
// воркеры шлют промежуточные итоги каждые 10%, а итог не зависит от числа воркеров.
import { milestoneLabels } from './run';
import type { CountKey, CountShare, PullStats, RunResult, SimInput, SimSummary } from './types';

/** Подпись исхода, когда цель первого баннера не выпала ни разу. */
export const NOTHING_LABEL = 'не выпал';

const COUNT_KEYS: readonly CountKey[] = [
  'char5Featured',
  'char5Std',
  'w5Chosen',
  'w5Other',
  'w5Std',
  'fours',
];
const CHAR_KEYS: readonly CountKey[] = ['char5Featured', 'char5Std'];
const WEAPON_KEYS: readonly CountKey[] = ['w5Chosen', 'w5Other', 'w5Std'];
/** Ключ сочетания: (cons + 1) × 6 + refs, cons −1…6, refs 0…5. */
const COMBO_STRIDE = 6;

/** Накопитель — простые данные (structured clone для postMessage). */
export interface SimTotals {
  runs: number;
  /** По вехам: гистограмма «на какой крутке достигнута» (индекс — номер крутки). */
  milestones: number[][];
  /** Итоговые сочетания по ключу (cons + 1) × 6 + refs. */
  combos: number[];
  /** Распределения счётчиков за прогон (индекс — k). */
  counts: Record<CountKey, number[]>;
  won5050: number;
  lost5050: number;
}

function bump(h: number[], v: number, by = 1): void {
  while (h.length <= v) h.push(0);
  h[v] += by;
}

function addHist(a: number[], b: readonly number[]): number[] {
  const out = a.slice();
  for (let v = 0; v < b.length; v++) if (b[v]) bump(out, v, b[v]);
  return out;
}

export function createTotals(input: SimInput): SimTotals {
  const counts = {} as Record<CountKey, number[]>;
  for (const k of COUNT_KEYS) counts[k] = [];
  return {
    runs: 0,
    milestones: milestoneLabels(input).map(() => []),
    combos: [],
    counts,
    won5050: 0,
    lost5050: 0,
  };
}

/** Добавляет прогоны в накопитель (меняет его) и возвращает его же. */
export function addResults(t: SimTotals, results: readonly RunResult[]): SimTotals {
  for (const r of results) {
    t.runs++;
    for (let j = 0; j < t.milestones.length; j++) {
      const at = r.reachedAt[j];
      if (at != null) bump(t.milestones[j], at);
    }
    bump(t.combos, (r.cons + 1) * COMBO_STRIDE + r.refs);
    for (const k of COUNT_KEYS) bump(t.counts[k], r[k]);
    t.won5050 += r.won5050;
    t.lost5050 += r.lost5050;
  }
  return t;
}

/** Сумма двух накопителей одного ввода (новый объект). */
export function mergeTotals(a: SimTotals, b: SimTotals): SimTotals {
  const counts = {} as Record<CountKey, number[]>;
  for (const k of COUNT_KEYS) counts[k] = addHist(a.counts[k], b.counts[k]);
  return {
    runs: a.runs + b.runs,
    milestones: a.milestones.map((h, j) => addHist(h, b.milestones[j] ?? [])),
    combos: addHist(a.combos, b.combos),
    counts,
    won5050: a.won5050 + b.won5050,
    lost5050: a.lost5050 + b.lost5050,
  };
}

/** Значение с рангом r (0…n − 1) в отсортированной выборке, заданной гистограммой. */
function valueAtRank(h: readonly number[], r: number): number {
  let seen = 0;
  for (let v = 0; v < h.length; v++) {
    seen += h[v];
    if (seen > r) return v;
  }
  return h.length - 1;
}

/** Квантиль с линейной интерполяцией между рангами (как numpy / R type 7). */
function quantile(h: readonly number[], n: number, q: number): number {
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const a = valueAtRank(h, lo);
  return pos === lo ? a : a + (pos - lo) * (valueAtRank(h, lo + 1) - a);
}

function pullStats(h: readonly number[]): PullStats | null {
  let n = 0;
  let sum = 0;
  for (let v = 0; v < h.length; v++) {
    n += h[v];
    sum += v * h[v];
  }
  if (n === 0) return null;
  return { mean: sum / n, median: quantile(h, n, 0.5), p10: quantile(h, n, 0.1), p90: quantile(h, n, 0.9) };
}

function comboLabel(mode: SimInput['mode'], key: number): string {
  const cons = Math.floor(key / COMBO_STRIDE) - 1;
  const refs = key % COMBO_STRIDE;
  if (mode === 'weapon_only') return refs > 0 ? `R${refs}` : NOTHING_LABEL;
  if (cons < 0) return NOTHING_LABEL;
  return mode === 'char_only' ? `C${cons}` : `C${cons} + R${refs}`;
}

/** Среднее по распределению «k штук — % прогонов». */
export function distMean(d: readonly CountShare[]): number {
  return d.reduce((s, x) => s + (x.k * x.pct) / 100, 0);
}

export function finishTotals(t: SimTotals, input: SimInput): SimSummary {
  const pct = (count: number) => (t.runs > 0 ? (count / t.runs) * 100 : 0);
  const labels = milestoneLabels(input);

  const results = labels.map((label, j) => {
    const h = t.milestones[j];
    return { label, pct: pct(h.reduce((s, v) => s + v, 0)), pulls: pullStats(h) };
  });

  // По убыванию; при равенстве — лучший исход выше.
  const combos = t.combos
    .map((count, key) => ({ key, count }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || b.key - a.key)
    .map((c) => ({ label: comboLabel(input.mode, c.key), pct: pct(c.count) }));

  const keys: CountKey[] = [
    ...(input.mode !== 'weapon_only' ? CHAR_KEYS : []),
    ...(input.mode !== 'char_only' ? WEAPON_KEYS : []),
    'fours',
  ];
  const countDists: SimSummary['countDists'] = {};
  for (const k of keys) {
    countDists[k] = t.counts[k].flatMap((count, v) => (count > 0 ? [{ k: v, pct: pct(count) }] : []));
  }

  const n5050 = t.won5050 + t.lost5050;
  const summary: SimSummary = {
    results,
    combos,
    countDists,
    winRate5050: n5050 > 0 ? (t.won5050 / n5050) * 100 : null,
    meta: {
      runs: t.runs,
      seed: input.seed,
      softPreset: input.model.softPreset,
      epitomized: input.model.epitomized,
      fiftyFifty: input.model.fiftyFifty,
    },
  };

  // «Моя удача»: доля дошедших до результата, которым понадобилось больше круток (13.5, п. 4).
  const j = input.luck ? labels.indexOf(input.luck.result) : -1;
  if (input.luck && j >= 0) {
    const h = t.milestones[j];
    let reached = 0;
    let worse = 0;
    for (let v = 0; v < h.length; v++) {
      reached += h[v];
      if (v > input.luck.pulls) worse += h[v];
    }
    if (reached > 0) summary.luckPercentile = (worse / reached) * 100;
  }
  return summary;
}

/** Сводка по готовому массиву прогонов. */
export function summarize(input: SimInput, results: readonly RunResult[]): SimSummary {
  return finishTotals(addResults(createTotals(input), results), input);
}
