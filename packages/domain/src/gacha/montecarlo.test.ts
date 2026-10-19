// Монте-Карло против точного расчёта: TC-29…TC-32, TC-41 и замер скорости (M9).
import { beforeAll, describe, expect, it } from 'vitest';
import { summarize } from './aggregate';
import { cdfAt, charCopiesDist, longRunWinRate, weaponCopiesDist } from './exact';
import { makeModel } from './model';
import { Xoshiro128ss } from './rng';
import { pickChar5, runAll, runBatch, type CharPickState } from './run';
import { pity, simInput } from './test/input';
import type { EpitomizedPath, FiftyFifty, RunResult } from './types';

const N = 100_000;
const official = makeModel('community', { fiftyFifty: 'official_radiance' });
const reached = (rs: RunResult[], j: number) => rs.map((r) => r.reachedAt[j]).filter((v) => v !== null);
const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

describe('gacha: Монте-Карло персонажа (100 000 прогонов)', () => {
  // Бюджет 180 — худший случай C0 из pity 0 без гаранта: до C0 доходят все прогоны.
  const input = simInput({ budget: 180, runs: N, model: official });
  const exact = charCopiesDist(official, pity(), 1);
  let rs: RunResult[] = [];
  beforeAll(() => {
    rs = runAll(input);
  });

  it('TC-29: P(C0 ≤ N) в пределах ±0,005 от точного', () => {
    const at = reached(rs, 0);
    expect(at.length).toBe(N);
    for (const n of [74, 80, 90, 120, 150, 180]) {
      const mc = at.filter((v) => v <= n).length / N;
      expect(Math.abs(mc - cdfAt(exact, n))).toBeLessThan(0.005);
    }
  });

  it('TC-30: среднее до C0 — 91,58 ± 0,5', () => {
    const m = mean(reached(rs, 0));
    expect(Math.abs(m - 91.58)).toBeLessThan(0.5);
    expect(summarize(input, rs).results[0].pulls?.mean).toBeCloseTo(m, 9);
  });
});

describe('gacha: Монте-Карло 50/50 (TC-32)', () => {
  /** 100 000 исходов 50/50 подряд — счётчик сияния переходит от одного к следующему. */
  function chain(ff: FiftyFifty): number {
    const rng = new Xoshiro128ss(32);
    const st: CharPickState = { guaranteed: false, radiance: 0 };
    let won = 0;
    for (let n = 0; n < N;) {
      const out = pickChar5(st, rng.next(), ff);
      if (out === 'guaranteed') continue;
      n++;
      if (out !== 'lost') won++;
    }
    return (won / N) * 100;
  }

  it('доля выигранных в долгую: 55,72% (сияние) и 50% (классика) ± 0,3 п.п.', () => {
    expect(Math.abs(chain('radiance') - longRunWinRate('radiance') * 100)).toBeLessThan(0.3);
    expect(Math.abs(chain('radiance') - 55.72)).toBeLessThan(0.3);
    expect(Math.abs(chain('classic') - 50)).toBeLessThan(0.3);
  });

  it('в прогонах C6 (7 исходов 50/50 из счётчика 0) — как точная цепочка на 7 шагов', () => {
    // Точно: E[выигрышей] за 7 исходов 50/50 из состояния «счётчик 0».
    let dist = [1, 0, 0, 0];
    let wins = 0;
    for (let k = 0; k < 7; k++) {
      const next = [0, 0, 0, 0];
      for (let c = 0; c < 4; c++) {
        const w = c === 3 ? 1 : 0.53;
        wins += dist[c] * w;
        next[0] += dist[c] * w;
        if (c < 3) next[c + 1] += dist[c] * (1 - w);
      }
      dist = next;
    }
    const input = simInput({ budget: 1260, consTarget: 6, runs: N });
    const rs = runBatch(input, 0, 20_000);
    expect(rs.every((r) => r.cons === 6 && r.won5050 + r.lost5050 === 7)).toBe(true);
    expect(Math.abs(summarize(input, rs).winRate5050! - (wins / 7) * 100)).toBeLessThan(0.5);
  });
});

describe('gacha: Монте-Карло оружия (100 000 прогонов)', () => {
  const cases: [string, EpitomizedPath, boolean, number, number, number][] = [
    // название, путь, гарант 75/25, бюджет (≥ худшего случая), точное среднее из спеки, допуск
    ['TC-31: «5.0+»', '5.0+', false, 160, 86.53, 0.5],
    ['TC-41: «2.0–4.8»', '2.0-4.8', false, 240, 105.67, 0.7],
    ['TC-41: «1.x»', '1.x', false, 5000, 133.12, 0.7],
    ['TC-41: «5.0+» с гарантом 75/25', '5.0+', true, 160, 79.88, 0.7],
  ];

  for (const [name, path, guaranteed, budget, spec, tol] of cases) {
    it(`${name}: среднее до R1 — ${String(spec).replace('.', ',')} ± ${String(tol).replace('.', ',')}`, () => {
      const model = makeModel('community', { epitomized: path });
      const p = pity({ weaponGuaranteed: guaranteed });
      const rs = runAll(simInput({ mode: 'weapon_only', budget, runs: N, model, pity: p }));
      const at = reached(rs, 0);
      expect(at.length).toBe(N);
      const m = mean(at);
      expect(Math.abs(m - spec)).toBeLessThan(tol);
      expect(Math.abs(m - weaponCopiesDist(model, p, 1).mean)).toBeLessThan(tol);
    });
  }
});

describe('gacha: Монте-Карло и точный расчёт на прижатом вводе (D-915, D-919)', () => {
  const n = 20_000;
  /** |МК − точное| < 3σ биномиальной ошибки для n прогонов. */
  const near = (mc: number, p: number) =>
    expect(Math.abs(mc - p)).toBeLessThan(3 * Math.sqrt((p * (1 - p)) / n));
  const share = (at: number[], k: number) => at.filter((v) => v <= k).length / n;

  it('очко судьбы 2 при «5.0+» (= 1): R1 первой же 5★, P(R1 ≤ N) — как у точного', () => {
    const p = pity({ weapon: 10, weaponFatePoint: 2 });
    const rs = runBatch(simInput({ mode: 'weapon_only', budget: 80, pity: p }), 0, n);
    expect(rs.every((r) => r.refs === 1 && r.w5Chosen === 1 && r.w5Other + r.w5Std === 0)).toBe(true);
    const d = weaponCopiesDist(official, p, 1);
    expect(d.worstCase).toBe(67);
    const at = reached(rs, 0);
    for (const k of [50, 55, 58, 60]) near(share(at, k), cdfAt(d, k));
  });

  it('«1.x» с очком 2 (пути нет = 0): P(R1 ≤ N) — как у точного', () => {
    const model = makeModel('community', { epitomized: '1.x' });
    const p = pity({ weaponFatePoint: 2, weaponGuaranteed: true });
    const rs = runBatch(simInput({ mode: 'weapon_only', budget: 5000, model, pity: p }), 0, n);
    const d = weaponCopiesDist(model, p, 1);
    const at = reached(rs, 0);
    for (const k of [60, 80, 120, 160, 240]) near(share(at, k), cdfAt(d, k));
  });

  it('«Классика» со счётчиком сияния 3 (счётчика нет = 0): P(C0 ≤ N) — как у точного', () => {
    const model = makeModel('community', { fiftyFifty: 'classic' });
    const p = pity({ char: 30, radiance: 3 });
    const rs = runBatch(simInput({ budget: 180, model, pity: p }), 0, n);
    const d = charCopiesDist(model, p, 1);
    const at = reached(rs, 0);
    for (const k of [50, 60, 90, 120, 140]) near(share(at, k), cdfAt(d, k));
  });
});

describe('gacha: скорость (M9 — 10 000 прогонов C6 + R1 на телефоне < 3 с)', () => {
  it('10 000 прогонов C6 + R1 с бюджетом на всё — в Node заметно меньше секунды', async ({ annotate }) => {
    const input = simInput({ mode: 'char_and_weapon', budget: 1500, consTarget: 6, refTarget: 1 });
    const t0 = Date.now();
    const rs = runAll(input);
    const s = summarize(input, rs);
    const ms = Date.now() - t0;
    await annotate(`10 000 прогонов C6 + R1: ${ms} мс, ${rs.reduce((a, r) => a + r.used, 0)} круток`);
    expect(s.results.at(-1)?.pct).toBe(100);
    expect(ms).toBeLessThan(3000);
  });
});
