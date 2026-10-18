import { describe, expect, it } from 'vitest';
import {
  addChest,
  areaSummary,
  categorySummary,
  chestButtons,
  clampLevel,
  collected,
  effectiveProgress,
  findArea,
  findCategory,
  levelKeys,
  normalizeSeed,
  progressDelta,
  type CalcContext,
  type RawSeed,
  undoLastChest,
} from './regions';
import { seed as seedJson } from './test/fixtures';
import type { Area, CategoryProgress, ChestType } from './types';

const seed = normalizeSeed(seedJson as unknown as RawSeed);
const ctx: CalcContext = { chestTypes: seed.chestTypes, schedules: seed.schedules };
const AT = '2026-10-19T05:00:00Z';
const open = { closed: false, chests100: false };

const area = (id: string) => findArea(seed, id)!;
const cat = (id: string) => findCategory(seed, id)!;
const chest = (id: string) => seed.chestTypes.find((t) => t.id === id)!;
const progress = (categoryId: string, p: Partial<CategoryProgress> = {}): CategoryProgress => ({
  categoryId,
  updatedAt: AT,
  ...p,
});

function clickChest(
  p: CategoryProgress,
  a: Area,
  type: ChestType,
  variant: 'low' | 'high' | number,
  times = 1,
) {
  let next = p;
  for (let i = 0; i < times; i++) next = addChest(next, a, type, variant, 1, AT);
  return next;
}

describe('regions: seed (11.1)', () => {
  it('id категорий детерминированы: `${areaId}:${kind}`, повтор kind — суффикс', () => {
    const ids = area('snezhnaya_general').categories.map((c) => c.id);
    expect(ids).toEqual([
      'snezhnaya_general:archon_quests',
      'snezhnaya_general:archon_quests_2',
      'snezhnaya_general:side_quests',
      'snezhnaya_general:waypoints',
      'snezhnaya_general:statue',
      'snezhnaya_general:shrines',
      'snezhnaya_general:offering',
      'snezhnaya_general:other',
      'snezhnaya_general:shadow_realm',
      'snezhnaya_general:shadow_realm_2',
      'snezhnaya_general:offering_2',
      'snezhnaya_general:shadow_realm_3',
    ]);
    expect(area('snezhnaya_general').regionId).toBe('snezhnaya');
    expect(seed.general.map((g) => g.id)).toContain('general:teapot');
  });

  it('порядок регионов — как в видео', () => {
    expect(seed.regions.map((r) => r.id)).toEqual([
      'mondstadt',
      'liyue',
      'inazuma',
      'sumeru',
      'fontaine',
      'natlan',
      'nodkrai',
      'snezhnaya',
      'contested',
    ]);
  });
});

describe('regions: сундуки (11.2)', () => {
  const mond = area('mondstadt_main');
  const chestsCat = cat('mondstadt_main:chests');

  it('кнопки по типу: mixed — low и high; high — только high; роскошный — +10 и +40 везде', () => {
    expect(chestButtons(chest('common'), 'mixed')).toEqual([
      { variant: 'low', price: 0 },
      { variant: 'high', price: 2 },
    ]);
    expect(chestButtons(chest('common'), 'high')).toEqual([{ variant: 'high', price: 2 }]);
    expect(chestButtons(chest('luxurious'), 'mixed')).toEqual([
      { variant: 10, price: 10 },
      { variant: 40, price: 40 },
    ]);
    expect(chestButtons(chest('luxurious'), 'high')).toEqual(chestButtons(chest('luxurious'), 'low'));
  });

  it('TC-15: mondstadt_main, «Богатый low +2» × 3 и «Драгоценный high +10» × 1 → 16, остаток 771', () => {
    let p = progress(chestsCat.id);
    p = clickChest(p, mond, chest('exquisite'), 'low', 3);
    p = clickChest(p, mond, chest('precious'), 'high', 1);
    const s = categorySummary(chestsCat, p, open, ctx);
    expect(s.collected).toEqual({ primo: 16 });
    expect(s.remaining).toEqual({ primo: 771 });
  });

  it('TC-16: «Сундуки 100%» → 787, снять → снова 16, счётчики по типам целы', () => {
    let p = progress(chestsCat.id);
    p = clickChest(p, mond, chest('exquisite'), 'low', 3);
    p = clickChest(p, mond, chest('precious'), 'high', 1);
    expect(collected(chestsCat, p, { closed: false, chests100: true }, ctx)).toEqual({ primo: 787 });
    expect(collected(chestsCat, p, open, ctx)).toEqual({ primo: 16 });
    expect(p.chestCounts).toEqual({ exquisite: { low: 3 }, precious: { high: 1 } });
  });

  it('TC-16a: роскошный «+10» × 1 и «+40» × 2 → +90; «отменить последнее» снимает одно «+40»', () => {
    let p = progress(chestsCat.id);
    p = clickChest(p, mond, chest('luxurious'), 10, 1);
    p = clickChest(p, mond, chest('luxurious'), 40, 2);
    expect(collected(chestsCat, p, open, ctx)).toEqual({ primo: 90 });
    expect(p.chestCounts).toEqual({ luxurious: { '10': 1, '40': 2 } });

    p = undoLastChest(p);
    expect(p.chestCounts).toEqual({ luxurious: { '10': 1, '40': 1 } });
    expect(collected(chestsCat, p, open, ctx)).toEqual({ primo: 50 });
    expect(p.chestLog).toHaveLength(2);
  });

  it('кнопка, которой нет в области, отклоняется; счётчик не уходит ниже 0', () => {
    const windpeak = area('mondstadt_windpeak');
    const p = progress('mondstadt_windpeak:chests');
    expect(() => addChest(p, windpeak, chest('common'), 'low', 1, AT)).toThrow();
    expect(addChest(p, windpeak, chest('common'), 'high', -1, AT)).toEqual(p);
  });

  it('журнал отмены хранит последние 50 нажатий', () => {
    const p = clickChest(progress(chestsCat.id), mond, chest('common'), 'high', 60);
    expect(p.chestLog).toHaveLength(50);
    expect(p.chestCounts).toEqual({ common: { high: 60 } });
  });
});

describe('regions: уровни (11.2, B.4)', () => {
  it('TC-17: статуя Натлана ур. 7 → 600 primo + 3 AF', () => {
    const c = cat('natlan_main:statue');
    expect(collected(c, progress(c.id, { levels: [7] }), open, ctx)).toEqual({ primo: 600, af: 3 });
  });

  it('TC-18: Пламя Тоны ур. 9 → 450 primo + 4 AF', () => {
    const c = cat('natlan_main:offering');
    expect(c.schedule).toBe('tona_50');
    expect(collected(c, progress(c.id, { levels: [9] }), open, ctx)).toEqual({ primo: 450, af: 4 });
  });

  it('TC-19: места встреч × 6, уровни [5, 5, 3, 0, 0, 0] → 650 primo + 5 AF', () => {
    const c = cat('nodkrai_main:offering');
    expect(c.multiplier).toBe(6);
    expect(collected(c, progress(c.id, { levels: [5, 5, 3, 0, 0, 0] }), open, ctx)).toEqual({
      primo: 650,
      af: 5,
    });
  });

  it('TC-27: autoApply — статуя Натлана 0 → 4: +300 primo +1 AF; 4 → 3: −100 primo', () => {
    const c = cat('natlan_main:statue');
    const p0 = progress(c.id, { levels: [0] });
    const p4 = progress(c.id, { levels: [4] });
    const p3 = progress(c.id, { levels: [3] });
    expect(progressDelta(c, p0, p4, open, open, ctx)).toEqual({ primo: 300, af: 1 });
    expect(progressDelta(c, p4, p3, open, open, ctx)).toEqual({ primo: -100 });
  });

  it('ключи уровней — справочно, в примогемы не входят', () => {
    const c = cat('natlan_main:statue');
    expect(levelKeys(c, progress(c.id, { levels: [10] }), open, ctx)).toBe(6);
  });
});

describe('regions: ввод суммой, количеством, галочками', () => {
  it('TC-23: сайд-квесты Мондштадта 200 при итоге 160 — предупреждение, собрано 200, остаток 0', () => {
    const c = cat('mondstadt_main:side_quests');
    const s = categorySummary(c, progress(c.id, { amount: { primo: 200 } }), open, ctx);
    expect(s.overTotal).toBe(true);
    expect(s.collected).toEqual({ primo: 200 });
    expect(s.remaining).toEqual({});
  });

  it('count: штуки × единица; checklist: отмеченные × единица; binary: итог или 0', () => {
    const wp = cat('mondstadt_main:waypoints');
    expect(collected(wp, progress(wp.id, { count: 7 }), open, ctx)).toEqual({ primo: 35 });
    const dom = cat('mondstadt_main:domains');
    expect(
      collected(dom, progress(dom.id, { checked: ['Temple of the Lion', "Eagle's Gate"] }), open, ctx),
    ).toEqual({
      primo: 80,
    });
    const handbook = seed.general.find((g) => g.id === 'general:handbook')!;
    expect(collected(handbook, progress(handbook.id, { done: true }), open, ctx)).toEqual({
      primo: 900,
      if: 46,
      af: 3,
    });
  });

  it('count без единицы в данных: единица = итог / число, полный счётчик = итог (бездна 1–8)', () => {
    const corridor = seed.general.find((g) => g.id === 'general:abyss_corridor')!;
    expect(collected(corridor, progress(corridor.id, { count: 1 }), open, ctx)).toEqual({ primo: 300 });
    expect(collected(corridor, progress(corridor.id, { count: 8 }), open, ctx)).toEqual({ primo: 2405 });
  });

  it('чайник: уровни прямо в источнике, 60 за ранг', () => {
    const teapot = seed.general.find((g) => g.id === 'general:teapot')!;
    expect(collected(teapot, progress(teapot.id, { levels: [4] }), open, ctx)).toEqual({ primo: 240 });
  });
});

describe('regions: области и флаги (11.3, 11.4)', () => {
  it('TC-25: sumeru_main — Σ категорий = итог видео 12 821, бейджа нет; без статуи — бейдж', () => {
    const sumeru = area('sumeru_main');
    const s = areaSummary(sumeru, {}, undefined, false, ctx);
    expect(s.sumOfCategories).toEqual({ primo: 12821, if: 10, af: 20 });
    expect(s.total).toEqual(sumeru.videoTotal);
    expect(s.badge).toBe(false);

    const withoutStatue: Area = {
      ...sumeru,
      categories: sumeru.categories.filter((c) => c.kind !== 'statue'),
    };
    expect(areaSummary(withoutStatue, {}, undefined, false, ctx).badge).toBe(true);
  });

  it('TC-26: «Область закрыта» на dragonspine, затем снять', () => {
    const dragonspine = area('dragonspine');
    const tree = cat('dragonspine:offering');
    const wp = cat('dragonspine:waypoints');
    const quests = cat('dragonspine:side_quests');
    const p = {
      [tree.id]: progress(tree.id, { levels: [3] }),
      [wp.id]: progress(wp.id, { count: 5 }),
      [quests.id]: progress(quests.id, { amount: { primo: 100 } }),
    };
    const closed = { closed: true, chests100: false };
    expect(effectiveProgress(tree, p[tree.id], closed, ctx).levels).toEqual([12]);
    expect(effectiveProgress(wp, p[wp.id], closed, ctx).count).toBe(13);
    expect(effectiveProgress(quests, p[quests.id], closed, ctx).amount).toEqual({ primo: 270 });

    const state = { areaId: dragonspine.id, chests100: false, closed: true, plan: { kind: 'none' as const } };
    expect(areaSummary(dragonspine, p, state, false, ctx).remaining).toEqual({});

    expect(effectiveProgress(tree, p[tree.id], open, ctx).levels).toEqual([3]);
    expect(effectiveProgress(wp, p[wp.id], open, ctx).count).toBe(5);
    expect(effectiveProgress(quests, p[quests.id], open, ctx).amount).toEqual({ primo: 100 });
  });

  it('«Регион закрыт» закрывает все области региона', () => {
    const s = areaSummary(area('chasm'), {}, undefined, true, ctx);
    expect(s.closed).toBe(true);
    expect(s.remaining).toEqual({});
    expect(s.collected).toEqual({ primo: 1465, if: 2, af: 4 });
  });
});

describe('regions: Снежная и «доступно сейчас» (TC-38, TC-39)', () => {
  const snezh = area('snezhnaya_general');

  it('TC-38: статуя 900 + 1 AF, сейчас (ур. ≤ 6) 500 + 1 AF', () => {
    const s = categorySummary(cat('snezhnaya_general:statue'), undefined, open, ctx);
    expect(s.total).toEqual({ primo: 900, af: 1 });
    expect(s.nowTotal).toEqual({ primo: 500, af: 1 });
  });

  it('TC-38: места встреч × 3 = 750 + 6 AF и 3 ключа', () => {
    const c = cat('snezhnaya_general:offering');
    const full = progress(c.id, { levels: [5, 5, 5] });
    expect(collected(c, full, open, ctx)).toEqual({ primo: 750, af: 6 });
    expect(levelKeys(c, full, open, ctx)).toBe(3);
  });

  it('TC-38: разломы 5 × 20 = 100', () => {
    const c = cat('snezhnaya_general:shadow_realm_2');
    expect(collected(c, progress(c.id, { checked: c.items }), open, ctx)).toEqual({ primo: 100 });
  });

  it('TC-38: Горнило — испытание на 200 000 очков → 30, все три → 90', () => {
    const c = cat('snezhnaya_general:offering_2');
    expect(c.schedule).toBe('crucible_4');
    expect(collected(c, progress(c.id, { levels: [2, 0, 0] }), open, ctx)).toEqual({ primo: 30 });
    expect(collected(c, progress(c.id, { levels: [2, 2, 2] }), open, ctx)).toEqual({ primo: 90 });
  });

  it('TC-38: анализатор ур. 5 = 1 AF', () => {
    const c = cat('snezhnaya_general:shadow_realm');
    expect(collected(c, progress(c.id, { levels: [5] }), open, ctx)).toEqual({ af: 1 });
  });

  it('TC-38: «Снежная: общее» = 3 655 + 4 IF + 8 AF, сейчас 3 255', () => {
    const s = areaSummary(snezh, {}, undefined, false, ctx);
    expect(s.total).toEqual({ primo: 3655, if: 4, af: 8 });
    expect(s.remaining).toEqual({ primo: 3655, if: 4, af: 8 });
    expect(s.remainingNow).toEqual({ primo: 3255, if: 4, af: 8 });
    expect(s.later).toEqual({ primo: 400 });
  });

  it('TC-39: статуя Снежной, maxLevelNow 6 — степпер до 6, «Область закрыта» → ур. 6, в прогноз 500 + 1 AF', () => {
    const c = cat('snezhnaya_general:statue');
    expect(clampLevel(c, 9, ctx)).toBe(6);
    expect(clampLevel(c, -1, ctx)).toBe(0);
    const closed = { closed: true, chests100: false };
    expect(effectiveProgress(c, undefined, closed, ctx).levels).toEqual([6]);

    const s = categorySummary(c, undefined, closed, ctx);
    expect(s.collected).toEqual({ primo: 500, af: 1 });
    expect(s.remainingNow).toEqual({});
    expect(s.later).toEqual({ primo: 400 });
    const fresh = categorySummary(c, undefined, open, ctx);
    expect(fresh.remainingNow).toEqual({ primo: 500, af: 1 });
  });

  it('категории с неизвестной суммой помечены unknown', () => {
    expect(categorySummary(cat('snezhnaya_general:side_quests'), undefined, open, ctx).unknown).toBe(true);
    expect(categorySummary(cat('snezhnaya_general:statue'), undefined, open, ctx).unknown).toBe(false);
  });
});
