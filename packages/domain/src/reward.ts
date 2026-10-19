import { CURRENCIES, type Reward } from './types';

/** Сумма наград по валютам; null считается 0 (I5). Нулевые валюты не попадают в результат. */
export function addRewards(...rewards: (Reward | null | undefined)[]): Reward {
  const out: Reward = {};
  for (const r of rewards) {
    if (!r) continue;
    for (const c of CURRENCIES) {
      const v = r[c];
      if (v) out[c] = (out[c] ?? 0) + v;
    }
  }
  return normalize(out);
}

export function scaleReward(r: Reward | null | undefined, k: number): Reward {
  const out: Reward = {};
  if (!r) return out;
  for (const c of CURRENCIES) {
    const v = r[c];
    if (v) out[c] = v * k;
  }
  return normalize(out);
}

export function subtractRewards(a: Reward | null | undefined, b: Reward | null | undefined): Reward {
  return addRewards(a, scaleReward(b, -1));
}

/** max(0, a − b) по каждой валюте. */
export function subtractClamped(a: Reward | null | undefined, b: Reward | null | undefined): Reward {
  const diff = subtractRewards(a, b);
  const out: Reward = {};
  for (const c of CURRENCIES) {
    const v = diff[c];
    if (v && v > 0) out[c] = v;
  }
  return out;
}

/** min(a, b) по каждой валюте (отсутствующая валюта = 0). */
export function minRewards(a: Reward | null | undefined, b: Reward | null | undefined): Reward {
  const out: Reward = {};
  for (const c of CURRENCIES) {
    const v = Math.min(a?.[c] ?? 0, b?.[c] ?? 0);
    if (v) out[c] = v;
  }
  return out;
}

export function hasNull(r: Reward | null | undefined): boolean {
  if (r === null || r === undefined) return true;
  return CURRENCIES.some((c) => r[c] === null);
}

export function isZero(r: Reward | null | undefined): boolean {
  return !r || CURRENCIES.every((c) => !r[c]);
}

export function rewardEquals(a: Reward | null | undefined, b: Reward | null | undefined): boolean {
  return CURRENCIES.every((c) => (a?.[c] ?? 0) === (b?.[c] ?? 0));
}

/** Есть ли в `a` хоть одна валюта больше, чем в `b`. */
export function exceeds(a: Reward | null | undefined, b: Reward | null | undefined): boolean {
  return CURRENCIES.some((c) => (a?.[c] ?? 0) > (b?.[c] ?? 0));
}

function normalize(r: Reward): Reward {
  for (const c of CURRENCIES) {
    if (r[c] === 0) delete r[c];
  }
  return r;
}

/** Глубокая копия JSON-совместимых данных (документы и игровые данные). */
export function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
