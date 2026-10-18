// Цели и pity: гарантированный худший случай (8.4).
import type { GoalNeed, Pity } from './types';

/** Жёсткий гарант 5★ персонажа и 50/50: 90 и 180 круток. */
export const CHAR_HARD_PITY = 90;
/** Жёсткий гарант 5★ оружия: 80; без очка судьбы худший случай — две 5★ (160). */
export const WEAPON_HARD_PITY = 80;

export function needPulls(need: GoalNeed, pity: Pity): number {
  switch (need.kind) {
    case 'pulls':
      return need.n;
    case 'char5':
      return (
        (pity.charGuaranteed ? CHAR_HARD_PITY : 2 * CHAR_HARD_PITY) -
        pity.char +
        2 * CHAR_HARD_PITY * (need.copies - 1)
      );
    case 'weapon5':
      return (
        (pity.weaponFatePoint === 1 ? WEAPON_HARD_PITY : 2 * WEAPON_HARD_PITY) -
        pity.weapon +
        2 * WEAPON_HARD_PITY * (need.copies - 1)
      );
    case 'sum':
      return need.parts.reduce((s, p) => s + needPulls(p, pity), 0);
  }
}

/** gap = need − limitedPulls(T); ≤ 0 — цель достигнута. */
export function goalGap(need: number, limitedPulls: number): number {
  return need - limitedPulls;
}

export function reachDate(series: { date: string; limitedPulls: number }[], need: number): string | null {
  return series.find((p) => p.limitedPulls >= need)?.date ?? null;
}
