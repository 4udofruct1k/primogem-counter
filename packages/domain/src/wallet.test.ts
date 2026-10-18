import { describe, expect, it } from 'vitest';
import {
  claimOccurrence,
  currentBalance,
  limitedPulls,
  spendPullsDelta,
  standardPulls,
  unclaimOccurrence,
} from './wallet';
import type { Balance, LedgerEntry, Occurrence, WalletSnapshot } from './types';

const pity = {
  char: 0,
  charGuaranteed: false,
  radiance: 0 as const,
  weapon: 0,
  weaponGuaranteed: false,
  weaponFatePoint: 0,
};
const empty: Balance = { primo: 0, crystal: 0, if: 0, af: 0, starglitter: 0, stardust: 0 };
const settings = { countCrystals: true, countStarglitter: false };

describe('wallet (3, 5.1)', () => {
  it('TC-08: primo 5000, crystal 300, IF 12, AF 20 → limitedPulls 45, standardPulls 20', () => {
    const b: Balance = { ...empty, primo: 5000, crystal: 300, if: 12, af: 20 };
    expect(limitedPulls(b, settings)).toBe(45);
    expect(standardPulls(b)).toBe(20);
  });

  it('кристаллы и звёздный блеск — по настройкам; AF не входят в лимитированные (I4)', () => {
    const b: Balance = { ...empty, primo: 100, crystal: 60, starglitter: 12, af: 50 };
    expect(limitedPulls(b, { countCrystals: true, countStarglitter: false })).toBe(1);
    expect(limitedPulls(b, { countCrystals: false, countStarglitter: false })).toBe(0);
    expect(limitedPulls(b, { countCrystals: false, countStarglitter: true })).toBe(2);
  });

  it('баланс = последний снимок + леджер после него', () => {
    const snapshots: WalletSnapshot[] = [
      { ...empty, at: '2026-10-01T00:00:00Z', primo: 100, pity },
      { ...empty, at: '2026-10-10T00:00:00Z', primo: 1000, if: 2, pity },
    ];
    const ledger: LedgerEntry[] = [
      { id: 'a', at: '2026-10-05T00:00:00Z', delta: { primo: 999 }, reason: 'manual' },
      { id: 'b', at: '2026-10-11T00:00:00Z', delta: { primo: 60 }, reason: 'claim' },
      { id: 'c', at: '2026-10-12T00:00:00Z', delta: { if: -1 }, reason: 'spend_pulls' },
    ];
    expect(currentBalance(snapshots, ledger)).toMatchObject({ primo: 1060, if: 1, pity });
  });

  it('TC-09: «забрал» с autoApply — баланс вырос, вхождение claimed, без задвоения', () => {
    const occ: Occurrence = {
      id: 'daily_commissions:2026-10-19',
      ruleId: 'daily_commissions',
      title: 'Ежедневные поручения',
      category: 'daily',
      paid: false,
      from: '2026-10-19T03:00:00Z',
      deadline: '2026-10-20T03:00:00Z',
      expectedClaimAt: '2026-10-19T17:00:00Z',
      reward: { primo: 60 },
      expected: { primo: 60 },
      status: 'planned',
      confidence: 'tally',
    };
    const at = '2026-10-19T06:00:00Z';
    const res = claimOccurrence(occ, at, { autoApply: true });
    expect(res.status).toEqual({ id: occ.id, status: 'claimed', claimedAt: at });
    expect(res.ledger).toEqual({
      id: `claim:${occ.id}:${at}`,
      at,
      delta: { primo: 60 },
      reason: 'claim',
      refId: occ.id,
    });

    const snap: WalletSnapshot = { ...empty, at: '2026-10-19T00:00:00Z', primo: 1000, pity };
    expect(currentBalance([snap], [res.ledger!]).primo).toBe(1060);

    // claimed не попадает в прогноз (I2) — проверяется в forecast.test.ts

    const off = claimOccurrence(occ, at, { autoApply: false });
    expect(off.ledger).toBeNull();
  });

  it('отмена отметки — отрицательная запись', () => {
    const occ = { id: 'x', reward: { primo: 60 }, actual: { primo: 40 } } as Occurrence;
    const res = unclaimOccurrence(occ, '2026-10-19T08:00:00Z', { autoApply: true });
    expect(res.status).toEqual({ id: 'x', status: 'planned' });
    expect(res.ledger).toMatchObject({ delta: { primo: -40 }, reason: 'claim', refId: 'x' });
  });

  it('траты: сначала IF, потом по 160 примогемов', () => {
    const b: Balance = { ...empty, primo: 1000, if: 3 };
    expect(spendPullsDelta(b, 5)).toEqual({ if: -3, primo: -320 });
    expect(spendPullsDelta(b, 2)).toEqual({ if: -2 });
  });
});
