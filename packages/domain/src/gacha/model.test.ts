import { describe, expect, it } from 'vitest';
import {
  CHAR4_RAMP,
  CHAR5_RAMP,
  FATE_POINT_LIMIT,
  FATE_POINT_MAX,
  featuredWinChance,
  makeModel,
  rampChance,
  rampTable,
  resolveFiftyFifty,
  startFatePoint,
  startRadiance,
  WEAPON4_RAMP,
  WEAPON5_RAMP,
  weaponStandardShare,
} from './model';

const pct = (x: number) => Math.round(x * 1000) / 10;

describe('gacha/model: мягкий гарант (13.2)', () => {
  it('p(n) = base до start, base + step × (n − start + 1) до hard, 100% на hard', () => {
    const r = { base: 0.01, start: 5, step: 0.2, hard: 10 };
    expect(rampChance(r, 1)).toBe(0.01);
    expect(rampChance(r, 4)).toBe(0.01);
    expect(rampChance(r, 5)).toBeCloseTo(0.21, 12);
    expect(rampChance(r, 8)).toBeCloseTo(0.81, 12);
    expect(rampChance(r, 9)).toBe(1); // 1,01 → не больше 100%
    expect(rampChance(r, 10)).toBe(1);
    expect(rampChance(r, 11)).toBe(1); // перенос 4★ после 5★ — тоже 100%
  });

  it('коэффициенты «Сообщества» дают таблицу 13.2.3', () => {
    expect(CHAR5_RAMP).toEqual({ base: 0.006, start: 74, step: 0.06, hard: 90 });
    expect(WEAPON5_RAMP).toEqual({ base: 0.007, start: 63, step: 0.07, hard: 80 });
    expect(CHAR4_RAMP).toEqual({ base: 0.051, start: 9, step: 0.51, hard: 10 });
    expect(WEAPON4_RAMP).toEqual({ base: 0.06, start: 8, step: 0.6, hard: 9 });

    const c = [73, 74, 75, 80, 85, 86, 89, 90].map((n) => pct(rampChance(CHAR5_RAMP, n)));
    expect(c).toEqual([0.6, 6.6, 12.6, 42.6, 72.6, 78.6, 96.6, 100]);
    const w = [62, 63, 64, 70, 73, 74, 76, 77, 80].map((n) => pct(rampChance(WEAPON5_RAMP, n)));
    expect(w).toEqual([0.7, 7.7, 14.7, 56.7, 77.7, 84.7, 98.7, 100, 100]);
    // 4★: персонаж 9-я — 56,1%, 10-я — 100%; оружие 8-я — 66%, 9-я — 100% (13.2.2)
    expect(pct(rampChance(CHAR4_RAMP, 8))).toBe(5.1);
    expect(pct(rampChance(CHAR4_RAMP, 9))).toBe(56.1);
    expect(rampChance(CHAR4_RAMP, 10)).toBe(1);
    expect(pct(rampChance(WEAPON4_RAMP, 8))).toBe(66);
    expect(rampChance(WEAPON4_RAMP, 9)).toBe(1);
  });

  it('rampTable: индекс — номер крутки, последний элемент — hard = 1', () => {
    const t = rampTable(CHAR5_RAMP);
    expect(t.length).toBe(91);
    expect(t[1]).toBe(0.006);
    expect(t[74]).toBeCloseTo(0.066, 12);
    expect(t[90]).toBe(1);
  });
});

describe('gacha/model: пресеты (13.2.2, 13.3)', () => {
  it('«Сообщество» / «Подгонка» / «Поздний» отличаются только стартом оружейного мягкого гаранта', () => {
    const community = makeModel('community');
    expect(community).toEqual({
      softPreset: 'community',
      char5: CHAR5_RAMP,
      weapon5: WEAPON5_RAMP,
      char4: CHAR4_RAMP,
      weapon4: WEAPON4_RAMP,
      fiftyFifty: 'radiance',
      epitomized: '5.0+',
      weaponChosen: 0.375,
      weaponOtherFeatured: 0.375,
    });
    expect(makeModel('fit_consolidated').weapon5).toEqual({ ...WEAPON5_RAMP, start: 64 });
    expect(makeModel('late_weapon').weapon5).toEqual({ ...WEAPON5_RAMP, start: 65 });
    for (const p of ['fit_consolidated', 'late_weapon', 'custom'] as const) {
      expect(makeModel(p).char5).toEqual(CHAR5_RAMP);
    }
    expect(makeModel('custom').softPreset).toBe('custom');
  });

  it('пресеты не делят объекты: правка «Своих» не трогает константы', () => {
    const m = makeModel('custom');
    m.char5.start = 70;
    expect(CHAR5_RAMP.start).toBe(74);
    expect(makeModel('community').char5.start).toBe(74);
  });

  it('50/50 и путь судьбы; `official_radiance` из TC-29/TC-32 = сияние с рампами «Сообщества»', () => {
    expect(resolveFiftyFifty('official_radiance')).toBe('radiance');
    expect(resolveFiftyFifty('classic')).toBe('classic');
    const official = makeModel('community', { fiftyFifty: 'official_radiance' });
    expect(official).toEqual(makeModel('community'));
    expect(makeModel('community', { fiftyFifty: 'classic', epitomized: '1.x' })).toMatchObject({
      fiftyFifty: 'classic',
      epitomized: '1.x',
    });
    expect(featuredWinChance('radiance')).toBe(0.53);
    expect(featuredWinChance('classic')).toBe(0.5);
    expect(FATE_POINT_MAX).toEqual({ '5.0+': 1, '2.0-4.8': 2, '1.x': 0 });
    expect(weaponStandardShare(makeModel())).toBe(0.25);
  });
});

describe('gacha/model: стартовое состояние выбора 5★ (D-915, D-919)', () => {
  it('счётчик сияния: при сиянии — как есть (0…3), в «Классике» счётчика нет — 0', () => {
    for (const c of [0, 1, 2, 3]) {
      expect(startRadiance('radiance', c)).toBe(c);
      expect(startRadiance('classic', c)).toBe(0);
    }
    // за пределами 0…3 — прижатие (ввод это отсекает, но МК и точный расчёт прижимают одинаково)
    expect(startRadiance('radiance', 5)).toBe(3);
    expect(startRadiance('radiance', -1)).toBe(0);
  });

  it('очко судьбы: прижато к максимуму пути; в «1.x» пути нет — 0; граница ввода — 2', () => {
    expect(FATE_POINT_LIMIT).toBe(2);
    expect([0, 1, 2].map((v) => startFatePoint('5.0+', v))).toEqual([0, 1, 1]);
    expect([0, 1, 2].map((v) => startFatePoint('2.0-4.8', v))).toEqual([0, 1, 2]);
    expect([0, 1, 2].map((v) => startFatePoint('1.x', v))).toEqual([0, 0, 0]);
    expect(startFatePoint('2.0-4.8', -1)).toBe(0);
  });
});
