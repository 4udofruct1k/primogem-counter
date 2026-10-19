// Мердж игровых данных (16): «Override > новый пак > старый пак > проекция»; патчи регионов из пака — поверх seed.
import type { RawDatapack } from './datapack';
import type { RawSeed } from './regions';

type WithId = { id: string };

/** Объединение по id: элементы `newer` заменяют элементы `older` с тем же id, порядок — сначала новые. */
function unionById<T extends WithId>(newer: T[], older: T[]): T[] {
  const ids = new Set(newer.map((x) => x.id));
  return [...newer, ...older.filter((x) => !ids.has(x.id))];
}

/**
 * Новый пак поверх старого: версии, баннеры, ивенты и правила, которых нет в новом паке, сохраняются
 * (например, прошедшие версии); остальные поля — из нового пака.
 */
export function mergePacks(newer: RawDatapack, older: RawDatapack | null | undefined): RawDatapack {
  if (!older) return newer;
  return {
    ...newer,
    versions: unionById(newer.versions, older.versions),
    banners: unionById(newer.banners, older.banners),
    events: unionById(newer.events, older.events),
    rules: unionById(newer.rules, older.rules),
  };
}

/** Патчи seed в паке (16): `regions`, `levelSchedules`, `chestTypes`, `general` — по id. */
export interface PackSeedPatch {
  regions?: Partial<RawSeed['regions'][number]>[];
  levelSchedules?: RawSeed['levelSchedules'];
  chestTypes?: Partial<RawSeed['chestTypes'][number]>[];
  general?: Partial<RawSeed['general'][number]>[];
}

type RawArea = RawSeed['regions'][number]['areas'][number];
type RawCategory = RawArea['categories'][number];

/** Ключ категории внутри области — как в id категории (`kind`, повтор — `kind_2`), см. normalizeSeed. */
function categoryKeys(list: RawCategory[]): string[] {
  const seen: Record<string, number> = {};
  return list.map((c) => {
    const n = (seen[c.kind] = (seen[c.kind] ?? 0) + 1);
    return `${c.kind}${n > 1 ? `_${n}` : ''}`;
  });
}

function mergeCategories(base: RawCategory[], patch: RawCategory[]): RawCategory[] {
  const out = [...base];
  const baseKeys = categoryKeys(base);
  categoryKeys(patch).forEach((key, i) => {
    const at = baseKeys.indexOf(key);
    if (at >= 0) out[at] = { ...out[at], ...patch[i] } as RawCategory;
    else out.push(patch[i]!);
  });
  return out;
}

function mergeAreas(base: RawArea[], patch: Partial<RawArea>[]): RawArea[] {
  const out = [...base];
  for (const p of patch) {
    if (!p.id) continue;
    const at = out.findIndex((a) => a.id === p.id);
    if (at < 0) out.push(p as RawArea);
    else
      out[at] = {
        ...out[at]!,
        ...p,
        categories: mergeCategories(out[at]!.categories, p.categories ?? []),
      } as RawArea;
  }
  return out;
}

/** seed + патчи из пака; исходный seed не меняется. */
export function applySeedPatch(seed: RawSeed, pack: PackSeedPatch): RawSeed {
  const out: RawSeed = { ...seed };
  if (pack.chestTypes?.length) {
    const types = [...seed.chestTypes];
    for (const p of pack.chestTypes) {
      if (!p.id) continue;
      const at = types.findIndex((t) => t.id === p.id);
      if (at < 0) types.push(p as RawSeed['chestTypes'][number]);
      else types[at] = { ...types[at]!, ...p, values: { ...types[at]!.values, ...p.values } };
    }
    out.chestTypes = types;
  }
  if (pack.levelSchedules) out.levelSchedules = { ...seed.levelSchedules, ...pack.levelSchedules };
  if (pack.regions?.length) {
    const regions = [...seed.regions];
    for (const p of pack.regions) {
      if (!p.id) continue;
      const at = regions.findIndex((r) => r.id === p.id);
      if (at < 0) regions.push(p as RawSeed['regions'][number]);
      else regions[at] = { ...regions[at]!, ...p, areas: mergeAreas(regions[at]!.areas, p.areas ?? []) };
    }
    out.regions = regions;
  }
  if (pack.general?.length) {
    const general = [...seed.general];
    for (const p of pack.general) {
      if (!p.id) continue;
      const at = general.findIndex((g) => g.id === p.id);
      if (at < 0) general.push(p as RawSeed['general'][number]);
      else general[at] = { ...general[at]!, ...p };
    }
    out.general = general;
  }
  return out;
}
