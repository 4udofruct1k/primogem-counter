import { describe, expect, it } from 'vitest';
import {
  cdfAt,
  charCopiesDist,
  charEventsPmf,
  consolidatedRate,
  expectedPulls,
  fiveStarPmf,
  longRunWinRate,
  meanOf,
  pullChanceTable,
  weaponCopiesDist,
  weaponEventsPmf,
} from './exact';
import { CHAR4_RAMP, CHAR5_RAMP, makeModel, WEAPON4_RAMP, WEAPON5_RAMP } from './model';
import type { Pity } from '../types';
import { pity } from './test/input';
import type { Ramp } from './types';

const community = makeModel('community');
/** Значение спеки с двумя знаками: |x − v| < 0,01 (спека округляет и вниз, и вверх). */
const near2 = (x: number, v: number) => expect(Math.abs(x - v)).toBeLessThan(0.01);

describe('gacha/exact: одна 5★ и сводные вероятности (13.2.2)', () => {
  it('TC-28: E[круток до 5★] персонажа 62,30 (1,605%), оружия 53,25 (1,878%); 4★ — 13,06% / 14,86%', () => {
    expect(expectedPulls(CHAR5_RAMP)).toBeCloseTo(62.3, 2);
    expect(consolidatedRate(CHAR5_RAMP) * 100).toBeCloseTo(1.605, 3);
    expect(expectedPulls(WEAPON5_RAMP)).toBeCloseTo(53.25, 2);
    expect(consolidatedRate(WEAPON5_RAMP) * 100).toBeCloseTo(1.878, 3);
    expect(consolidatedRate(CHAR4_RAMP) * 100).toBeCloseTo(13.06, 2);
    expect(consolidatedRate(WEAPON4_RAMP) * 100).toBeCloseTo(14.86, 2);
  });

  it('все строки таблиц 13.2.2 (среднее и сводная)', () => {
    const rows: [Ramp, number, number][] = [
      [{ ...CHAR5_RAMP, start: 73 }, 61.67, 1.622],
      [CHAR5_RAMP, 62.3, 1.605],
      [{ ...CHAR5_RAMP, step: 0.05 }, 62.6, 1.597],
      [{ ...CHAR5_RAMP, start: 75 }, 62.92, 1.589],
      [{ ...CHAR5_RAMP, start: 76 }, 63.55, 1.574],
      [{ ...WEAPON5_RAMP, start: 62 }, 52.62, 1.9],
      [WEAPON5_RAMP, 53.25, 1.878],
      [{ ...WEAPON5_RAMP, start: 64 }, 53.88, 1.856],
      [{ ...WEAPON5_RAMP, start: 65 }, 54.5, 1.835],
      [{ ...WEAPON5_RAMP, start: 66 }, 55.12, 1.814],
    ];
    for (const [ramp, mean, rate] of rows) {
      near2(expectedPulls(ramp), mean);
      expect(consolidatedRate(ramp) * 100).toBeCloseTo(rate, 3);
    }
  });

  it('TC-42: пресеты — оружие 1,878 / 1,856 / 1,835%, персонаж во всех 1,605%', () => {
    const rates = (['community', 'fit_consolidated', 'late_weapon'] as const).map((p) => {
      const m = makeModel(p);
      return [consolidatedRate(m.char5) * 100, consolidatedRate(m.weapon5) * 100];
    });
    expect(rates.map(([, w]) => Math.round(w * 1000) / 1000)).toEqual([1.878, 1.856, 1.835]);
    for (const [c] of rates) expect(c).toBeCloseTo(1.605, 3);
  });

  it('распределение до следующей 5★ учитывает текущий pity', () => {
    const fresh = fiveStarPmf(CHAR5_RAMP);
    expect(fresh.length).toBe(91); // индекс — число круток, [0] = 0
    expect(fresh.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
    const p80 = fiveStarPmf(CHAR5_RAMP, 80);
    expect(p80.length).toBe(11); // крутки 81…90
    expect(p80[1]).toBeCloseTo(0.486, 12);
    expect(p80.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
    expect(expectedPulls(CHAR5_RAMP, 89)).toBe(1);
    expect(meanOf(fresh)).toBeCloseTo(expectedPulls(CHAR5_RAMP), 12);
  });
});

describe('gacha/exact: таблица шансов по круткам (13.2.3)', () => {
  const show = (ramp: Ramp, pulls: number[]) => {
    const t = pullChanceTable(ramp);
    return pulls.map((n) => {
      const row = t.find((r) => r.pull === n)!;
      return [Math.round(row.chance * 1000) / 10, Math.round(row.cumulative * 1000) / 10];
    });
  };

  it('персонаж: шанс на крутке и «5★ к этой крутке»', () => {
    const t = pullChanceTable(CHAR5_RAMP);
    expect(t.length).toBe(90);
    expect(t[89]).toEqual({ pull: 90, chance: 1, cumulative: 1 });
    expect(show(CHAR5_RAMP, [73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85])).toEqual([
      [0.6, 35.6],
      [6.6, 39.8],
      [12.6, 47.4],
      [18.6, 57.2],
      [24.6, 67.7],
      [30.6, 77.6],
      [36.6, 85.8],
      [42.6, 91.8],
      [48.6, 95.8],
      [54.6, 98.1],
      [60.6, 99.3],
      [66.6, 99.7],
      [72.6, 99.9],
    ]);
  });

  it('оружие: 100% уже на 77-й (жёсткий гарант 80 не срабатывает), с «Подгонкой» — на 78-й', () => {
    expect(show(WEAPON5_RAMP, [62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73])).toEqual([
      [0.7, 35.3],
      [7.7, 40.3],
      [14.7, 49.1],
      [21.7, 60.1],
      [28.7, 71.6],
      [35.7, 81.7],
      [42.7, 89.5],
      [49.7, 94.7],
      [56.7, 97.7],
      [63.7, 99.2],
      [70.7, 99.8],
      [77.7, 99.9],
    ]);
    expect(pullChanceTable(WEAPON5_RAMP).at(-1)).toEqual({ pull: 77, chance: 1, cumulative: 1 });
    expect(pullChanceTable(makeModel('fit_consolidated').weapon5).at(-1)?.pull).toBe(78);
  });

  it('с ненулевым pity таблица начинается со следующей крутки', () => {
    const t = pullChanceTable(CHAR5_RAMP, 85);
    expect(t.map((r) => r.pull)).toEqual([86, 87, 88, 89, 90]);
    expect(t[0].cumulative).toBeCloseTo(0.786, 12);
  });
});

describe('gacha/exact: 50/50 и «Захват сияния» (13.3.1)', () => {
  it('TC-32: доля выигранных 50/50 в долгую — 55,72% (сияние), 50% (классика)', () => {
    expect(longRunWinRate('radiance') * 100).toBeCloseTo(55.72, 2);
    expect(longRunWinRate('classic')).toBe(0.5);
  });

  it('число 5★ до ивентового: 1 с p 0,53, 2 с p 0,47; с гарантом — ровно 1', () => {
    const q = charEventsPmf('radiance', { guaranteed: false, radiance: 0 }, 1);
    expect(q.length).toBe(3);
    expect(q[1]).toBeCloseTo(0.53, 12);
    expect(q[2]).toBeCloseTo(0.47, 12);
    expect(charEventsPmf('radiance', { guaranteed: true, radiance: 0 }, 1)).toEqual([0, 1]);
    // TC-34: сияние 3 → следующая 5★ ивентовая с вероятностью 1
    expect(charEventsPmf('radiance', { guaranteed: false, radiance: 3 }, 1)).toEqual([0, 1]);
    expect(charEventsPmf('classic', { guaranteed: false, radiance: 3 }, 1)).toEqual([0, 0.5, 0.5]);
  });

  it('TC-29: P(C0 ≤ N), pity 0, без гаранта, сияние 0', () => {
    const d = charCopiesDist(community, pity(), 1);
    const at = (n: number) => Math.round(cdfAt(d, n) * 10000) / 10000;
    expect([74, 80, 90, 120, 150, 180].map(at)).toEqual([0.2454, 0.5347, 0.6183, 0.7227, 0.8122, 1]);
    expect(d.worstCase).toBe(180);
    expect(cdfAt(d, 179)).toBeLessThan(1);
  });

  it('TC-30: среднее число круток до C0 — 91,58 (= 62,30 × 1,47)', () => {
    expect(charCopiesDist(community, pity(), 1).mean).toBeCloseTo(91.58, 2);
  });

  it('TC-33: бюджет 160, pity 20, без гаранта → C0 гарантирована, худший случай ровно 160', () => {
    const d = charCopiesDist(community, pity({ char: 20 }), 1);
    expect(d.worstCase).toBe(160);
    expect(cdfAt(d, 160)).toBeCloseTo(1, 12);
    expect(cdfAt(d, 159)).toBeLessThan(1);
    expect(d.pmf[160]).toBeGreaterThan(0);
  });

  it('C6 — 7 копий: сияние экономит 5★, худший случай 13 × 90 = 1170 (без сияния 14 × 90)', () => {
    const q = charEventsPmf('radiance', { guaranteed: false, radiance: 0 }, 7);
    expect(meanOf(q)).toBeLessThan(7 * 1.47);
    expect(q.length - 1).toBe(13); // 3 проигрыша + «Захват сияния» + 3 проигрыша
    const d = charCopiesDist(community, pity(), 7);
    expect(d.mean).toBeCloseTo(meanOf(q) * expectedPulls(CHAR5_RAMP), 9);
    expect(d.worstCase).toBe(1170);
    expect(d.truncated).toBeLessThan(1e-12);
    const classic = charCopiesDist(makeModel('community', { fiftyFifty: 'classic' }), pity(), 7);
    expect(classic.mean).toBeCloseTo(7 * 1.5 * expectedPulls(CHAR5_RAMP), 9);
    expect(classic.worstCase).toBe(1260);
  });
});

describe('gacha/exact: оружейный путь (13.3.3)', () => {
  const E = (path: '5.0+' | '2.0-4.8' | '1.x', guaranteed = false) => {
    const q = weaponEventsPmf(makeModel('community', { epitomized: path }), { guaranteed, fatePoint: 0 }, 1);
    return meanOf(q);
  };

  it('среднее число 5★ до выбранного: 1,625 / 1,984 / 2,5; с гарантом 75/25 при «5.0+» — 1,5', () => {
    expect(E('5.0+')).toBeCloseTo(1.625, 12);
    expect(E('2.0-4.8')).toBeCloseTo(1.984375, 12);
    expect(E('1.x')).toBeCloseTo(2.5, 10);
    expect(E('5.0+', true)).toBeCloseTo(1.5, 12);
  });

  it('TC-31: среднее до R1 («Сообщество», «5.0+», pity 0) — 86,53 = 53,25 × 1,625', () => {
    const d = weaponCopiesDist(community, pity(), 1);
    near2(d.mean, 86.53);
    expect(d.mean).toBeCloseTo(expectedPulls(WEAPON5_RAMP) * 1.625, 10);
    expect(d.worstCase).toBe(154); // 2 × 77: шанс 100% уже на 77-й
  });

  it('TC-41: «2.0–4.8» — 105,67; «1.x» — 133,12; «5.0+» с гарантом 75/25 — 79,88', () => {
    near2(weaponCopiesDist(makeModel('community', { epitomized: '2.0-4.8' }), pity(), 1).mean, 105.67);
    near2(weaponCopiesDist(makeModel('community', { epitomized: '1.x' }), pity(), 1).mean, 133.12);
    near2(weaponCopiesDist(community, pity({ weaponGuaranteed: true }), 1).mean, 79.88);
  });

  it('худший случай по жёсткому гаранту: 160 / 240 / не ограничен', () => {
    const flat = { ...WEAPON5_RAMP, step: 0 }; // без мягкого гаранта — до 80-й
    const worst = (path: '5.0+' | '2.0-4.8' | '1.x') =>
      weaponCopiesDist({ ...makeModel('custom', { epitomized: path }), weapon5: flat }, pity(), 1).worstCase;
    expect(worst('5.0+')).toBe(160);
    expect(worst('2.0-4.8')).toBe(240);
    expect(worst('1.x')).toBeNull();
  });

  it('TC-37: очко судьбы 1 → следующая 5★ — выбранное', () => {
    expect(weaponEventsPmf(community, { guaranteed: false, fatePoint: 1 }, 1)).toEqual([0, 1]);
    const d = weaponCopiesDist(community, pity({ weapon: 10, weaponFatePoint: 1 }), 1);
    expect(d.worstCase).toBe(67);
    expect(d.mean).toBeCloseTo(expectedPulls(WEAPON5_RAMP, 10), 10);
  });

  it('«1.x» без конца: распределение обрезано, потерянная масса ничтожна', () => {
    const d = weaponCopiesDist(makeModel('community', { epitomized: '1.x' }), pity(), 1);
    expect(d.truncated).toBeLessThan(1e-9);
    expect(cdfAt(d, 10_000)).toBeCloseTo(1, 9);
  });
});

describe('gacha/exact: неверный ввод — RangeError, прижатие — как в Монте-Карло (D-915, D-919)', () => {
  const throws = (f: () => unknown, message: string) => expect(f).toThrow(new RangeError(message));
  /** Счётчик сияния вне типа 0 | 1 | 2 | 3 — как из непроверенных данных. */
  const radiance = (v: number) => v as Pity['radiance'];

  it('charCopiesDist: pity 5★, сияние, копии C0…C6, предел круток, рампа', () => {
    const char = 'Pity персонажа — целое от 0 до 89';
    throws(() => charCopiesDist(community, pity({ char: -1 }), 1), char);
    throws(() => charCopiesDist(community, pity({ char: 1.5 }), 1), char);
    throws(() => charCopiesDist(community, pity({ char: 90 }), 1), char);
    const r = 'Счётчик сияния — целое от 0 до 3';
    throws(() => charCopiesDist(community, pity({ radiance: radiance(4) }), 1), r);
    throws(() => charCopiesDist(community, pity({ radiance: radiance(1.5) }), 1), r);
    const copies = 'Копий персонажа — целое от 1 до 7';
    for (const c of [0, 8, 1.5, NaN]) throws(() => charCopiesDist(community, pity(), c), copies);
    const limit = 'Предел круток — целое число не меньше 0';
    for (const n of [-1, 1.5, NaN]) throws(() => charCopiesDist(community, pity(), 1, n), limit);
    const ramp = { ...community, char5: { ...CHAR5_RAMP, hard: 0 } };
    throws(() => charCopiesDist(ramp, pity(), 1), 'Модель char5: hard — целое от 1 до 1000');
    // раньше NaN зацикливал fiveStarPmf
    throws(() => charCopiesDist(community, pity({ char: NaN }), 1), char);
  });

  it('weaponCopiesDist: pity 5★, очко судьбы, копии R1…R5, доли оружия', () => {
    const weapon = 'Pity оружия — целое от 0 до 79';
    throws(() => weaponCopiesDist(community, pity({ weapon: 80 }), 1), weapon);
    throws(() => weaponCopiesDist(community, pity({ weapon: -1 }), 1), weapon);
    const fate = 'Очко судьбы — целое от 0 до 2';
    for (const v of [3, 0.5, -1])
      throws(() => weaponCopiesDist(community, pity({ weaponFatePoint: v }), 1), fate);
    const copies = 'Копий оружия — целое от 1 до 5';
    for (const c of [0, 6, 2.5]) throws(() => weaponCopiesDist(community, pity(), c), copies);
    const shares = { ...community, weaponChosen: 0 };
    throws(() => weaponCopiesDist(shares, pity(), 1), 'Доли оружия: выбранное > 0, выбранное + второе ≤ 1');
    throws(() => weaponCopiesDist(community, pity({ weapon: NaN }), 1), weapon);
  });

  it('цепочки исходов и одна 5★: сияние, очко, копии, pity', () => {
    throws(
      () => charEventsPmf('radiance', { guaranteed: false, radiance: 2.5 }, 1),
      'Счётчик сияния — целое от 0 до 3',
    );
    throws(
      () => charEventsPmf('radiance', { guaranteed: false, radiance: 0 }, 0),
      'Копий персонажа — целое от 1 до 7',
    );
    throws(
      () => weaponEventsPmf(community, { guaranteed: false, fatePoint: 1.5 }, 1),
      'Очко судьбы — целое от 0 до 2',
    );
    throws(
      () => weaponEventsPmf(community, { guaranteed: false, fatePoint: 0 }, 0),
      'Копий оружия — целое от 1 до 5',
    );
    for (const v of [-1, 90, 0.5]) {
      throws(() => fiveStarPmf(CHAR5_RAMP, v), 'Pity — целое от 0 до 89');
      throws(() => pullChanceTable(CHAR5_RAMP, v), 'Pity — целое от 0 до 89');
    }
    throws(() => expectedPulls({ ...CHAR5_RAMP, step: NaN }), 'Рампа: step — не меньше 0');
    throws(() => fiveStarPmf(CHAR5_RAMP, NaN), 'Pity — целое от 0 до 89');
    throws(() => pullChanceTable(CHAR5_RAMP, NaN), 'Pity — целое от 0 до 89');
  });

  it('персонажный расчёт не смотрит на поля оружия (цели берут Pity кошелька целиком)', () => {
    const p = pity({ char: 30, weapon: 1000, weaponFatePoint: 7 });
    expect(charCopiesDist(community, p, 1)).toEqual(charCopiesDist(community, pity({ char: 30 }), 1));
  });

  it('очко сверх пути прижимается (2 при «5.0+» = 1, при «1.x» = 0); «Классика» не видит сияния', () => {
    const at = (m: typeof community, fate: number) => weaponCopiesDist(m, pity({ weaponFatePoint: fate }), 1);
    expect(at(community, 2)).toEqual(at(community, 1));
    const old = makeModel('community', { epitomized: '1.x' });
    expect(at(old, 2)).toEqual(at(old, 0));
    const classic = makeModel('community', { fiftyFifty: 'classic' });
    expect(charCopiesDist(classic, pity({ radiance: 3 }), 2)).toEqual(charCopiesDist(classic, pity(), 2));
  });
});
