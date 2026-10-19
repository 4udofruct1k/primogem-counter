// Цели (8.4, раздел 5): момент цели и нужное число круток (гарантированный худший случай).
import { needPulls, type Goal, type GoalNeed, type ISO } from '@primo/domain';
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
