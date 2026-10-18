// Переопределения пользователя и мердж датапака (I6, раздел 16): Override > новый пак > старый пак > проекция.
import { ms } from './time';
import type { Override } from './types';

/** Мердж по id: записи нового пака заменяют старые, записи только из старого пака остаются. */
export function mergeById<T extends { id: string }>(older: T[], newer: T[]): T[] {
  const byId = new Map(older.map((x) => [x.id, x]));
  for (const x of newer) byId.set(x.id, x);
  return [...byId.values()];
}

/** Накладывает Override сущности `entity` на список; поле — путь через точку. Поздний Override побеждает. */
export function applyOverrides<T extends { id: string }>(
  entity: string,
  items: T[],
  overrides: Override[],
): T[] {
  const relevant = overrides.filter((o) => o.entity === entity).sort((a, b) => ms(a.at) - ms(b.at));
  if (relevant.length === 0) return items;
  return items.map((item) => {
    const own = relevant.filter((o) => o.id === item.id);
    if (own.length === 0) return item;
    const copy = structuredClone(item);
    for (const o of own) setPath(copy as Record<string, unknown>, o.field, o.value);
    return copy;
  });
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  let obj = target;
  for (const k of keys.slice(0, -1)) {
    const next = obj[k];
    if (typeof next !== 'object' || next === null) obj[k] = {};
    obj = obj[k] as Record<string, unknown>;
  }
  obj[keys.at(-1)!] = structuredClone(value);
}
