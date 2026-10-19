// Выборки для экранов «Сегодня» и «Версия» (раздел 10).
import {
  CATEGORY_TITLES,
  ms,
  serverDateOf,
  type Category,
  type Occurrence,
  type Version,
} from '@primo/domain';
import type { Model } from './model';

export const HOT_DAYS = 7;
const DAY_MS = 86_400_000;

/** Вхождение, идущее прямо сейчас: from ≤ now < deadline. */
function activeNow(o: Occurrence, now: string): boolean {
  return ms(o.from) <= ms(now) && (!o.deadline || ms(now) < ms(o.deadline));
}

/** Чек-лист дня: дейлики, луна (если активна), HoYoLAB месяца. */
export function todayChecklist(model: Model): Occurrence[] {
  const date = serverDateOf(model.now, model.settings.server);
  const out: Occurrence[] = [];
  const daily = model.occurrences.find((o) => o.id === `daily_commissions:${date}`);
  if (daily) out.push(daily);
  const welkin = model.occurrences.find(
    (o) => o.ruleId === 'welkin' && !o.id.endsWith(':buy') && !o.virtual && activeNow(o, model.now),
  );
  if (welkin) out.push(welkin);
  return out;
}

export function currentHoyolab(model: Model): Occurrence | undefined {
  return model.occurrences.find((o) => o.tracker === 'hoyolab' && activeNow(o, model.now));
}

/** «Горит»: дедлайны ≤ 7 дней, включая недобитые трекеры бездны/театра/натиска перед сбросом. */
export function hotItems(model: Model): Occurrence[] {
  const now = ms(model.now);
  const checklist = new Set(todayChecklist(model).map((o) => o.id));
  return model.occurrences
    .filter((o) => {
      if (o.status !== 'planned' || !o.deadline || checklist.has(o.id)) return false;
      const left = ms(o.deadline) - now;
      if (left <= 0 || left > HOT_DAYS * DAY_MS) return false;
      if (ms(o.from) > now) return false;
      if (o.tracker === 'hoyolab') return false;
      if (o.tracker) {
        const sum = model.trackerSums[o.id] ?? 0;
        const expected = model.expectations[o.ruleId!]?.expected.primo ?? o.expected.primo ?? 0;
        return sum < expected;
      }
      return Object.values(o.reward).some((v) => v === null || (typeof v === 'number' && v > 0));
    })
    .sort((a, b) => ms(a.deadline!) - ms(b.deadline!));
}

/** Вхождения версии: по versionId, а ежедневные и ежемесячные — по дате начала внутри версии. */
export function versionOccurrences(model: Model, v: Version): Occurrence[] {
  const start = ms(v.start);
  const end = ms(v.end);
  return model.occurrences.filter((o) =>
    o.versionId ? o.versionId === v.id : ms(o.from) >= start && ms(o.from) < end,
  );
}

export interface OccGroup {
  key: string;
  title: string;
  items: Occurrence[];
  claimed: number;
  total: number;
}

/** Группы по категориям; ежедневные вхождения одного правила сворачиваются в одну группу. */
export function groupOccurrences(occs: Occurrence[]): OccGroup[] {
  const groups = new Map<string, OccGroup>();
  const order: Category[] = [
    'daily',
    'paid',
    'version_fixed',
    'event',
    'endgame',
    'shop',
    'external',
    'special',
    'one_time',
  ];
  for (const o of occs) {
    const key =
      o.category === 'daily' || (o.ruleId === 'welkin' && !o.id.endsWith(':buy'))
        ? `rule:${o.ruleId}`
        : `cat:${o.category}`;
    const title = key.startsWith('rule:') ? o.title : CATEGORY_TITLES[o.category];
    const g = groups.get(key) ?? { key, title, items: [], claimed: 0, total: 0 };
    g.items.push(o);
    g.total++;
    if (o.status === 'claimed') g.claimed++;
    groups.set(key, g);
  }
  const rank = (g: OccGroup) => order.indexOf(g.items[0]!.category);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
}
