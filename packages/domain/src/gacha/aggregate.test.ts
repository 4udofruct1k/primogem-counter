import { describe, expect, it } from 'vitest';
import {
  addResults,
  createTotals,
  distMean,
  finishTotals,
  mergeTotals,
  summarize,
  NOTHING_LABEL,
} from './aggregate';
import { cdfAt, charCopiesDist, weaponCopiesDist } from './exact';
import { makeModel } from './model';
import { runBatch, splitRuns } from './run';
import { pity, simInput } from './test/input';
import type { RunResult, SimInput, SimSummary } from './types';

const run = (p: Partial<RunResult>): RunResult => ({
  cons: -1,
  refs: 0,
  reachedAt: [],
  char5Featured: 0,
  char5Std: 0,
  w5Chosen: 0,
  w5Other: 0,
  w5Std: 0,
  fours: 0,
  used: 0,
  won5050: 0,
  lost5050: 0,
  ...p,
});

const sumPct = (rows: { pct: number }[]) => rows.reduce((s, r) => s + r.pct, 0);

function expectMonotone(s: SimSummary) {
  for (let i = 1; i < s.results.length; i++) {
    expect(s.results[i].pct).toBeLessThanOrEqual(s.results[i - 1].pct);
  }
  expect(sumPct(s.combos)).toBeCloseTo(100, 9);
}

describe('gacha/aggregate: сводка по готовым прогонам (13.5)', () => {
  const input = simInput({ consTarget: 1, runs: 100, luck: { result: 'C0', pulls: 15 } });
  const results = [
    run({ cons: 0, reachedAt: [10, null], char5Featured: 1, fours: 3, won5050: 1 }),
    run({ cons: 1, reachedAt: [20, 50], char5Featured: 2, char5Std: 1, fours: 7, won5050: 1, lost5050: 1 }),
    run({ cons: -1, reachedAt: [null, null], char5Std: 1, fours: 2, lost5050: 1 }),
    run({ cons: 1, reachedAt: [30, 60], char5Featured: 2, fours: 7, won5050: 2 }),
  ];
  const s = summarize(input, results);

  it('главная таблица: % дошедших и круток у дошедших (среднее, медиана, p10, p90)', () => {
    expect(s.results).toEqual([
      { label: 'C0', pct: 75, pulls: { mean: 20, median: 20, p10: 12, p90: 28 } },
      { label: 'C1', pct: 50, pulls: { mean: 55, median: 55, p10: 51, p90: 59 } },
    ]);
  });

  it('итоговые сочетания по убыванию, «не выпал», в сумме 100%', () => {
    expect(s.combos).toEqual([
      { label: 'C1', pct: 50 },
      { label: 'C0', pct: 25 },
      { label: NOTHING_LABEL, pct: 25 },
    ]);
  });

  it('ивентовые / стандартные, 4★, доля 50/50, «моя удача»', () => {
    expect(s.countDists).toEqual({
      char5Featured: [
        { k: 0, pct: 25 },
        { k: 1, pct: 25 },
        { k: 2, pct: 50 },
      ],
      char5Std: [
        { k: 0, pct: 50 },
        { k: 1, pct: 50 },
      ],
      fours: [
        { k: 2, pct: 25 },
        { k: 3, pct: 25 },
        { k: 7, pct: 50 },
      ],
    });
    expect(distMean(s.countDists.fours!)).toBeCloseTo(4.75, 12);
    expect(s.winRate5050).toBeCloseTo((4 / 6) * 100, 12);
    // C0 за 15 круток: из 3 дошедших двоим понадобилось больше
    expect(s.luckPercentile).toBeCloseTo((2 / 3) * 100, 12);
    expect(s.meta).toEqual({
      runs: 4,
      seed: input.seed,
      softPreset: 'community',
      epitomized: '5.0+',
      fiftyFifty: 'radiance',
    });
  });

  it('никто не дошёл — pulls null; нет 50/50 — winRate null; неизвестный результат удачи — без перцентиля', () => {
    const none = summarize({ ...input, luck: { result: 'C9', pulls: 1 } }, [
      run({ reachedAt: [null, null], fours: 1 }),
    ]);
    expect(none.results[0]).toEqual({ label: 'C0', pct: 0, pulls: null });
    expect(none.winRate5050).toBeNull();
    expect(none.luckPercentile).toBeUndefined();
    expect(none.combos).toEqual([{ label: NOTHING_LABEL, pct: 100 }]);
  });
});

describe('gacha/aggregate: сочетаемость пакетов (промежуточные итоги каждые 10%)', () => {
  const input = simInput({
    mode: 'char_and_weapon',
    budget: 300,
    consTarget: 1,
    refTarget: 1,
    runs: 10000,
    luck: { result: 'C1', pulls: 150 },
  });

  it('сумма итогов по пакетам = итог по всем прогонам', () => {
    const all = summarize(input, runBatch(input, 0, 10000));
    const parts = splitRuns(10000, 10).map(([from, to]) =>
      addResults(createTotals(input), runBatch(input, from, to)),
    );
    const merged = parts.reduce((acc, t) => mergeTotals(acc, t), createTotals(input));
    expect(JSON.stringify(finishTotals(merged, input))).toBe(JSON.stringify(all));
    // поэтапное добавление в один накопитель
    const acc = createTotals(input);
    for (const [from, to] of splitRuns(10000, 3)) addResults(acc, runBatch(input, from, to));
    expect(finishTotals(acc, input)).toEqual(all);
    expect(all.meta.runs).toBe(10000);
  });
});

describe('gacha/aggregate: TC-36, TC-43 — режимы и инварианты', () => {
  const cases: [string, Partial<SimInput>, string[]][] = [
    ['только оружие', { mode: 'weapon_only', refTarget: 3, budget: 250 }, ['R1', 'R2', 'R3']],
    ['только персонаж', { mode: 'char_only', consTarget: 2, budget: 250 }, ['C0', 'C1', 'C2']],
    [
      'персонаж + сигна',
      { mode: 'char_and_weapon', consTarget: 1, refTarget: 2, budget: 400 },
      ['C0', 'C1', 'C1 + R1', 'C1 + R2'],
    ],
  ];

  for (const [name, p, labels] of cases) {
    it(`TC-43: ${name} — строки ${labels.join(', ')}; % не растёт; сочетания = 100%`, () => {
      const input = simInput({ ...p, pity: pity({ char: 40, weapon: 30 }) });
      const s = summarize(input, runBatch(input, 0, 5000));
      expect(s.results.map((r) => r.label)).toEqual(labels);
      expectMonotone(s);
      const keys = Object.keys(s.countDists).sort();
      if (p.mode === 'weapon_only') expect(keys).toEqual(['fours', 'w5Chosen', 'w5Other', 'w5Std']);
      if (p.mode === 'char_only') expect(keys).toEqual(['char5Featured', 'char5Std', 'fours']);
      for (const d of Object.values(s.countDists)) expect(sumPct(d)).toBeCloseTo(100, 9);
    });
  }

  it('TC-36: инварианты на разных бюджетах, пресетах и с возвратом блеска', () => {
    const models = [
      makeModel('community'),
      makeModel('late_weapon', { fiftyFifty: 'classic', epitomized: '2.0-4.8' }),
      makeModel('fit_consolidated', { epitomized: '1.x' }),
    ];
    for (const model of models) {
      for (const budget of [0, 60, 200, 700]) {
        const input = simInput({
          mode: 'char_and_weapon',
          consTarget: 3,
          refTarget: 2,
          budget,
          model,
          starglitter: { enabled: budget > 100, per4: 2, perStd5: 10, perDup5: 10, perWeapon5: 10 },
        });
        const s = summarize(input, runBatch(input, 0, 1000));
        expectMonotone(s);
        if (budget === 0) expect(s.combos).toEqual([{ label: NOTHING_LABEL, pct: 100 }]);
      }
    }
  });

  it('пример 13.5: бюджет 160, pity 20, без гаранта, C2 + R1 — в пределах 3σ от точного расчёта (D-920)', () => {
    const N = 10_000;
    const B = 160;
    const input = simInput({
      mode: 'char_and_weapon',
      budget: B,
      consTarget: 2,
      refTarget: 1,
      pity: pity({ char: 20 }),
    });
    const s = summarize(input, runBatch(input, 0, N));
    expect(s.results.map((r) => r.label)).toEqual(['C0', 'C1', 'C2', 'C2 + R1']);
    expect(s.results[0].pct).toBe(100);
    // Точно: C1 / C2 — 2 / 3 копии не позже 160-й; C2 + R1 — свёртка C2 с R1 из остатка (оружие с pity 0).
    const m = input.model;
    const c2 = charCopiesDist(m, input.pity, 3, B);
    const r1 = weaponCopiesDist(m, input.pity, 1, B);
    let c2r1 = 0;
    for (let n = 0; n <= B; n++) c2r1 += c2.pmf[n] * cdfAt(r1, B - n);
    const exact = [cdfAt(charCopiesDist(m, input.pity, 2, B), B), cdfAt(c2, B), c2r1];
    expect(exact.map((p) => Math.round(p * 1e5) / 1e3)).toEqual([47.087, 8.183, 0.832]);
    // 3σ биномиальной ошибки для N прогонов: 1,50 / 0,82 / 0,27 п.п.
    s.results.slice(1).forEach((row, j) => {
      const sigma = Math.sqrt((exact[j] * (1 - exact[j])) / N) * 100;
      expect(Math.abs(row.pct - exact[j] * 100), row.label).toBeLessThan(3 * sigma);
    });
    expect(s.combos[0].label).toBe('C0 + R0');
  });
});
