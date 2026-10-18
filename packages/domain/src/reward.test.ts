import { describe, expect, it } from 'vitest';
import {
  addRewards,
  hasNull,
  isZero,
  rewardEquals,
  scaleReward,
  subtractClamped,
  subtractRewards,
} from './reward';

describe('reward', () => {
  it('складывает по валютам, null = 0', () => {
    expect(addRewards({ primo: 100, af: 1 }, { primo: 50, if: null }, { if: 2 })).toEqual({
      primo: 150,
      af: 1,
      if: 2,
    });
  });

  it('вычитает и масштабирует', () => {
    expect(subtractRewards({ primo: 100, af: 1 }, { primo: 300 })).toEqual({ primo: -200, af: 1 });
    expect(scaleReward({ primo: 20, if: 1 }, 3)).toEqual({ primo: 60, if: 3 });
  });

  it('остаток не уходит в минус по каждой валюте (11.4)', () => {
    expect(subtractClamped({ primo: 160, af: 2 }, { primo: 200, af: 1 })).toEqual({ af: 1 });
  });

  it('null-суммы видны отдельно (I5)', () => {
    expect(hasNull({ primo: null })).toBe(true);
    expect(hasNull({ primo: 0, if: 10 })).toBe(false);
  });

  it('сравнение без учёта нулей', () => {
    expect(rewardEquals({ primo: 10, af: 0 }, { primo: 10 })).toBe(true);
    expect(isZero({ primo: 0, if: null })).toBe(true);
  });
});
