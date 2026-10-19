import { describe, expect, it } from 'vitest';
import { makeModel } from './model';
import {
  milestoneLabels,
  pickChar5,
  pickWeapon5,
  runAll,
  runBatch,
  simInputError,
  splitRuns,
  type CharPickState,
  type WeaponPickState,
} from './run';
import { always, pity, simInput } from './test/input';
import type { Pity } from '../types';
import type { GachaModel, RunResult, SimInput } from './types';

const community = makeModel('community');
const U = [0, 0.3, 0.529, 0.53, 0.75, 0.999999];

describe('gacha/run: выбор 5★ персонажа (13.3.1)', () => {
  it('гарант — ивентовый, счётчик сияния не меняется', () => {
    for (const u of U) {
      const st: CharPickState = { guaranteed: true, radiance: 2 };
      expect(pickChar5(st, u, 'radiance')).toBe('guaranteed');
      expect(st).toEqual({ guaranteed: false, radiance: 2 });
    }
  });

  it('TC-34: сияние 3 без гаранта → ивентовый с вероятностью 1, счётчик → 0', () => {
    for (const u of U) {
      const st: CharPickState = { guaranteed: false, radiance: 3 };
      expect(pickChar5(st, u, 'radiance')).toBe('radiance');
      expect(st).toEqual({ guaranteed: false, radiance: 0 });
    }
  });

  it('50/50 с p = 0,53: выигрыш → счётчик 0; проигрыш → счётчик + 1 и гарант', () => {
    const win: CharPickState = { guaranteed: false, radiance: 2 };
    expect(pickChar5(win, 0.529, 'radiance')).toBe('won');
    expect(win).toEqual({ guaranteed: false, radiance: 0 });
    const lose: CharPickState = { guaranteed: false, radiance: 2 };
    expect(pickChar5(lose, 0.53, 'radiance')).toBe('lost');
    expect(lose).toEqual({ guaranteed: true, radiance: 3 });
  });

  it('«Классика»: p = 0,5, счётчика нет', () => {
    const st: CharPickState = { guaranteed: false, radiance: 3 };
    expect(pickChar5(st, 0.5, 'classic')).toBe('lost');
    expect(st).toEqual({ guaranteed: true, radiance: 3 });
    expect(pickChar5({ guaranteed: false, radiance: 0 }, 0.4999, 'classic')).toBe('won');
  });
});

describe('gacha/run: выбор 5★ оружия (13.3.2, 13.3.3)', () => {
  const pick = (st: WeaponPickState, u: number, model: GachaModel = community) => pickWeapon5(st, u, model);

  it('75/25: выбранное 37,5% / второе 37,5% / стандартное 25% → гарант75; не выбранное → очко + 1', () => {
    const a: WeaponPickState = { guaranteed: false, fatePoint: 0 };
    expect(pick(a, 0.374)).toBe('chosen');
    expect(a).toEqual({ guaranteed: false, fatePoint: 0 });
    const b: WeaponPickState = { guaranteed: false, fatePoint: 0 };
    expect(pick(b, 0.375)).toBe('other');
    expect(b).toEqual({ guaranteed: false, fatePoint: 1 });
    const c: WeaponPickState = { guaranteed: false, fatePoint: 0 };
    expect(pick(c, 0.75)).toBe('standard');
    expect(c).toEqual({ guaranteed: true, fatePoint: 1 });
  });

  it('гарант 75/25: выбранное 50% / второе 50%, гарант снимается', () => {
    const model = makeModel('community', { epitomized: '2.0-4.8' });
    const a: WeaponPickState = { guaranteed: true, fatePoint: 0 };
    expect(pick(a, 0.49, model)).toBe('chosen');
    expect(a).toEqual({ guaranteed: false, fatePoint: 0 });
    const b: WeaponPickState = { guaranteed: true, fatePoint: 1 };
    expect(pick(b, 0.5, model)).toBe('other');
    expect(b).toEqual({ guaranteed: false, fatePoint: 2 });
  });

  it('TC-37: очко судьбы 1 («5.0+») → следующая 5★ — выбранное, очко → 0', () => {
    for (const u of U) {
      const st: WeaponPickState = { guaranteed: false, fatePoint: 1 };
      expect(pick(st, u)).toBe('chosen');
      expect(st).toEqual({ guaranteed: false, fatePoint: 0 });
    }
  });

  it('TC-44: стандартное при «5.0+» → гарант75 и очко 1; следующая — выбранное (очко важнее гаранта)', () => {
    const st: WeaponPickState = { guaranteed: false, fatePoint: 0 };
    expect(pick(st, 0.8)).toBe('standard');
    expect(st).toEqual({ guaranteed: true, fatePoint: 1 });
    expect(pick(st, 0.99)).toBe('chosen');
    expect(st).toEqual({ guaranteed: false, fatePoint: 0 });
  });

  it('«2.0–4.8» — максимум 2 очка; «1.x» — очков нет', () => {
    const m2 = makeModel('community', { epitomized: '2.0-4.8' });
    const st: WeaponPickState = { guaranteed: false, fatePoint: 1 };
    expect(pick(st, 0.5, m2)).toBe('other');
    expect(st.fatePoint).toBe(2);
    expect(pick(st, 0.99, m2)).toBe('chosen');
    const m1 = makeModel('community', { epitomized: '1.x' });
    const old: WeaponPickState = { guaranteed: false, fatePoint: 0 };
    expect(pick(old, 0.9, m1)).toBe('standard');
    expect(old).toEqual({ guaranteed: true, fatePoint: 0 });
    expect(pick(old, 0.9, m1)).toBe('other');
    expect(old).toEqual({ guaranteed: false, fatePoint: 0 });
  });
});

describe('gacha/run: прогон (13.4)', () => {
  /** 5★ на каждой второй крутке, 4★ — на третьей с последней 4★ (детерминированно). */
  const lattice = (base: GachaModel = community): GachaModel => ({
    ...base,
    char5: always(2),
    weapon5: always(2),
    char4: always(3),
    weapon4: always(3),
  });

  it('4★ проверяется только без 5★ и переносится: 5★ на 2, 4, 6; 4★ на 3 и 7', () => {
    for (const mode of ['char_only', 'weapon_only'] as const) {
      const [r] = runBatch(
        simInput({ mode, budget: 7, consTarget: 6, refTarget: 5, model: lattice() }),
        0,
        1,
      );
      expect(r.used).toBe(7);
      expect(r.fours).toBe(2);
      expect(r.char5Featured + r.char5Std + r.w5Chosen + r.w5Other + r.w5Std).toBe(3);
    }
  });

  it('pity из ввода: 5★ персонажа на 90-й с начала баннера, 4★ — на 10-й', () => {
    const model = { ...community, char5: always(90), char4: always(10) };
    const [r] = runBatch(
      simInput({ budget: 30, pity: pity({ char: 75, char4: 5, charGuaranteed: true }), model }),
      0,
      1,
    );
    expect(r.reachedAt).toEqual([15]);
    expect(r.cons).toBe(0);
    expect(r.used).toBe(15);
    expect(r.fours).toBe(1); // 5-я (pity4 = 10); на 15-й снова пора, но выпала 5★ — 4★ не проверяется
  });

  it('reachedAt — номер крутки с начала прогона; персонаж, затем оружие из остатка', () => {
    const model = { ...community, char5: always(10), weapon5: always(5) };
    const input = simInput({
      mode: 'char_and_weapon',
      budget: 100,
      consTarget: 0,
      refTarget: 2,
      pity: pity({ charGuaranteed: true, weaponFatePoint: 1 }),
      model,
    });
    const [r] = runBatch(input, 0, 1);
    expect(r.reachedAt[0]).toBe(10);
    expect(r.reachedAt[1]).toBe(15); // очко судьбы → выбранное на 5-й оружейной
    expect(r.cons).toBe(0);
    expect(r.w5Chosen).toBe(r.refs);
    expect(milestoneLabels(input)).toEqual(['C0', 'C0 + R1', 'C0 + R2']);
  });

  it('пустой бюджет — ничего не выпало', () => {
    const [r] = runBatch(simInput({ mode: 'char_and_weapon', consTarget: 1, refTarget: 1 }), 0, 1);
    expect(r).toEqual({
      cons: -1,
      refs: 0,
      reachedAt: [null, null, null],
      char5Featured: 0,
      char5Std: 0,
      w5Chosen: 0,
      w5Other: 0,
      w5Std: 0,
      fours: 0,
      used: 0,
      won5050: 0,
      lost5050: 0,
    } satisfies RunResult);
  });

  it('TC-33: бюджет 160, pity 20, без гаранта, цель C0 → 100% прогонов, не позже 160-й', () => {
    const rs = runBatch(simInput({ budget: 160, pity: pity({ char: 20 }) }), 0, 10000);
    expect(rs.every((r) => r.cons === 0)).toBe(true);
    expect(Math.max(...rs.map((r) => r.reachedAt[0]!))).toBeLessThanOrEqual(160);
    expect(rs.some((r) => r.char5Std === 1)).toBe(true);
  });

  it('TC-34 в прогоне: сияние 3 → первая 5★ ивентовая во всех прогонах', () => {
    const rs = runBatch(simInput({ budget: 90, pity: pity({ radiance: 3 }) }), 0, 2000);
    expect(rs.every((r) => r.char5Featured === 1 && r.char5Std === 0 && r.won5050 === 1)).toBe(true);
  });

  it('TC-37 в прогоне: очко судьбы 1 → R1 первой же 5★', () => {
    const rs = runBatch(
      simInput({ mode: 'weapon_only', budget: 80, pity: pity({ weaponFatePoint: 1 }) }),
      0,
      2000,
    );
    expect(rs.every((r) => r.refs === 1 && r.w5Chosen === 1 && r.w5Other + r.w5Std === 0)).toBe(true);
  });

  it('TC-44 в прогоне: «стандартное → выбранное» встречается, «стандартное → второе» — нет', () => {
    const rs = runBatch(simInput({ mode: 'weapon_only', budget: 400, refTarget: 1 }), 0, 4000);
    expect(rs.some((r) => r.w5Std === 1 && r.w5Chosen === 1)).toBe(true);
    expect(rs.every((r) => r.w5Std + r.w5Other <= 1 && r.w5Chosen === 1)).toBe(true);
  });
});

describe('gacha/run: возврат звёздного блеска (13.3.5)', () => {
  const sg = { enabled: true, per4: 2, perStd5: 10, perDup5: 10, perWeapon5: 10 };

  it('каждые 5 блеска сразу → +1 крутка: 4★ на каждой крутке по 2 блеска, бюджет 10 → 16 круток', () => {
    const model = { ...community, char5: always(1000), char4: always(1) };
    const on = runBatch(simInput({ budget: 10, starglitter: sg, model }), 0, 1)[0];
    expect(on.used).toBe(16);
    expect(on.fours).toBe(16);
    const off = runBatch(simInput({ budget: 10, model }), 0, 1)[0];
    expect(off.used).toBe(10);
  });

  it('первая копия ивентового — без блеска; повторы и стандартные — по 10 (2 крутки)', () => {
    const model = { ...community, char5: always(1) };
    const base = { consTarget: 6, pity: pity({ charGuaranteed: true }), model };
    const one = runBatch(simInput({ ...base, budget: 1, starglitter: sg }), 0, 1)[0];
    expect(one.used).toBe(1);
    expect(one.cons).toBe(0);
    const rs = runBatch(simInput({ ...base, budget: 2, starglitter: sg }), 0, 200);
    for (const r of rs) {
      expect(r.cons).toBe(6);
      expect(r.used).toBe(r.char5Featured + r.char5Std);
    }
    expect(runBatch(simInput({ ...base, budget: 2 }), 0, 1)[0].used).toBe(2);
  });

  it('5★ оружие — 10 блеска: с бюджетом 1 доходит до R5', () => {
    const model = { ...community, weapon5: always(1) };
    const rs = runBatch(
      simInput({ mode: 'weapon_only', refTarget: 5, budget: 1, starglitter: sg, model }),
      0,
      200,
    );
    for (const r of rs) {
      expect(r.refs).toBe(5);
      expect(r.used).toBe(r.w5Chosen + r.w5Other + r.w5Std);
    }
  });
});

describe('gacha/run: пакеты и воспроизводимость', () => {
  const input = simInput({
    mode: 'char_and_weapon',
    budget: 600,
    consTarget: 2,
    refTarget: 1,
    pity: pity({ char: 20, radiance: 1, weapon: 15 }),
    starglitter: { enabled: true, per4: 2, perStd5: 10, perDup5: 10, perWeapon5: 10 },
  });

  it('TC-35: 1 воркер и 8 воркеров — побайтно одинаковые RunResult[]', () => {
    const one = runBatch(input, 0, 10000);
    const eight = splitRuns(10000, 8).flatMap(([from, to]) => runBatch(input, from, to));
    expect(JSON.stringify(eight)).toBe(JSON.stringify(one));
    expect(JSON.stringify(runAll(input))).toBe(JSON.stringify(one));
  });

  it('прогон зависит только от (ввод, номер): пакет [5000, 5003) = хвост полного', () => {
    expect(runBatch(input, 5000, 5003)).toEqual(runBatch(input, 0, 5003).slice(5000));
    expect(runBatch(input, 0, 3)).not.toEqual(runBatch({ ...input, seed: input.seed + 1 }, 0, 3));
  });

  it('seed прогона = baseSeed + i (13.4): соседние seed дают сдвинутые прогоны (D-901)', () => {
    expect(runBatch(input, 1, 4)).toEqual(runBatch({ ...input, seed: input.seed + 1 }, 0, 3));
  });

  it('большой seed переносится по модулю 2³² без потери точности', () => {
    const top = { ...input, seed: 2 ** 32 - 1 };
    // прогоны 99 998, 99 999 при seed 2³² − 1 — это прогоны 99 997, 99 998 при seed 0
    expect(runBatch(top, 99_998, 100_000)).toEqual(runBatch({ ...input, seed: 0 }, 99_997, 99_999));
    // 2⁵³ − 1 ≡ 2³² − 1 (mod 2³²): те же прогоны, в том числе с нечётным номером
    expect(runBatch({ ...input, seed: Number.MAX_SAFE_INTEGER }, 0, 6)).toEqual(runBatch(top, 0, 6));
  });

  it('splitRuns покрывает [0, runs) без дыр, пакеты отличаются не больше чем на 1', () => {
    const parts = splitRuns(10, 4);
    expect(parts).toEqual([
      [0, 3],
      [3, 6],
      [6, 8],
      [8, 10],
    ]);
    expect(splitRuns(3, 8)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  it('неверный ввод — RangeError', () => {
    expect(() => runBatch(simInput({ consTarget: 7 }), 0, 1)).toThrow(RangeError);
    expect(() => runBatch(simInput({ mode: 'weapon_only', refTarget: 0 }), 0, 1)).toThrow(RangeError);
    expect(() => runBatch(simInput({ budget: -1 }), 0, 1)).toThrow(RangeError);
    expect(() => runBatch(simInput({ budget: 1.5 }), 0, 1)).toThrow(RangeError);
    expect(() => runBatch(simInput({ seed: 0.5 }), 0, 1)).toThrow(RangeError);
    expect(() => runBatch(simInput(), 2, 1)).toThrow(RangeError);
    const bad = { ...community, weaponChosen: 0.7, weaponOtherFeatured: 0.4 };
    expect(() => runBatch(simInput({ model: bad }), 0, 1)).toThrow(RangeError);
  });
});

describe('gacha/run: проверка ввода (D-915, D-919)', () => {
  type Bad = [string, Partial<SimInput>, string];
  /** Счётчик сияния вне типа 0 | 1 | 2 | 3 — как из непроверенных данных. */
  const radiance = (v: number) => v as Pity['radiance'];
  const runs = (v: number) => v as SimInput['runs'];

  it('все pity — целые в границах модели; иначе понятная ошибка и RangeError в runBatch', () => {
    const custom = { ...community, char5: { ...community.char5, hard: 80 } };
    const cases: Bad[] = [
      ['pity 5★ дробный', { pity: pity({ char: 20.5 }) }, 'Pity персонажа — целое от 0 до 89'],
      ['pity 5★ NaN', { pity: pity({ char: NaN }) }, 'Pity персонажа — целое от 0 до 89'],
      ['pity 5★ < 0', { pity: pity({ char: -1 }) }, 'Pity персонажа — целое от 0 до 89'],
      ['pity 5★ = hard', { pity: pity({ char: 90 }) }, 'Pity персонажа — целое от 0 до 89'],
      [
        'pity 5★ ≥ hard «Своих»',
        { pity: pity({ char: 85 }), model: custom },
        'Pity персонажа — целое от 0 до 79',
      ],
      ['pity 4★ персонажа', { pity: pity({ char4: 10 }) }, 'Pity 4★ персонажа — целое от 0 до 9'],
      ['pity 4★ дробный', { pity: pity({ char4: 1.5 }) }, 'Pity 4★ персонажа — целое от 0 до 9'],
      ['сияние 4', { pity: pity({ radiance: radiance(4) }) }, 'Счётчик сияния — целое от 0 до 3'],
      ['сияние −1', { pity: pity({ radiance: radiance(-1) }) }, 'Счётчик сияния — целое от 0 до 3'],
      ['сияние 1,5', { pity: pity({ radiance: radiance(1.5) }) }, 'Счётчик сияния — целое от 0 до 3'],
      ['pity оружия', { pity: pity({ weapon: 80 }) }, 'Pity оружия — целое от 0 до 79'],
      ['pity оружия NaN', { pity: pity({ weapon: NaN }) }, 'Pity оружия — целое от 0 до 79'],
      ['pity 4★ оружия', { pity: pity({ weapon4: 9 }) }, 'Pity 4★ оружия — целое от 0 до 8'],
      ['pity 4★ оружия < 0', { pity: pity({ weapon4: -1 }) }, 'Pity 4★ оружия — целое от 0 до 8'],
      ['очко судьбы 3', { pity: pity({ weaponFatePoint: 3 }) }, 'Очко судьбы — целое от 0 до 2'],
      ['очко судьбы 0,5', { pity: pity({ weaponFatePoint: 0.5 }) }, 'Очко судьбы — целое от 0 до 2'],
      ['очко судьбы −1', { pity: pity({ weaponFatePoint: -1 }) }, 'Очко судьбы — целое от 0 до 2'],
      ['бюджет NaN', { budget: NaN }, 'Бюджет — целое число круток не меньше 0'],
      ['бюджет ∞', { budget: Infinity }, 'Бюджет — целое число круток не меньше 0'],
      ['прогонов 0', { runs: runs(0) }, 'Прогонов — целое число не меньше 1'],
      ['прогонов 1,5', { runs: runs(1.5) }, 'Прогонов — целое число не меньше 1'],
      ['цель C2,5', { consTarget: 2.5 }, 'Цель по созвездиям — C0…C6'],
      ['цель C−1', { consTarget: -1 }, 'Цель по созвездиям — C0…C6'],
      ['цель R1,5', { refTarget: 1.5 }, 'Цель по сигне — R1…R5'],
      ['цель R6', { refTarget: 6 }, 'Цель по сигне — R1…R5'],
    ];
    for (const [name, p, message] of cases) {
      for (const mode of ['char_only', 'weapon_only', 'char_and_weapon'] as const) {
        const input = simInput({ budget: 10, mode, ...p });
        expect(simInputError(input), `${name}, ${mode}`).toBe(message);
        expect(() => runBatch(input, 0, 1), `${name}, ${mode}`).toThrow(new RangeError(message));
      }
    }
  });

  it('границы допустимы; очко судьбы до 2 при любом пути (лишнее прижимается), сияние — при «Классике»', () => {
    const ok: Partial<SimInput>[] = [
      { pity: pity({ char: 89, char4: 9, radiance: 3, weapon: 79, weapon4: 8, weaponFatePoint: 2 }) },
      { pity: pity({ char: 0, char4: 0, radiance: 0, weapon: 0, weapon4: 0, weaponFatePoint: 0 }) },
      { pity: pity() }, // 4★ не заданы — 0
      { pity: pity({ weaponFatePoint: 2 }), model: makeModel('community', { epitomized: '1.x' }) },
      { pity: pity({ radiance: 3 }), model: makeModel('community', { fiftyFifty: 'classic' }) },
      { budget: 0, runs: 100, consTarget: 0, refTarget: 1 },
      { consTarget: 6, refTarget: 5 },
    ];
    for (const p of ok) {
      const input = simInput({ mode: 'char_and_weapon', budget: 10, ...p });
      expect(simInputError(input)).toBeNull();
      expect(runBatch(input, 0, 1)).toHaveLength(1);
    }
  });
});
