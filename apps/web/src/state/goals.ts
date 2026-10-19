// Цели (8.4, раздел 5): момент цели и нужное число круток (гарантированный худший случай).
import {
  charCopiesDist,
  makeModel,
  needPulls,
  weaponCopiesDist,
  type Goal,
  type GoalNeed,
  type ISO,
  type Pity,
} from '@primo/domain';
import type { Model } from './model';

export function goalTarget(model: Model, goal: Goal): ISO | null {
  if (goal.target.kind === 'date') return goal.target.at;
  const target = goal.target;
  const banner = model.banners.find((b) => b.id === target.bannerId);
  if (!banner) return null;
  return target.point === 'start' ? banner.start : banner.end;
}

export function goalNeed(model: Model, goal: Goal): number {
  return needPulls(goal.need, model.pity);
}

/** «C2 + R1», «90 круток» — подпись цели. */
export function needLabel(need: GoalNeed): string {
  switch (need.kind) {
    case 'pulls':
      return `${need.n} круток`;
    case 'char5':
      return `C${need.copies - 1}`;
    case 'weapon5':
      return `R${need.copies}`;
    case 'sum':
      return need.parts.map(needLabel).join(' + ');
  }
}

/** Цель симулятора из цели прогноза: копии персонажа и оружия (13.6). */
export function simTargetOf(need: GoalNeed): { cons: number | null; refs: number | null } {
  let cons: number | null = null;
  let refs: number | null = null;
  const walk = (n: GoalNeed) => {
    if (n.kind === 'char5') cons = n.copies - 1;
    else if (n.kind === 'weapon5') refs = n.copies;
    else if (n.kind === 'sum') n.parts.forEach(walk);
  };
  walk(need);
  return { cons, refs };
}

/**
 * Медиана и p90 круток до цели по точному распределению модели «Сообщество» (13.6: рядом с худшим случаем).
 * Части суммы складываются свёрткой; первая часть баннера берёт Pity кошелька, следующие того же баннера —
 * с нуля (после выпавшей 5★ счётчик сброшен). «N круток» — сдвиг. Цель только из «круток» или вне диапазона
 * точного расчёта (RangeError) — null.
 */
export function goalPullStats(model: Model, need: GoalNeed): { median: number; p90: number } | null {
  const gm = makeModel('community');
  const fresh: Pity = {
    ...model.pity,
    char: 0,
    charGuaranteed: false,
    radiance: 0,
    weapon: 0,
    weaponGuaranteed: false,
    weaponFatePoint: 0,
  };
  const used = { char: false, weapon: false };
  const pmfs: ArrayLike<number>[] = [];
  let shift = 0;
  const walk = (n: GoalNeed) => {
    if (n.kind === 'char5') {
      pmfs.push(charCopiesDist(gm, used.char ? fresh : model.pity, n.copies).pmf);
      used.char = true;
    } else if (n.kind === 'weapon5') {
      pmfs.push(weaponCopiesDist(gm, used.weapon ? fresh : model.pity, n.copies).pmf);
      used.weapon = true;
    } else if (n.kind === 'sum') n.parts.forEach(walk);
    else shift += n.n;
  };
  try {
    walk(need);
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
  if (pmfs.length === 0) return null;
  let pmf = Array.from(pmfs[0]!);
  for (const next of pmfs.slice(1)) {
    const out = new Array<number>(pmf.length + next.length - 1).fill(0);
    for (let i = 0; i < pmf.length; i++) {
      const a = pmf[i]!;
      if (a) for (let j = 0; j < next.length; j++) out[i + j]! += a * next[j]!;
    }
    pmf = out;
  }
  const quantile = (q: number) => {
    let acc = 0;
    for (let n = 0; n < pmf.length; n++) {
      acc += pmf[n]!;
      if (acc >= q - 1e-12) return n + shift;
    }
    return pmf.length - 1 + shift;
  };
  return { median: quantile(0.5), p90: quantile(0.9) };
}
