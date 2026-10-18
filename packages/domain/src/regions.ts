// Регионы и разовый контент (раздел 11). Все числа — из primo_seed_regions.json.
import { parseEndgameConfig, type EndgameConfig } from './endgame';
import {
  addRewards,
  exceeds,
  hasNull,
  rewardEquals,
  scaleReward,
  subtractClamped,
  subtractRewards,
} from './reward';
import type {
  Area,
  AreaState,
  CategoryDef,
  CategoryKind,
  CategoryProgress,
  ChestBracket,
  ChestType,
  ChestVariant,
  Confidence,
  GeneralSource,
  ISO,
  LevelRow,
  LevelSchedule,
  Region,
  Reward,
} from './types';

// ── seed ───────────────────────────────────────────────────────────────────

export interface RawSeed {
  schemaVersion: number;
  chestTypes: ChestType[];
  levelSchedules: Record<string, Omit<LevelSchedule, 'id'>>;
  regions: {
    id: string;
    name: string;
    videoChapter?: string | null;
    areas: (Omit<Area, 'regionId' | 'categories'> & {
      categories: (Omit<CategoryDef, 'id'> & Record<string, unknown>)[];
    })[];
  }[];
  general: (Omit<GeneralSource, 'id'> & { id: string })[];
  endgame: unknown;
}

export interface Seed {
  chestTypes: ChestType[];
  schedules: Record<string, LevelSchedule>;
  regions: Region[];
  general: GeneralSource[];
  endgame: EndgameConfig;
}

/** Префикс id общих источников — чтобы не пересекаться с id категорий областей в `cat_progress`. */
export const GENERAL_PREFIX = 'general:';

export function normalizeSeed(raw: RawSeed): Seed {
  const schedules: Record<string, LevelSchedule> = {};
  for (const [id, s] of Object.entries(raw.levelSchedules)) schedules[id] = { id, ...s };

  const regions: Region[] = raw.regions.map((r) => ({
    id: r.id,
    name: r.name,
    videoChapter: r.videoChapter ?? null,
    areas: r.areas.map((a) => {
      const seen = new Map<CategoryKind, number>();
      const area: Area = {
        id: a.id,
        regionId: r.id,
        name: a.name,
        chestBracket: a.chestBracket,
        categories: a.categories.map((c) => {
          const n = (seen.get(c.kind) ?? 0) + 1;
          seen.set(c.kind, n);
          return pickCategory({ ...c, id: `${a.id}:${c.kind}${n > 1 ? `_${n}` : ''}` });
        }),
      };
      if (a.addedIn) area.addedIn = a.addedIn;
      if (a.videoTotal) area.videoTotal = a.videoTotal;
      if (a.note) area.note = a.note;
      return area;
    }),
  }));

  const general: GeneralSource[] = raw.general.map((g) => {
    const src = pickCategory({ ...g, kind: 'other', id: `${GENERAL_PREFIX}${g.id}` }) as GeneralSource;
    delete (src as Partial<CategoryDef>).kind;
    return src;
  });

  return {
    chestTypes: raw.chestTypes.map((t) => ({ ...t, values: { ...t.values } })),
    schedules,
    regions,
    general,
    endgame: parseEndgameConfig(raw.endgame),
  };
}

const CATEGORY_FIELDS = [
  'id',
  'kind',
  'title',
  'total',
  'editor',
  'unit',
  'count',
  'countDerived',
  'chestCounts',
  'schedule',
  'multiplier',
  'levels',
  'items',
  'quick',
  'maxLevelNow',
  'maxLevelNowNote',
  'confidence',
  'note',
  'ref',
] as const;

/** Оставляет только поля CategoryDef (служебные поля seed вроде `totalNow` отбрасываются — считаем сами). */
function pickCategory(c: Record<string, unknown>): CategoryDef {
  const out: Record<string, unknown> = {};
  for (const k of CATEGORY_FIELDS) if (c[k] !== undefined && c[k] !== null) out[k] = structuredClone(c[k]);
  if (!('total' in out)) out.total = null;
  return out as unknown as CategoryDef;
}

export function findArea(seed: Seed, areaId: string): Area | undefined {
  for (const r of seed.regions) for (const a of r.areas) if (a.id === areaId) return a;
  return undefined;
}

export function findCategory(seed: Seed, categoryId: string): CategoryDef | GeneralSource | undefined {
  if (categoryId.startsWith(GENERAL_PREFIX)) return seed.general.find((g) => g.id === categoryId);
  const areaId = categoryId.split(':')[0]!;
  return findArea(seed, areaId)?.categories.find((c) => c.id === categoryId);
}

// ── расчёт по категории ────────────────────────────────────────────────────

export interface CalcContext {
  /** Цены сундуков с учётом Override (настройки и уровень области). */
  chestTypes: ChestType[];
  schedules: Record<string, LevelSchedule>;
}

export interface Flags {
  /** «Область закрыта» или «Регион закрыт». */
  closed: boolean;
  /** «Сундуки 100%». */
  chests100: boolean;
}

/** Категория области или общий источник — у обоих одинаковые редакторы (11.5). */
export type Calculable = Omit<CategoryDef, 'kind'>;

export function levelTable(cat: Calculable, ctx: CalcContext): LevelRow[] {
  if (cat.levels) return cat.levels;
  if (!cat.schedule) return [];
  const s = ctx.schedules[cat.schedule];
  if (!s) throw new Error(`unknown level schedule: ${cat.schedule}`);
  return s.levels;
}

export function maxLevel(cat: Calculable, ctx: CalcContext): number {
  return levelTable(cat, ctx).reduce((m, r) => Math.max(m, r.level), 0);
}

/** Верхняя граница степпера: maxLevelNow, если задан, иначе максимум таблицы (11.2). */
export function levelCap(cat: Calculable, ctx: CalcContext): number {
  return Math.min(cat.maxLevelNow ?? Infinity, maxLevel(cat, ctx));
}

export function clampLevel(cat: Calculable, level: number, ctx: CalcContext): number {
  return Math.max(0, Math.min(levelCap(cat, ctx), Math.floor(level)));
}

export function points(cat: Calculable): number {
  return cat.multiplier ?? 1;
}

export function levelRewardUpTo(rows: LevelRow[], level: number): Reward {
  return addRewards(
    ...rows.filter((r) => r.level <= level).map((r) => ({ primo: r.primo, af: r.af, if: r.if })),
  );
}

/** Единица для `count`: из данных, иначе итог / число (бездна 1–8: 2405 / 8 → 300 за этаж, 11.5). */
export function countUnit(cat: Calculable): Reward {
  if (cat.unit) return cat.unit;
  if (!cat.total || !cat.count) return {};
  const out: Reward = {};
  for (const [c, v] of Object.entries(cat.total) as [keyof Reward, number | null][]) {
    if (v) out[c] = Math.floor(v / cat.count);
  }
  return out;
}

function checklistUnit(cat: Calculable): Reward {
  if (cat.unit) return cat.unit;
  const n = cat.items?.length ?? cat.count ?? 0;
  if (!cat.total || !n) return {};
  return scaleReward(cat.total, 1 / n);
}

/** Прогресс с наложенными флагами (I9: ручной прогресс не меняется, флаг только перекрывает его). */
export function effectiveProgress(
  cat: Calculable,
  progress: CategoryProgress | undefined,
  flags: Flags,
  ctx: CalcContext,
): CategoryProgress {
  const base: CategoryProgress = progress ?? { categoryId: cat.id, updatedAt: '' };
  if (!flags.closed) return base;
  switch (cat.editor) {
    case 'level':
      return { ...base, levels: Array.from({ length: points(cat) }, () => levelCap(cat, ctx)) };
    case 'count':
      return cat.count ? { ...base, count: cat.count } : base;
    case 'checklist':
      return cat.items ? { ...base, checked: [...cat.items] } : base;
    case 'amount':
      return cat.total ? { ...base, amount: { ...cat.total } } : base;
    case 'binary':
      return { ...base, done: true };
    case 'chests':
      return base;
  }
}

/** Собрано по категории (11.2) с учётом флагов (11.3). */
export function collected(
  cat: Calculable,
  progress: CategoryProgress | undefined,
  flags: Flags,
  ctx: CalcContext,
): Reward {
  const p = effectiveProgress(cat, progress, flags, ctx);
  switch (cat.editor) {
    case 'chests':
      if ((flags.closed || flags.chests100) && cat.total) return addRewards(cat.total);
      return addRewards({ primo: chestSum(p, ctx) });
    case 'amount':
      return addRewards(p.amount);
    case 'count': {
      const n = p.count ?? 0;
      if (cat.count && cat.total && n >= cat.count) return addRewards(cat.total);
      return scaleReward(countUnit(cat), n);
    }
    case 'level': {
      const rows = levelTable(cat, ctx);
      return addRewards(...(p.levels ?? []).map((lvl) => levelRewardUpTo(rows, lvl)));
    }
    case 'checklist': {
      const items = cat.items ?? [];
      const checked = new Set((p.checked ?? []).filter((x) => items.length === 0 || items.includes(x)));
      if (cat.total && items.length && checked.size === items.length) return addRewards(cat.total);
      return scaleReward(checklistUnit(cat), checked.size);
    }
    case 'binary':
      return p.done ? addRewards(cat.total) : {};
  }
}

/** Ключи от уровней (справочно, в примогемы не входят — 11.4). */
export function levelKeys(
  cat: Calculable,
  progress: CategoryProgress | undefined,
  flags: Flags,
  ctx: CalcContext,
) {
  const rows = levelTable(cat, ctx);
  const p = effectiveProgress(cat, progress, flags, ctx);
  return (p.levels ?? []).reduce(
    (n, lvl) => n + rows.filter((r) => r.level <= lvl).reduce((k, r) => k + (r.key ?? 0), 0),
    0,
  );
}

/** Итог, доступный сейчас: для `level` с maxLevelNow — награды уровней ≤ maxLevelNow × multiplier (11.4). */
export function nowTotal(cat: Calculable, ctx: CalcContext): Reward | null {
  if (cat.editor === 'level' && cat.maxLevelNow !== undefined) {
    return scaleReward(levelRewardUpTo(levelTable(cat, ctx), cat.maxLevelNow), points(cat));
  }
  return cat.total;
}

export interface CategorySummary {
  id: string;
  total: Reward | null;
  nowTotal: Reward | null;
  collected: Reward;
  /** max(0, total − collected) по каждой валюте. */
  remaining: Reward;
  /** max(0, nowTotal − collected) — только это идёт в прогноз (11.6). */
  remainingNow: Reward;
  /** total − nowTotal: «откроется позже». */
  later: Reward;
  /** Ввод сверх итога (I8) — показывается предупреждение. */
  overTotal: boolean;
  /** Итог неизвестен (`null`) — в прогнозе 0, в блоке «не учтено». */
  unknown: boolean;
  confidence: Confidence;
}

export function categorySummary(
  cat: Calculable,
  progress: CategoryProgress | undefined,
  flags: Flags,
  ctx: CalcContext,
): CategorySummary {
  const got = collected(cat, progress, flags, ctx);
  const now = nowTotal(cat, ctx);
  return {
    id: cat.id,
    total: cat.total,
    nowTotal: now,
    collected: got,
    remaining: subtractClamped(cat.total, got),
    remainingNow: subtractClamped(now, got),
    later: subtractClamped(cat.total, now),
    overTotal: cat.total !== null && exceeds(got, cat.total),
    unknown: cat.total === null || hasNull(cat.total),
    confidence: cat.confidence,
  };
}

/** Разница «было → стало» для LedgerEntry(reason: 'progress') (5.1). */
export function progressDelta(
  cat: Calculable,
  before: CategoryProgress | undefined,
  after: CategoryProgress | undefined,
  flagsBefore: Flags,
  flagsAfter: Flags,
  ctx: CalcContext,
): Reward {
  return subtractRewards(collected(cat, after, flagsAfter, ctx), collected(cat, before, flagsBefore, ctx));
}

// ── области и регионы ──────────────────────────────────────────────────────

export interface AreaSummary {
  id: string;
  /** videoTotal ?? Σ cat.total. */
  total: Reward;
  sumOfCategories: Reward;
  collected: Reward;
  remaining: Reward;
  remainingNow: Reward;
  later: Reward;
  /** «сумма строк ≠ итог видео». */
  badge: boolean;
  closed: boolean;
  categories: CategorySummary[];
}

export function areaFlags(state: AreaState | undefined, regionClosed: boolean): Flags {
  return { closed: regionClosed || (state?.closed ?? false), chests100: state?.chests100 ?? false };
}

export function areaSummary(
  area: Area,
  progress: Record<string, CategoryProgress | undefined>,
  state: AreaState | undefined,
  regionClosed: boolean,
  ctx: CalcContext,
): AreaSummary {
  const flags = areaFlags(state, regionClosed);
  const categories = area.categories.map((c) => categorySummary(c, progress[c.id], flags, ctx));
  const sumOfCategories = addRewards(...area.categories.map((c) => c.total));
  return {
    id: area.id,
    total: area.videoTotal ? addRewards(area.videoTotal) : sumOfCategories,
    sumOfCategories,
    collected: addRewards(...categories.map((c) => c.collected)),
    remaining: addRewards(...categories.map((c) => c.remaining)),
    remainingNow: addRewards(...categories.map((c) => c.remainingNow)),
    later: addRewards(...categories.map((c) => c.later)),
    badge: area.videoTotal !== undefined && !rewardEquals(sumOfCategories, area.videoTotal),
    closed: flags.closed,
    categories,
  };
}

export interface RegionSummary {
  id: string;
  total: Reward;
  collected: Reward;
  remaining: Reward;
  remainingNow: Reward;
  /** Все области закрыты — регион «на 100%». */
  complete: boolean;
  areas: AreaSummary[];
}

export function regionSummary(
  region: Region,
  progress: Record<string, CategoryProgress | undefined>,
  areaStates: Record<string, AreaState | undefined>,
  regionClosed: boolean,
  ctx: CalcContext,
): RegionSummary {
  const areas = region.areas.map((a) => areaSummary(a, progress, areaStates[a.id], regionClosed, ctx));
  return {
    id: region.id,
    total: addRewards(...areas.map((a) => a.total)),
    collected: addRewards(...areas.map((a) => a.collected)),
    remaining: addRewards(...areas.map((a) => a.remaining)),
    remainingNow: addRewards(...areas.map((a) => a.remainingNow)),
    complete: areas.length > 0 && areas.every((a) => a.closed),
    areas,
  };
}

// ── редакторы ──────────────────────────────────────────────────────────────

export const CHEST_LOG_LIMIT = 50;

export interface ChestButton {
  variant: ChestVariant;
  price: number;
}

/**
 * Кнопки «+» типа сундука в области (11.2): у вариантных типов (роскошный 10 / 40) — по цене варианта
 * во всех областях; иначе low и/или high по скобке области.
 */
export function chestButtons(type: ChestType, bracket: ChestBracket): ChestButton[] {
  if (type.variants?.length) return type.variants.map((v) => ({ variant: v, price: v }));
  const out: ChestButton[] = [];
  if (bracket !== 'high') out.push({ variant: 'low', price: type.values.low });
  if (bracket !== 'low') out.push({ variant: 'high', price: type.values.high });
  return out;
}

export function chestPrice(type: ChestType, variant: ChestVariant): number {
  return typeof variant === 'number' ? variant : type.values[variant];
}

function chestSum(p: CategoryProgress, ctx: CalcContext): number {
  let total = 0;
  for (const [typeId, byVariant] of Object.entries(p.chestCounts ?? {})) {
    const type = ctx.chestTypes.find((t) => t.id === typeId);
    if (!type) continue;
    for (const [variant, n] of Object.entries(byVariant)) {
      const v: ChestVariant = variant === 'low' || variant === 'high' ? variant : Number(variant);
      total += chestPrice(type, v) * n;
    }
  }
  return total;
}

/** «+» / «−» по типу сундука; пишет chestLog (последние 50) для «отменить последнее». */
export function addChest(
  progress: CategoryProgress,
  area: Pick<Area, 'chestBracket'>,
  type: ChestType,
  variant: ChestVariant,
  delta: 1 | -1,
  at: ISO,
): CategoryProgress {
  if (!chestButtons(type, area.chestBracket).some((b) => b.variant === variant)) {
    throw new Error(`сундук «${type.id}» без варианта ${String(variant)} в области ${area.chestBracket}`);
  }
  const key = String(variant);
  const current = progress.chestCounts?.[type.id]?.[key] ?? 0;
  if (current + delta < 0) return progress;
  const counts = structuredClone(progress.chestCounts ?? {});
  counts[type.id] = { ...counts[type.id], [key]: current + delta };
  const log = [...(progress.chestLog ?? []), { type: type.id, variant, delta, at }].slice(-CHEST_LOG_LIMIT);
  return { ...progress, chestCounts: counts, chestLog: log, updatedAt: at };
}

/** «Отменить последнее» — откатывает последнее нажатие из chestLog. */
export function undoLastChest(progress: CategoryProgress, at?: ISO): CategoryProgress {
  const log = progress.chestLog ?? [];
  const last = log.at(-1);
  if (!last) return progress;
  const key = String(last.variant);
  const counts = structuredClone(progress.chestCounts ?? {});
  const value = Math.max(0, (counts[last.type]?.[key] ?? 0) - last.delta);
  counts[last.type] = { ...counts[last.type], [key]: value };
  return {
    ...progress,
    chestCounts: counts,
    chestLog: log.slice(0, -1),
    updatedAt: at ?? progress.updatedAt,
  };
}

export function setLevel(
  progress: CategoryProgress,
  cat: Calculable,
  point: number,
  level: number,
  ctx: CalcContext,
  at: ISO,
): CategoryProgress {
  const levels = Array.from({ length: points(cat) }, (_, i) => progress.levels?.[i] ?? 0);
  levels[point] = clampLevel(cat, level, ctx);
  return { ...progress, levels, updatedAt: at };
}

export function setCount(
  progress: CategoryProgress,
  cat: Calculable,
  count: number,
  at: ISO,
): CategoryProgress {
  const max = cat.count ?? Infinity;
  return { ...progress, count: Math.max(0, Math.min(max, Math.floor(count))), updatedAt: at };
}

/** Ввод суммой: сверх итога разрешено (I8), отрицательный остаток не допускается. */
export function addAmount(progress: CategoryProgress, delta: Reward, at: ISO): CategoryProgress {
  const next = addRewards(progress.amount, delta);
  for (const [c, v] of Object.entries(next) as [keyof Reward, number][]) if (v < 0) delete next[c];
  return { ...progress, amount: next, updatedAt: at };
}

export function toggleItem(progress: CategoryProgress, item: string, at: ISO): CategoryProgress {
  const checked = new Set(progress.checked ?? []);
  if (checked.has(item)) checked.delete(item);
  else checked.add(item);
  return { ...progress, checked: [...checked], updatedAt: at };
}

export function setDone(progress: CategoryProgress, done: boolean, at: ISO): CategoryProgress {
  return { ...progress, done, updatedAt: at };
}
