import { describe, expect, it } from 'vitest';
import { rngForRun, runSeed, SplitMix32, Xoshiro128ss } from './rng';

describe('gacha/rng: splitmix32 + xoshiro128** (13.4)', () => {
  it('xoshiro128** из состояния [1, 2, 3, 4] — эталонные первые выходы', () => {
    const x = Xoshiro128ss.fromState(1, 2, 3, 4);
    expect([x.nextU32(), x.nextU32(), x.nextU32()]).toEqual([11520, 0, 5927040]);
  });

  it('splitmix32 детерминирован и даёт uint32', () => {
    const a = new SplitMix32(42);
    const b = new SplitMix32(42);
    const xs = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(xs);
    for (const v of xs) expect(Number.isInteger(v) && v >= 0 && v < 2 ** 32).toBe(true);
    expect(new Set(xs).size).toBe(5);
  });

  it('seed прогона i = splitmix32(baseSeed + i): зависит только от суммы, по модулю 2³²', () => {
    expect(runSeed(100, 5)).toBe(105);
    expect(runSeed(2 ** 32 - 1, 1)).toBe(0);
    expect(runSeed(-1, 0)).toBe(2 ** 32 - 1);
    const a = rngForRun(100, 5);
    const b = rngForRun(104, 1);
    const c = rngForRun(100, 6);
    const seqA = Array.from({ length: 8 }, () => a.next());
    expect(Array.from({ length: 8 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 8 }, () => c.next())).not.toEqual(seqA);
  });

  it('пересев переиспользуемого генератора = новый генератор', () => {
    const x = new Xoshiro128ss(7);
    x.next();
    x.reseed(9);
    const y = new Xoshiro128ss(9);
    expect([x.next(), x.next()]).toEqual([y.next(), y.next()]);
  });

  it('числа в [0, 1), распределение равномерное (χ² по 20 корзинам)', () => {
    const x = new Xoshiro128ss(20261019);
    const n = 200_000;
    const bins = new Array<number>(20).fill(0);
    let sum = 0;
    let min = 1;
    let max = 0;
    for (let i = 0; i < n; i++) {
      const u = x.next();
      sum += u;
      min = Math.min(min, u);
      max = Math.max(max, u);
      bins[Math.floor(u * 20)]++;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
    expect(sum / n).toBeCloseTo(0.5, 2);
    const e = n / 20;
    const chi2 = bins.reduce((s, b) => s + ((b - e) * (b - e)) / e, 0);
    expect(chi2).toBeLessThan(43.8); // 19 степеней свободы, p = 0,001
  });
});
