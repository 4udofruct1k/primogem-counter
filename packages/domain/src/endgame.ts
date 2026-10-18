// Эндгейм-трекер (раздел 12). Все награды — из секции `endgame` seed-файла.
import type { AbyssCycle, Reward, SourceRule, TheaterDifficulty, TheaterSeason } from './types';

export interface EndgameConfig {
  abyss: {
    floors: number[];
    chambersPerFloor: number;
    maxStarsPerChamber: number;
    floorMilestones: { stars: number; primo: number }[];
  };
  theater: {
    acts: number[];
    arcana: number[];
    difficulties: { id: TheaterDifficulty; name: string; acts: number; arcana: number; note?: string }[];
  };
  stygian: { difficulties: { level: number; name: string; primo: number }[]; cumulative: boolean };
  hoyolab: { rule: string; maxPerMonth: number };
}

export function parseEndgameConfig(raw: unknown): EndgameConfig {
  return raw as EndgameConfig;
}

/**
 * HoYoLAB: 20 примогемов за 4-ю, 11-ю и 18-ю отметку месяца (12.4). В seed правило записано текстом
 * (`endgame.hoyolab.rule`), поэтому пороги продублированы здесь; тест сверяет их с текстом и `maxPerMonth`.
 */
export const HOYOLAB_MILESTONES = [
  { checkIns: 4, primo: 20 },
  { checkIns: 11, primo: 20 },
  { checkIns: 18, primo: 20 },
] as const;

/** floorPrimo(s) — по сумме звёзд этажа (12.1). */
export function abyssFloorPrimo(stars: number, cfg: EndgameConfig): number {
  return cfg.abyss.floorMilestones.reduce((sum, m) => sum + (stars >= m.stars ? m.primo : 0), 0);
}

export function abyssFloorsPrimo(floorStars: number[], cfg: EndgameConfig): number {
  return floorStars.reduce((sum, s) => sum + abyssFloorPrimo(s, cfg), 0);
}

export function abyssCyclePrimo(cycle: Pick<AbyssCycle, 'stars'>, cfg: EndgameConfig): number {
  return abyssFloorsPrimo(
    cycle.stars.map((chambers) =>
      chambers.reduce((a, b) => a + clamp(b, 0, cfg.abyss.maxStarsPerChamber), 0),
    ),
    cfg,
  );
}

export function theaterMaxActs(difficulty: TheaterDifficulty, cfg: EndgameConfig): number {
  return theaterDifficulty(difficulty, cfg).acts;
}

export function theaterMaxArcana(difficulty: TheaterDifficulty, cfg: EndgameConfig): number {
  return theaterDifficulty(difficulty, cfg).arcana;
}

function theaterDifficulty(id: TheaterDifficulty, cfg: EndgameConfig) {
  const d = cfg.theater.difficulties.find((x) => x.id === id);
  if (!d) throw new Error(`unknown theater difficulty: ${id}`);
  return d;
}

export function theaterPrimo(
  s: Pick<TheaterSeason, 'difficulty' | 'acts' | 'arcana'>,
  cfg: EndgameConfig,
): number {
  const d = theaterDifficulty(s.difficulty, cfg);
  const acts = clamp(s.acts, 0, d.acts);
  const arcana = clamp(s.arcana, 0, d.arcana);
  return sum(cfg.theater.acts.slice(0, acts)) + sum(cfg.theater.arcana.slice(0, arcana));
}

/** stygianPrimo(d) — накопительно по пройденным сложностям (12.3). */
export function stygianPrimo(maxDifficulty: number, cfg: EndgameConfig): number {
  const passed = cfg.stygian.difficulties.filter((d) => d.level <= maxDifficulty);
  if (!cfg.stygian.cumulative) return passed.at(-1)?.primo ?? 0;
  return sum(passed.map((d) => d.primo));
}

export function hoyolabPrimo(checkIns: number): number {
  return sum(HOYOLAB_MILESTONES.filter((m) => checkIns >= m.checkIns).map((m) => m.primo));
}

// ── ожидания для прогноза (раздел 6) ──────────────────────────────────────

export type ExpectationMode =
  | { mode: 'pack'; min?: MinMode }
  | { mode: 'max'; min?: MinMode }
  | { mode: 'last'; min?: MinMode }
  | { mode: 'avg3'; min?: MinMode }
  | { mode: 'manual'; primo: number; min?: MinMode };
/** `expectedMin`: минимум из последних 3 циклов или ручное число; по умолчанию — из пака. */
export type MinMode = 'pack' | 'min3' | number;

/**
 * expected / expectedMin трекерного источника по выбранному режиму.
 * `history` — суммы завершённых циклов, последний — в конце.
 */
export function trackerExpectation(
  rule: Pick<SourceRule, 'reward' | 'expected' | 'expectedMin'>,
  mode: ExpectationMode,
  history: number[],
): { expected: Reward; expectedMin: Reward } {
  const packExpected = rule.expected ?? rule.reward;
  const packMin = rule.expectedMin ?? packExpected;
  const last3 = history.slice(-3);

  let expected: Reward;
  switch (mode.mode) {
    case 'pack':
      expected = packExpected;
      break;
    case 'max':
      expected = rule.reward;
      break;
    case 'last':
      expected = history.length ? { primo: history.at(-1)! } : packExpected;
      break;
    case 'avg3':
      expected = last3.length ? { primo: Math.round(sum(last3) / last3.length) } : packExpected;
      break;
    case 'manual':
      expected = { primo: mode.primo };
      break;
  }

  const min = mode.min ?? 'pack';
  const expectedMin =
    typeof min === 'number'
      ? { primo: min }
      : min === 'min3' && last3.length
        ? { primo: Math.min(...last3) }
        : packMin;
  return { expected: { ...expected }, expectedMin: { ...expectedMin } };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function sum(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
