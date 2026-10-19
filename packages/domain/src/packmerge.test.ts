import { describe, expect, it } from 'vitest';
import type { RawDatapack } from './datapack';
import { applySeedPatch, mergePacks } from './packmerge';
import { normalizeSeed, type RawSeed } from './regions';
import { datapack, seed as seedJson } from './test/fixtures';

const pack = datapack as unknown as RawDatapack;
const seed = seedJson as unknown as RawSeed;

describe('мердж датапаков (16)', () => {
  it('новый пак важнее старого; чего нет в новом — остаётся из старого', () => {
    const [first, ...rest] = pack.versions;
    const older: RawDatapack = { ...pack, versions: [{ ...first!, id: '6.9' } as never, ...pack.versions] };
    const newer: RawDatapack = { ...pack, packVersion: pack.packVersion + 1, versions: [first!, ...rest] };
    const merged = mergePacks(newer, older);
    expect(merged.packVersion).toBe(pack.packVersion + 1);
    expect(merged.versions.map((v) => v.id)).toEqual([...pack.versions.map((v) => v.id), '6.9']);
    expect(mergePacks(newer, null)).toBe(newer);
  });
});

describe('патчи регионов из пака поверх seed (16)', () => {
  it('категория по ключу kind, новая область, цена сундука и таблица уровней', () => {
    const region = seed.regions[0]!;
    const area = region.areas[0]!;
    const cat = area.categories[0]!;
    const chest = seed.chestTypes[0]!;
    const patched = applySeedPatch(seed, {
      regions: [
        {
          id: region.id,
          areas: [
            { id: area.id, categories: [{ ...cat, title: 'Исправлено' }] } as never,
            { id: 'new_area', name: 'Новая', chestBracket: 'high', categories: [] } as never,
          ],
        },
      ],
      chestTypes: [{ id: chest.id, values: { low: chest.values.low, high: 999 } }],
    });
    const n = normalizeSeed(patched);
    const r = n.regions.find((x) => x.id === region.id)!;
    expect(r.areas.find((a) => a.id === area.id)!.categories[0]!.title).toBe('Исправлено');
    expect(r.areas.find((a) => a.id === area.id)!.categories).toHaveLength(area.categories.length);
    expect(r.areas.some((a) => a.id === 'new_area')).toBe(true);
    expect(n.chestTypes.find((t) => t.id === chest.id)!.values).toEqual({ low: chest.values.low, high: 999 });
    // исходный seed не изменился
    expect(seed.chestTypes[0]!.values.high).toBe(chest.values.high);
    expect(applySeedPatch(seed, {})).toEqual(seed);
  });
});
