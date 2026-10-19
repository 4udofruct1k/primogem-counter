// Регрессии по аудиту веба: даты в зоне устройства, виртуальная луна, своя цена сундуков области.
import { addChest, chestButtons, regionSummary } from '@primo/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { loadGameData } from '../data/gamedata';
import { PrimoDB } from '../data/db';
import { makeHarness } from '../test/harness';
import { date, dateTime, isIso, localDayToIso } from '../ui/format';
import { createActions } from './actions';
import { makeBackup, readBackup } from './backup';
import { computeModel, DEFAULT_PAYMENT } from './model';
import { hotItems } from './select';

const TZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = TZ;
});

describe('даты в зоне устройства (I1)', () => {
  it('конец выбранного дня — валидный момент при отрицательном и дробном смещении', () => {
    process.env.TZ = 'America/New_York';
    expect(localDayToIso('2026-12-01', 23, 59)).toBe('2026-12-02T04:59:00Z');
    process.env.TZ = 'Asia/Kolkata';
    expect(localDayToIso('2026-12-01', 23, 59)).toBe('2026-12-01T18:29:00Z');
    expect(localDayToIso('', 23, 59)).toBeNull();
  });

  it('время после перехода на зимнее — со своим смещением', () => {
    process.env.TZ = 'Europe/Berlin';
    // 19.10 — летнее (+2), 04.11 — зимнее (+1)
    expect(dateTime('2026-10-19T10:00:00Z')).toBe('19.10 12:00');
    expect(dateTime('2026-11-03T22:00:00Z')).toBe('03.11 23:00');
    expect(date('2026-11-03T22:00:00Z')).toBe('03.11.2026');
  });

  it('ссылка ?t= принимается только каноническим моментом', () => {
    expect(isIso('2026-12-01T04:59:00Z')).toBe(true);
    expect(isIso('2026-12-01T27:59:00Z')).toBe(false);
    expect(isIso('2026-12-01T17.5:59:00Z')).toBe(false);
  });
});

describe('виртуальная луна — только прогноз', () => {
  it('не горит и не забирается', async () => {
    const h = await makeHarness();
    const actions = createActions(h.store);
    await actions.savePayment({ ...DEFAULT_PAYMENT, welkinPlanned: 'keepActive' });
    const s = h.store.getState();
    const m = computeModel(s.game!, s.docs, s.now, 5);
    const virtual = m.occurrences.find((o) => o.ruleId === 'welkin' && o.virtual)!;
    expect(virtual).toBeTruthy();
    expect(hotItems(m).some((o) => o.virtual)).toBe(false);
    await actions.claim(m, virtual);
    expect(Object.keys(h.store.getState().docs.ledger)).toEqual([]);
    expect(h.store.getState().docs.occ_status[virtual.id]).toBeUndefined();
  });
});

describe('своя цена сундуков области (11.2)', () => {
  it('сводка региона и запись в кошелёк считаются по цене области', async () => {
    const h = await makeHarness();
    const actions = createActions(h.store);
    const s0 = h.store.getState();
    const m0 = computeModel(s0.game!, s0.docs, s0.now, 5);
    const region = m0.seed.regions.find((r) =>
      r.areas.some((a) => a.categories.some((c) => c.kind === 'chests')),
    )!;
    const area = region.areas.find((a) => a.categories.some((c) => c.kind === 'chests'))!;
    const type = m0.calc.chestTypes[0]!;
    for (const field of ['values.low', 'values.high'] as const)
      await actions.putDoc('override', `areaChestType:${area.id}/${type.id}:${field}`, {
        entity: 'areaChestType',
        id: `${area.id}/${type.id}`,
        field,
        value: 1000,
        at: '2026-10-19T05:00:00Z',
      });
    const s = h.store.getState();
    const m = computeModel(s.game!, s.docs, s.now, 5);
    const local = m.ctxForArea(area.id).chestTypes.find((t) => t.id === type.id)!;
    const cat = area.categories.find((c) => c.kind === 'chests')!;
    const [button] = chestButtons(local, area.chestBracket);
    const next = addChest({ categoryId: cat.id, updatedAt: s.now }, area, local, button!.variant, 1, s.now);
    await actions.saveProgress(m, cat, area, next);
    // в кошелёк — цена области (1000), а не глобальная
    const ledger = Object.values(h.store.getState().docs.ledger);
    expect(ledger.map((e) => e.delta.primo)).toEqual([1000]);
    const s2 = h.store.getState();
    const m2 = computeModel(s2.game!, s2.docs, s2.now, 5);
    const progress = s2.docs.cat_progress as never;
    const withArea = regionSummary(region, progress, {}, false, m2.calc, m2.ctxForArea);
    const global = regionSummary(region, progress, {}, false, m2.calc);
    expect((withArea.collected.primo ?? 0) - (global.collected.primo ?? 0)).toBe(
      1000 - chestButtons(type, area.chestBracket).find((b) => b.variant === button!.variant)!.price,
    );
  });
});

describe('бэкап и импорт (10.10)', () => {
  it('бэкап гостя импортируется в чистый браузер, мусор пропускается', async () => {
    const a = await makeHarness();
    await createActions(a.store).manualEntry({ primo: 160 });
    await createActions(a.store).saveSettings({ server: 'asia' });
    const file = makeBackup(a.store.getState().docs, '2026-10-19T05:00:00Z');
    const text = JSON.stringify({
      ...file,
      docs: [
        ...file.docs,
        { collection: 'nope', id: 'x', data: {} },
        { collection: 'ledger', id: 'bad', data: { at: 1 } },
      ],
    });
    const parsed = readBackup(text);
    if ('error' in parsed) throw new Error(parsed.error);
    expect(parsed.skipped).toBe(2);
    const b = await makeHarness();
    await b.store.getState().write(parsed.writes);
    const docs = b.store.getState().docs;
    expect(Object.values(docs.ledger).map((e) => e.delta.primo)).toEqual([160]);
    expect(docs.settings.main?.server).toBe('asia');
    expect(readBackup('{')).toEqual({ error: 'Это не JSON' });
  });
});

describe('история эндгейма (6, 10.5)', () => {
  it('прошедшие циклы — глубже 42 дней, для «среднего за 3 цикла»', async () => {
    const h = await makeHarness();
    const s = h.store.getState();
    const m = computeModel(s.game!, s.docs, s.now, 5);
    const abyss = m.trackerHistory.filter((o) => o.tracker === 'abyss').map((o) => o.id);
    expect(abyss.length).toBeGreaterThanOrEqual(3);
    expect(m.trackerHistory.every((o) => Date.parse(o.deadline!) <= Date.parse(s.now))).toBe(true);
  });
});

describe('новый датапак мержится со старым (16)', () => {
  it('версия, которой нет в новом паке, остаётся', async () => {
    const datapack = (await import('../../../../data/datapack-2026-10-19.json')).default;
    const seed = (await import('../../../../data/primo_seed_regions.json')).default;
    const older = { ...datapack, versions: [{ ...datapack.versions[0]!, id: '6.9' }, ...datapack.versions] };
    let current: { sha: string; pack: unknown } = { sha: 'a', pack: older };
    const fetchImpl = async (path: string) =>
      new Response(
        JSON.stringify(
          path === '/data/manifest.json'
            ? {
                generatedAt: '2026-10-19T00:00:00Z',
                packVersion: 5,
                seedSchemaVersion: seed.schemaVersion,
                files: {
                  datapack: { path: `/data/pack-${current.sha}.json`, sha256: current.sha },
                  seed: { path: '/data/seed.json', sha256: 's' },
                },
                patch: null,
              }
            : path === '/data/seed.json'
              ? seed
              : current.pack,
        ),
      );
    const db = new PrimoDB(`merge-${Math.random()}`);
    expect((await loadGameData(db, fetchImpl)).datapack.versions.some((v) => v.id === '6.9')).toBe(true);
    current = { sha: 'b', pack: datapack };
    const second = await loadGameData(db, fetchImpl);
    expect(second.datapack.versions.some((v) => v.id === '6.9')).toBe(true);
    expect(second.datapack.versions.length).toBe(datapack.versions.length + 1);
  });
});
