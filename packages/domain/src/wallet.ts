// Кошелёк: крутки, баланс, отметки и траты (разделы 3, 5.1).
import { addRewards, scaleReward } from './reward';
import { ms } from './time';
import type {
  Balance,
  ISO,
  LedgerEntry,
  Occurrence,
  OccStatusDoc,
  Pity,
  Reward,
  WalletSnapshot,
} from './types';

/** 160 примогемов = 1 молитва (3). */
export const PRIMO_PER_PULL = 160;
/** 5 звёздного блеска → 1 IF/AF (3). */
export const STARGLITTER_PER_PULL = 5;

export interface PullSettings {
  countCrystals: boolean;
  countStarglitter: boolean;
}

export const DEFAULT_PULL_SETTINGS: PullSettings = { countCrystals: true, countStarglitter: false };

export function limitedPulls(b: Balance, s: PullSettings): number {
  return (
    Math.floor((b.primo + (s.countCrystals ? b.crystal : 0)) / PRIMO_PER_PULL) +
    b.if +
    (s.countStarglitter ? Math.floor(b.starglitter / STARGLITTER_PER_PULL) : 0)
  );
}

/** Стандартные крутки — только AF (I4). */
export function standardPulls(b: Balance): number {
  return b.af;
}

export const EMPTY_BALANCE: Balance = { primo: 0, crystal: 0, if: 0, af: 0, starglitter: 0, stardust: 0 };

export function applyReward(b: Balance, r: Reward | null | undefined): Balance {
  const sum = addRewards(b, r);
  return {
    primo: sum.primo ?? 0,
    crystal: sum.crystal ?? 0,
    if: sum.if ?? 0,
    af: sum.af ?? 0,
    starglitter: sum.starglitter ?? 0,
    stardust: sum.stardust ?? 0,
  };
}

/** Баланс = последний WalletSnapshot + LedgerEntry после него (5.1). */
export function currentBalance(
  snapshots: WalletSnapshot[],
  ledger: LedgerEntry[],
): Balance & { at: ISO | null; pity: Pity | null } {
  const last = snapshots.reduce<WalletSnapshot | null>((a, s) => (!a || ms(s.at) > ms(a.at) ? s : a), null);
  const since = last ? ms(last.at) : -Infinity;
  let b: Balance = last ? pickBalance(last) : { ...EMPTY_BALANCE };
  for (const e of ledger) if (ms(e.at) > since) b = applyReward(b, e.delta);
  return { ...b, at: last?.at ?? null, pity: last?.pity ?? null };
}

function pickBalance(s: Balance): Balance {
  return {
    primo: s.primo,
    crystal: s.crystal,
    if: s.if,
    af: s.af,
    starglitter: s.starglitter,
    stardust: s.stardust,
  };
}

export interface ClaimResult {
  status: OccStatusDoc;
  ledger: LedgerEntry | null;
}

/** Отметка «забрал»: статус claimed и при autoApplyClaims — запись в леджер (5.1). */
export function claimOccurrence(
  occ: Occurrence,
  at: ISO,
  opts: { autoApply: boolean; actual?: Reward },
): ClaimResult {
  const amount = opts.actual ?? occ.actual ?? occ.reward;
  const status: OccStatusDoc = { id: occ.id, status: 'claimed', claimedAt: at };
  if (opts.actual) status.actual = opts.actual;
  return {
    status,
    ledger: opts.autoApply
      ? { id: `claim:${occ.id}:${at}`, at, delta: addRewards(amount), reason: 'claim', refId: occ.id }
      : null,
  };
}

/** Снятие отметки: статус обратно planned, при autoApply — отрицательная запись. */
export function unclaimOccurrence(occ: Occurrence, at: ISO, opts: { autoApply: boolean }): ClaimResult {
  const amount = occ.actual ?? occ.reward;
  return {
    status: { id: occ.id, status: 'planned' },
    ledger: opts.autoApply
      ? { id: `unclaim:${occ.id}:${at}`, at, delta: scaleReward(amount, -1), reason: 'claim', refId: occ.id }
      : null,
  };
}

/** «Потратил N круток»: сначала IF, потом по 160 примогемов (5.1). */
export function spendPullsDelta(b: Balance, n: number): Reward {
  const fromIf = Math.min(b.if, n);
  return addRewards({ if: -fromIf, primo: -(n - fromIf) * PRIMO_PER_PULL });
}
