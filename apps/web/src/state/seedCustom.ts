// Пользовательские правки регионов (11.1): свои области и категории (`user_entity`, метка `user`),
// переименование и скрытие (`Override`), цены сундуков глобально и на уровне области (11.2).
import {
  applyOverrides,
  clone,
  type Area,
  type CalcContext,
  type CategoryDef,
  type CategoryKind,
  type ChestBracket,
  type ChestType,
  type Editor,
  type Override,
  type Reward,
  type Seed,
} from '@primo/domain';
import type { DocOf } from '@primo/shared';

export interface UserAreaData {
  regionId: string;
  name: string;
  chestBracket: ChestBracket;
}

export interface UserCategoryData {
  areaId: string;
  title: string;
  kind?: CategoryKind;
  editor: Extract<Editor, 'amount' | 'count' | 'checklist' | 'binary'>;
  total: Reward | null;
  unit?: Reward;
  count?: number;
  items?: string[];
  note?: string;
}

const USER_PREFIX = 'user_';

/** Накладывает пользовательские области/категории и Override имён, скрытия на seed. */
export function customizeSeed(seed: Seed, entities: DocOf<'user_entity'>[], overrides: Override[]): Seed {
  const out = clone(seed);
  for (const e of entities) {
    if (e.kind !== 'area') continue;
    const d = e.data as unknown as UserAreaData;
    const region = out.regions.find((r) => r.id === d.regionId);
    if (!region) continue;
    region.areas.push({
      id: e.id,
      regionId: region.id,
      name: d.name,
      chestBracket: d.chestBracket ?? 'high',
      categories: [],
    });
  }
  for (const e of entities) {
    if (e.kind !== 'category') continue;
    const d = e.data as unknown as UserCategoryData;
    const area = out.regions.flatMap((r) => r.areas).find((a) => a.id === d.areaId);
    if (!area) continue;
    const cat: CategoryDef = {
      id: e.id,
      kind: d.kind ?? 'other',
      title: d.title,
      total: d.total,
      editor: d.editor,
      confidence: 'user',
    };
    if (d.unit) cat.unit = d.unit;
    if (d.count !== undefined) cat.count = d.count;
    if (d.items) cat.items = d.items;
    if (d.note) cat.note = d.note;
    area.categories.push(cat);
  }

  const areaOv = overrides.filter((o) => o.entity === 'area');
  const catOv = overrides.filter((o) => o.entity === 'category');
  for (const region of out.regions) {
    region.areas = applyOverrides<Area>('area', region.areas, areaOv);
    for (const area of region.areas) {
      area.categories = applyOverrides<CategoryDef>('category', area.categories, catOv).filter(
        (c) => !(c as CategoryDef & { hidden?: boolean }).hidden,
      );
    }
  }
  out.general = applyOverrides('category', out.general, catOv);
  return out;
}

export function isUserEntityId(id: string): boolean {
  return id.startsWith(USER_PREFIX);
}

export function newUserEntityId(kind: 'area' | 'category', parent: string): string {
  return `${USER_PREFIX}${kind}_${parent}_${globalThis.crypto.randomUUID().slice(0, 8)}`;
}

/** Цены сундуков: глобальные Override (`chestType`) и затем Override области (`areaChestType`, id `<area>/<type>`). */
export function chestTypesForArea(global: ChestType[], areaId: string, overrides: Override[]): ChestType[] {
  const prefix = `${areaId}/`;
  const local = overrides
    .filter((o) => o.entity === 'areaChestType' && o.id.startsWith(prefix))
    .map((o) => ({ ...o, entity: 'chestType', id: o.id.slice(prefix.length) }));
  return local.length ? applyOverrides('chestType', global, local) : global;
}

export function areaContext(base: CalcContext, areaId: string, overrides: Override[]): CalcContext {
  const chestTypes = chestTypesForArea(base.chestTypes, areaId, overrides);
  return chestTypes === base.chestTypes ? base : { ...base, chestTypes };
}

/** Прогресс категорий, которых больше нет в данных, — «устарела» (раздел 16). */
export function orphanProgress(seed: Seed, progressIds: string[]): string[] {
  const known = new Set<string>([
    ...seed.regions.flatMap((r) => r.areas.flatMap((a) => a.categories.map((c) => c.id))),
    ...seed.general.map((g) => g.id),
  ]);
  return progressIds.filter((id) => !known.has(id));
}
