// Прогоны симулятора (13.3, 13.4). Чистые функции: воркер вызывает runBatch на свой диапазон номеров.
// Горячий цикл — без аллокаций на крутку: таблицы шансов считаются один раз на пакет.
import { STARGLITTER_PER_PULL } from '../wallet';
import {
  CLASSIC_FEATURED_WIN,
  FATE_POINT_MAX,
  fatePointError,
  pityCounterError,
  RADIANCE_FEATURED_WIN,
  RADIANCE_SAFETY,
  radianceError,
  rampError,
  rampTable,
  startFatePoint,
  startRadiance,
  weaponSharesError,
} from './model';
import { runSeed, Xoshiro128ss } from './rng';
import type { FiftyFifty, GachaModel, RunResult, SimInput } from './types';

export const MAX_CONS = 6;
export const MAX_REFS = 5;

export type Char5Outcome = 'guaranteed' | 'radiance' | 'won' | 'lost';
export type Weapon5Outcome = 'chosen' | 'other' | 'standard';

/** Выбор 5★ персонажа: гарант и счётчик «Захвата сияния» (подряд проигранных 50/50). */
export interface CharPickState {
  guaranteed: boolean;
  radiance: number;
}

/** Выбор 5★ оружия: гарант 75/25 и очки пути судьбы. */
export interface WeaponPickState {
  guaranteed: boolean;
  fatePoint: number;
}

/** Кто выпал на 5★ персонажа (13.3.1). u — равномерное [0, 1); st меняется на месте. */
export function pickChar5(st: CharPickState, u: number, ff: FiftyFifty): Char5Outcome {
  if (st.guaranteed) {
    st.guaranteed = false; // счётчик сияния не меняется
    return 'guaranteed';
  }
  if (ff === 'classic') {
    if (u < CLASSIC_FEATURED_WIN) return 'won';
    st.guaranteed = true;
    return 'lost';
  }
  if (st.radiance >= RADIANCE_SAFETY) {
    st.radiance = 0;
    return 'radiance';
  }
  if (u < RADIANCE_FEATURED_WIN) {
    st.radiance = 0;
    return 'won';
  }
  st.radiance += 1;
  st.guaranteed = true;
  return 'lost';
}

/** Кто выпал на 5★ оружия (13.3.3): очко судьбы важнее гаранта 75/25 (TC-44). */
export function pickWeapon5(st: WeaponPickState, u: number, m: GachaModel): Weapon5Outcome {
  const max = FATE_POINT_MAX[m.epitomized];
  let out: Weapon5Outcome;
  if (max > 0 && st.fatePoint >= max) out = 'chosen';
  else if (st.guaranteed)
    out = u * (m.weaponChosen + m.weaponOtherFeatured) < m.weaponChosen ? 'chosen' : 'other';
  else if (u < m.weaponChosen) out = 'chosen';
  else if (u < m.weaponChosen + m.weaponOtherFeatured) out = 'other';
  else out = 'standard';
  if (out === 'chosen') st.fatePoint = 0;
  else if (max > 0) st.fatePoint += 1;
  // выбранное и второе ивентовое снимают гарант 75/25, стандартное — ставит
  st.guaranteed = out === 'standard';
  return out;
}

/** Подписи вех в порядке трат: C0…Cцель, затем «Cцель + R1»… (или R1… в «только оружие»). */
export function milestoneLabels(input: SimInput): string[] {
  const labels: string[] = [];
  if (input.mode !== 'weapon_only') for (let c = 0; c <= input.consTarget; c++) labels.push(`C${c}`);
  if (input.mode !== 'char_only') {
    const prefix = input.mode === 'char_and_weapon' ? `C${input.consTarget} + ` : '';
    for (let r = 1; r <= input.refTarget; r++) labels.push(`${prefix}R${r}`);
  }
  return labels;
}

/**
 * Ошибка ввода (null — всё в порядке). Pity проверяется целиком при любом режиме, как и рампы:
 * счётчики — целые 0…hard − 1 своей рампы, сияние 0…3, очко судьбы 0…2 (D-919).
 */
export function simInputError(input: SimInput): string | null {
  const { budget, runs, consTarget, refTarget, seed, pity: p, model: m, starglitter: sg } = input;
  if (!Number.isInteger(budget) || budget < 0) return 'Бюджет — целое число круток не меньше 0';
  if (!Number.isInteger(runs) || runs < 1) return 'Прогонов — целое число не меньше 1';
  if (!Number.isInteger(consTarget) || consTarget < 0 || consTarget > MAX_CONS)
    return 'Цель по созвездиям — C0…C6';
  if (!Number.isInteger(refTarget) || refTarget < 1 || refTarget > MAX_REFS) return 'Цель по сигне — R1…R5';
  if (!Number.isSafeInteger(seed)) return 'Seed — целое число';
  for (const key of ['char5', 'weapon5', 'char4', 'weapon4'] as const) {
    const err = rampError(m[key]);
    if (err) return `Модель ${key}: ${err}`;
  }
  const err =
    pityCounterError('Pity персонажа', p.char, m.char5) ??
    pityCounterError('Pity 4★ персонажа', p.char4 ?? 0, m.char4) ??
    radianceError(p.radiance) ??
    pityCounterError('Pity оружия', p.weapon, m.weapon5) ??
    pityCounterError('Pity 4★ оружия', p.weapon4 ?? 0, m.weapon4) ??
    fatePointError(p.weaponFatePoint) ??
    weaponSharesError(m);
  if (err) return err;
  for (const v of [sg.per4, sg.perStd5, sg.perDup5, sg.perWeapon5])
    if (!(v >= 0 && Number.isFinite(v))) return 'Блеск за выпадение — не меньше 0';
  return null;
}

/** Всё, что не меняется между прогонами пакета. */
interface Prepared {
  input: SimInput;
  char: boolean;
  weapon: boolean;
  copies: number;
  milestones: number;
  t5c: Float64Array;
  t4c: Float64Array;
  t5w: Float64Array;
  t4w: Float64Array;
  sg: boolean;
}

function prepare(input: SimInput): Prepared {
  const err = simInputError(input);
  if (err) throw new RangeError(err);
  const char = input.mode !== 'weapon_only';
  const weapon = input.mode !== 'char_only';
  return {
    input,
    char,
    weapon,
    copies: input.consTarget + 1,
    milestones: (char ? input.consTarget + 1 : 0) + (weapon ? input.refTarget : 0),
    t5c: rampTable(input.model.char5),
    t4c: rampTable(input.model.char4),
    t5w: rampTable(input.model.weapon5),
    t4w: rampTable(input.model.weapon4),
    sg: input.starglitter.enabled,
  };
}

/** Один прогон i (13.4); rng пересевается от (seed + i), поэтому прогон зависит только от (ввод, i). */
function simulate(c: Prepared, rng: Xoshiro128ss, i: number): RunResult {
  const { input, t5c, t4c, t5w, t4w } = c;
  const { pity, model } = input;
  const sg = input.starglitter;
  const per4 = c.sg ? sg.per4 : 0;
  rng.reseed(runSeed(input.seed, i));

  const reachedAt: (number | null)[] = new Array<number | null>(c.milestones).fill(null);
  let m = 0; // следующая веха
  let budget = input.budget;
  let used = 0;
  let glitter = 0;
  let fours = 0;
  let featured = 0;
  let std = 0;
  let won = 0;
  let lost = 0;
  let chosen = 0;
  let other = 0;
  let wstd = 0;

  // pity проверены (simInputError): целые 0…hard − 1; сияние и очко прижимаются, как в exact.ts (D-919)
  if (c.char) {
    const hard4 = t4c.length - 1;
    let p5 = pity.char;
    let p4 = pity.char4 ?? 0;
    const ff = model.fiftyFifty;
    const st: CharPickState = { guaranteed: pity.charGuaranteed, radiance: startRadiance(ff, pity.radiance) };
    while (featured < c.copies && budget > 0) {
      budget--;
      used++;
      p5++;
      p4++;
      // p5 ≤ hard: на hard шанс 1, а u < 1
      if (rng.next() < t5c[p5]) {
        p5 = 0;
        const out = pickChar5(st, rng.next(), ff);
        if (out === 'lost') {
          std++;
          lost++;
          if (c.sg) glitter += sg.perStd5;
        } else {
          if (out !== 'guaranteed') won++;
          featured++;
          if (c.sg && featured > 1) glitter += sg.perDup5;
          reachedAt[m++] = used;
        }
      } else if (rng.next() < (p4 >= hard4 ? 1 : t4c[p4])) {
        // 4★ только без 5★; 5★ не сбрасывает счётчик 4★ — гарант переносится
        p4 = 0;
        fours++;
        glitter += per4;
      }
      if (glitter >= STARGLITTER_PER_PULL) {
        const k = Math.floor(glitter / STARGLITTER_PER_PULL);
        budget += k;
        glitter -= k * STARGLITTER_PER_PULL;
      }
    }
  }

  // В «персонаж + сигна» оружие крутится только после цели по созвездиям (13.3.4).
  if (c.weapon && (!c.char || featured >= c.copies)) {
    const hard4 = t4w.length - 1;
    let p5 = pity.weapon;
    let p4 = pity.weapon4 ?? 0;
    const st: WeaponPickState = {
      guaranteed: pity.weaponGuaranteed,
      fatePoint: startFatePoint(model.epitomized, pity.weaponFatePoint),
    };
    while (chosen < input.refTarget && budget > 0) {
      budget--;
      used++;
      p5++;
      p4++;
      if (rng.next() < t5w[p5]) {
        p5 = 0;
        const out = pickWeapon5(st, rng.next(), model);
        if (out === 'chosen') {
          chosen++;
          reachedAt[m++] = used;
        } else if (out === 'other') other++;
        else wstd++;
        if (c.sg) glitter += sg.perWeapon5;
      } else if (rng.next() < (p4 >= hard4 ? 1 : t4w[p4])) {
        p4 = 0;
        fours++;
        glitter += per4;
      }
      if (glitter >= STARGLITTER_PER_PULL) {
        const k = Math.floor(glitter / STARGLITTER_PER_PULL);
        budget += k;
        glitter -= k * STARGLITTER_PER_PULL;
      }
    }
  }

  return {
    cons: featured - 1,
    refs: chosen,
    reachedAt,
    char5Featured: featured,
    char5Std: std,
    w5Chosen: chosen,
    w5Other: other,
    w5Std: wstd,
    fours,
    used,
    won5050: won,
    lost5050: lost,
  };
}

/** Прогоны с номерами [from, to). Результат не зависит от того, как диапазон поделён между воркерами. */
export function runBatch(input: SimInput, from: number, to: number): RunResult[] {
  if (!(Number.isInteger(from) && Number.isInteger(to) && 0 <= from && from <= to))
    throw new RangeError('Диапазон прогонов: 0 ≤ from ≤ to');
  const c = prepare(input);
  const rng = new Xoshiro128ss();
  const out: RunResult[] = [];
  for (let i = from; i < to; i++) out.push(simulate(c, rng, i));
  return out;
}

export function runAll(input: SimInput): RunResult[] {
  return runBatch(input, 0, input.runs);
}

/**
 * Деление [0, runs) на ≤ parts непустых пакетов почти равного размера (по воркерам).
 * Дробное число воркеров — вниз, NaN / меньше 1 / не конечное — 1 (D-921): пакеты всегда ровно [0, runs).
 */
export function splitRuns(runs: number, parts: number): [number, number][] {
  const p = Number.isFinite(parts) && parts >= 1 ? Math.floor(parts) : 1;
  const n = Math.max(1, Math.min(p, runs));
  const out: [number, number][] = [];
  for (let k = 0, from = 0; k < n; k++) {
    const to = from + Math.floor(runs / n) + (k < runs % n ? 1 : 0);
    if (to > from) out.push([from, to]);
    from = to;
  }
  return out;
}
