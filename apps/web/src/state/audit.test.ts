// Регрессии по аудиту веба: даты в зоне устройства, виртуальная луна, своя цена сундуков области.
import { addChest, chestButtons, regionSummary } from '@primo/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { makeHarness } from '../test/harness';
import { date, dateTime, isIso, localDayToIso } from '../ui/format';
import { createActions } from './actions';
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
    const next = addChest({ categoryId: cat.id }, area, local, button!.variant, 1, s.now);
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
