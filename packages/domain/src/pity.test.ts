import { describe, expect, it } from 'vitest';
import { goalGap, needPulls, reachDate } from './pity';
import type { Pity } from './types';

const pity = (p: Partial<Pity> = {}): Pity => ({
  char: 0,
  charGuaranteed: false,
  radiance: 0,
  weapon: 0,
  weaponGuaranteed: false,
  weaponFatePoint: 0,
  ...p,
});

describe('pity: гарантированный худший случай (8.4)', () => {
  it('TC-07: char5 pity 23 без гаранта → 157; с гарантом → 67; weapon5 pity 10, очко 0 → 150', () => {
    expect(needPulls({ kind: 'char5', copies: 1 }, pity({ char: 23 }))).toBe(157);
    expect(needPulls({ kind: 'char5', copies: 1 }, pity({ char: 23, charGuaranteed: true }))).toBe(67);
    expect(needPulls({ kind: 'weapon5', copies: 1 }, pity({ weapon: 10 }))).toBe(150);
  });

  it('несколько копий, очко судьбы, крутки и сумма целей', () => {
    expect(needPulls({ kind: 'char5', copies: 3 }, pity({ char: 23 }))).toBe(157 + 360);
    expect(needPulls({ kind: 'weapon5', copies: 1 }, pity({ weapon: 10, weaponFatePoint: 1 }))).toBe(70);
    expect(needPulls({ kind: 'pulls', n: 42 }, pity())).toBe(42);
    expect(
      needPulls(
        {
          kind: 'sum',
          parts: [
            { kind: 'char5', copies: 1 },
            { kind: 'weapon5', copies: 1 },
          ],
        },
        pity({ char: 23, weapon: 10 }),
      ),
    ).toBe(307);
  });

  it('разрыв и дата достижения — первый день серии с limitedPulls ≥ need', () => {
    expect(goalGap(157, 120)).toBe(37);
    expect(goalGap(157, 200)).toBe(-43);
    const series = [
      { date: '2026-10-19', limitedPulls: 100, standardPulls: 0 },
      { date: '2026-10-20', limitedPulls: 156, standardPulls: 0 },
      { date: '2026-10-21', limitedPulls: 157, standardPulls: 0 },
    ];
    expect(reachDate(series, 157)).toBe('2026-10-21');
    expect(reachDate(series, 158)).toBeNull();
  });
});
