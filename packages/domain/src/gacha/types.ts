// Типы симулятора молитв (разделы 5 и 13).
import type { Pity } from '../types';

/** Мягкий гарант (13.2): шанс base до start, затем +step за крутку, 100% на hard. */
export interface Ramp {
  base: number;
  start: number;
  step: number;
  hard: number;
}

export type SoftPreset = 'community' | 'fit_consolidated' | 'late_weapon' | 'custom';
/** «Захват сияния» (5.0+) или «Классика 50/50» (13.3.1). */
export type FiftyFifty = 'radiance' | 'classic';
/** Вариант оружейного пути (13.3.3): максимум очков судьбы 1 / 2 / пути нет. */
export type EpitomizedPath = '5.0+' | '2.0-4.8' | '1.x';

/** Модель круток; все коэффициенты редактируемые (пресет «Свои»). */
export interface GachaModel {
  softPreset: SoftPreset;
  char5: Ramp;
  weapon5: Ramp;
  char4: Ramp;
  weapon4: Ramp;
  fiftyFifty: FiftyFifty;
  epitomized: EpitomizedPath;
  /** Доля выбранного ивентового оружия в броске 75/25; стандартное = 1 − выбранное − второе. */
  weaponChosen: number;
  weaponOtherFeatured: number;
}

export type SimMode = 'char_and_weapon' | 'char_only' | 'weapon_only';
export type SimRuns = 100 | 1000 | 10000 | 100000;

/** Возврат звёздного блеска (13.3.5): сколько блеска даёт выпадение; каждые 5 → +1 крутка. */
export interface StarglitterRefund {
  enabled: boolean;
  per4: number;
  perStd5: number;
  /** Ивентовый 5★ персонаж, не первая копия. */
  perDup5: number;
  perWeapon5: number;
}

export interface SimInput {
  /** Бюджет в крутках. */
  budget: number;
  pity: Pity;
  mode: SimMode;
  /** C0 … C6 = 1 … 7 копий ивентового 5★. */
  consTarget: number;
  /** R1 … R5 = 1 … 5 копий выбранного оружия. */
  refTarget: number;
  runs: SimRuns;
  seed: number;
  starglitter: StarglitterRefund;
  model: GachaModel;
  /** «Моя удача»: результат (подпись строки главной таблицы) и сколько круток на него ушло. */
  luck?: { result: string; pulls: number };
}

export interface RunResult {
  /** Итоговые созвездия; −1 — ивентовый персонаж не выпал. */
  cons: number;
  refs: number;
  /** На какой крутке (с начала прогона) достигнута каждая веха: C0…Cцель, затем R1…Rцель; null — не достигнута. */
  reachedAt: (number | null)[];
  char5Featured: number;
  char5Std: number;
  w5Chosen: number;
  w5Other: number;
  w5Std: number;
  fours: number;
  /** Сколько круток потрачено (с возвратом блеска может быть больше бюджета). */
  used: number;
  /** Исходы 50/50 (без гарантированных 5★); «Захват сияния» — выигрыш. */
  won5050: number;
  lost5050: number;
}

export interface PullStats {
  mean: number;
  median: number;
  p10: number;
  p90: number;
}

export interface SimResultRow {
  /** 'C0'…'C6', 'C2 + R1'…, 'R1'… */
  label: string;
  /** % прогонов, дошедших до этого результата (не меньше). */
  pct: number;
  /** Сколько круток понадобилось дошедшим; null — никто не дошёл. */
  pulls: PullStats | null;
}

export interface CountShare {
  k: number;
  pct: number;
}

export type CountKey = 'char5Featured' | 'char5Std' | 'w5Chosen' | 'w5Other' | 'w5Std' | 'fours';

export interface SimSummary {
  results: SimResultRow[];
  combos: { label: string; pct: number }[];
  countDists: Partial<Record<CountKey, CountShare[]>>;
  /** % выигранных 50/50; null — в прогонах не было ни одного 50/50. */
  winRate5050: number | null;
  luckPercentile?: number;
  meta: {
    runs: number;
    seed: number;
    softPreset: SoftPreset;
    epitomized: EpitomizedPath;
    fiftyFifty: FiftyFifty;
  };
}
