// Модель круток (13.2, 13.3): мягкий гарант, 50/50 и «Захват сияния», оружейный путь, пресеты.
// Мягкий гарант и правила сброса счётчика сияния — модель сообщества (21, вопрос 7); всё редактируется.
import type { EpitomizedPath, FiftyFifty, GachaModel, Ramp, SoftPreset, StarglitterRefund } from './types';

/** «Сообщество» (KQM / paimon.moe): персонаж 5★ — 0,6%, с 74-й +6%, 100% на 90-й. */
export const CHAR5_RAMP: Readonly<Ramp> = { base: 0.006, start: 74, step: 0.06, hard: 90 };
/** Оружие 5★ — 0,7%, с 63-й +7%, 100% на 80-й (фактически уже на 77-й). */
export const WEAPON5_RAMP: Readonly<Ramp> = { base: 0.007, start: 63, step: 0.07, hard: 80 };
/** 4★ персонажа: 9-я крутка 56,1%, 10-я — 100%. */
export const CHAR4_RAMP: Readonly<Ramp> = { base: 0.051, start: 9, step: 0.51, hard: 10 };
/** 4★ оружия: 8-я крутка 66%, 9-я — 100%. */
export const WEAPON4_RAMP: Readonly<Ramp> = { base: 0.06, start: 8, step: 0.6, hard: 9 };

/** Старт оружейного мягкого гаранта по пресетам 13.2.2 («Свои» начинаются с «Сообщества»). */
export const WEAPON5_START: Record<SoftPreset, number> = {
  community: 63,
  fit_consolidated: 64,
  late_weapon: 65,
  custom: 63,
};

/** «Захват сияния»: ивентовый с p = 0,5 + 0,018 / 0,6 = 0,53. */
export const RADIANCE_FEATURED_WIN = 0.53;
/** После 3 проигранных 50/50 подряд следующий — гарантированно ивентовый. */
export const RADIANCE_SAFETY = 3;
export const CLASSIC_FEATURED_WIN = 0.5;

/** Очков судьбы до гарантированного выбранного оружия; 0 — пути нет. */
export const FATE_POINT_MAX: Record<EpitomizedPath, number> = { '5.0+': 1, '2.0-4.8': 2, '1.x': 0 };

/** Выбранное и второе ивентовое — по 37,5%, стандартное — 25%. */
export const WEAPON_CHOSEN = 0.375;
export const WEAPON_OTHER_FEATURED = 0.375;

/** Возврат блеска (13.3.5): значения по умолчанию, метка `user`; опция выключена. */
export const STARGLITTER_DEFAULTS: Readonly<StarglitterRefund> = {
  enabled: false,
  per4: 2,
  perStd5: 10,
  perDup5: 10,
  perWeapon5: 10,
};

/** Имена 50/50 из тест-кейсов: `official_radiance` (TC-29, TC-32) — это 'radiance' (DECISIONS.M9 D-902). */
export const FIFTY_FIFTY_ALIASES = {
  official_radiance: 'radiance',
  radiance: 'radiance',
  classic: 'classic',
} as const;
export type FiftyFiftyName = keyof typeof FIFTY_FIFTY_ALIASES;

export function resolveFiftyFifty(name: FiftyFiftyName): FiftyFifty {
  return FIFTY_FIFTY_ALIASES[name];
}

export function featuredWinChance(ff: FiftyFifty): number {
  return ff === 'radiance' ? RADIANCE_FEATURED_WIN : CLASSIC_FEATURED_WIN;
}

/** p(n) по формуле 13.2; n — номер крутки с последней 5★ (для 4★ — с последней 4★), с 1. */
export function rampChance(r: Ramp, n: number): number {
  if (n >= r.hard) return 1;
  if (n < r.start) return r.base;
  return Math.min(1, r.base + r.step * (n - r.start + 1));
}

/** Таблица p(n) для n = 0…hard (индекс 0 не используется) — для горячего цикла симулятора. */
export function rampTable(r: Ramp): Float64Array {
  const t = new Float64Array(r.hard + 1);
  for (let n = 1; n <= r.hard; n++) t[n] = rampChance(r, n);
  return t;
}

export function weaponStandardShare(m: GachaModel): number {
  return 1 - m.weaponChosen - m.weaponOtherFeatured;
}

/** Модель по пресету; объекты рамп — копии, их можно править («Свои»). */
export function makeModel(
  preset: SoftPreset = 'community',
  opts: { fiftyFifty?: FiftyFiftyName; epitomized?: EpitomizedPath } = {},
): GachaModel {
  return {
    softPreset: preset,
    char5: { ...CHAR5_RAMP },
    weapon5: { ...WEAPON5_RAMP, start: WEAPON5_START[preset] },
    char4: { ...CHAR4_RAMP },
    weapon4: { ...WEAPON4_RAMP },
    fiftyFifty: resolveFiftyFifty(opts.fiftyFifty ?? 'radiance'),
    epitomized: opts.epitomized ?? '5.0+',
    weaponChosen: WEAPON_CHOSEN,
    weaponOtherFeatured: WEAPON_OTHER_FEATURED,
  };
}

/** Ошибка в рампе (null — всё в порядке). */
export function rampError(r: Ramp): string | null {
  if (!Number.isInteger(r.hard) || r.hard < 1 || r.hard > 1000) return 'hard — целое от 1 до 1000';
  if (!Number.isInteger(r.start) || r.start < 1) return 'start — целое не меньше 1';
  if (!(r.base >= 0 && r.base <= 1)) return 'base — от 0 до 1';
  if (!(r.step >= 0 && Number.isFinite(r.step))) return 'step — не меньше 0';
  return null;
}
