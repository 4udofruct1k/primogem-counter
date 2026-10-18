import { describe, expect, it } from 'vitest';
import {
  abyssCyclePrimo,
  abyssFloorsPrimo,
  HOYOLAB_MILESTONES,
  hoyolabPrimo,
  parseEndgameConfig,
  stygianPrimo,
  theaterMaxActs,
  theaterPrimo,
  trackerExpectation,
} from './endgame';
import { packFor } from './test/context';
import { seed } from './test/fixtures';

const cfg = parseEndgameConfig(seed.endgame);

describe('endgame (раздел 12)', () => {
  it('TC-20: бездна, звёзды этажей [9, 9, 9, 7] → 700', () => {
    expect(abyssFloorsPrimo([9, 9, 9, 7], cfg)).toBe(700);
    expect(abyssFloorsPrimo([2, 3, 6, 9], cfg)).toBe(0 + 50 + 100 + 200);
  });

  it('бездна: сетка 4 × 3 зала, «все 36★» = 800', () => {
    const full: [number, number, number][] = [
      [3, 3, 3],
      [3, 3, 3],
      [3, 3, 3],
      [3, 3, 3],
    ];
    expect(abyssCyclePrimo({ stars: full }, cfg)).toBe(800);
    const partial: [number, number, number][] = [
      [3, 3, 3],
      [3, 3, 3],
      [3, 3, 3],
      [3, 3, 1],
    ];
    expect(abyssCyclePrimo({ stars: partial }, cfg)).toBe(700);
  });

  it('TC-21: театр — сложная, 8 актов → 620; лунный, 10 актов + 2 арканы → 1000', () => {
    expect(theaterPrimo({ difficulty: 'hard', acts: 8, arcana: 0 }, cfg)).toBe(620);
    expect(theaterPrimo({ difficulty: 'lunar', acts: 10, arcana: 2 }, cfg)).toBe(1000);
    expect(theaterMaxActs('easy', cfg)).toBe(3);
  });

  it('театр: акты и арканы не выходят за пределы сложности', () => {
    expect(theaterPrimo({ difficulty: 'easy', acts: 10, arcana: 2 }, cfg)).toBe(220);
    expect(theaterPrimo({ difficulty: 'visionary', acts: 10, arcana: 2 }, cfg)).toBe(800);
  });

  it('TC-22: натиск maxDifficulty 2 → 300, 5 → 450', () => {
    expect(stygianPrimo(2, cfg)).toBe(300);
    expect(stygianPrimo(5, cfg)).toBe(450);
    expect(stygianPrimo(0, cfg)).toBe(0);
  });

  it('TC-24: HoYoLAB 3 / 11 / 18 отметок → 0 / 40 / 60', () => {
    expect(hoyolabPrimo(3)).toBe(0);
    expect(hoyolabPrimo(11)).toBe(40);
    expect(hoyolabPrimo(18)).toBe(60);
    expect(hoyolabPrimo(31)).toBe(60);
  });

  it('HoYoLAB: пороги в коде совпадают с правилом из seed', () => {
    const total = HOYOLAB_MILESTONES.reduce((s, m) => s + m.primo, 0);
    expect(total).toBe(seed.endgame.hoyolab.maxPerMonth);
    for (const m of HOYOLAB_MILESTONES) expect(seed.endgame.hoyolab.rule).toContain(`${m.checkIns}-ю`);
    expect(seed.endgame.hoyolab.rule).toContain(`${HOYOLAB_MILESTONES[0]!.primo} примогемов`);
  });

  it('ожидания для прогноза: пак / максимум / как в прошлый раз / среднее за 3 / вручную', () => {
    const abyss = packFor('europe', '2026-10-19T05:00:00Z').rules.find((r) => r.id === 'abyss')!;
    const history = [800, 600, 700, 500];
    expect(trackerExpectation(abyss, { mode: 'pack' }, history)).toEqual({
      expected: { primo: 800 },
      expectedMin: { primo: 600 },
    });
    expect(trackerExpectation(abyss, { mode: 'max' }, history).expected).toEqual({ primo: 800 });
    expect(trackerExpectation(abyss, { mode: 'last' }, history).expected).toEqual({ primo: 500 });
    expect(trackerExpectation(abyss, { mode: 'avg3' }, history).expected).toEqual({ primo: 600 });
    expect(trackerExpectation(abyss, { mode: 'manual', primo: 650 }, history).expected).toEqual({
      primo: 650,
    });
    // expectedMin — минимум из последних трёх циклов или ручное
    expect(trackerExpectation(abyss, { mode: 'avg3', min: 'min3' }, history).expectedMin).toEqual({
      primo: 500,
    });
    expect(trackerExpectation(abyss, { mode: 'avg3', min: 550 }, history).expectedMin).toEqual({
      primo: 550,
    });
    // без истории — значения из пака
    expect(trackerExpectation(abyss, { mode: 'last', min: 'min3' }, [])).toEqual({
      expected: { primo: 800 },
      expectedMin: { primo: 600 },
    });
  });
});
