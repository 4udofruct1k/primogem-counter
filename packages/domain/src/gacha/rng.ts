// Генератор случайных чисел симулятора (13.4): xoshiro128**, засеянный splitmix32(baseSeed + i).
// Прогон i зависит только от (ввод, i) — результат не зависит от числа воркеров (TC-35).

const GOLDEN_GAMMA = 0x9e3779b9;
const TWO_POW_32 = 4294967296;

/** Смешивающая функция splitmix32 (выход — uint32). */
function mix32(z: number): number {
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) >>> 0;
}

/** splitmix32: состояние += 0x9e3779b9, выход — mix32(состояние). */
export class SplitMix32 {
  private s: number;

  constructor(seed: number) {
    this.s = seed | 0;
  }

  next(): number {
    this.s = (this.s + GOLDEN_GAMMA) | 0;
    return mix32(this.s);
  }
}

/** xoshiro128** — 32-битный генератор, числа [0, 1) с шагом 2⁻³². */
export class Xoshiro128ss {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;

  constructor(seed = 0) {
    this.reseed(seed);
  }

  /** Генератор из готового состояния (эталонные тесты). */
  static fromState(a: number, b: number, c: number, d: number): Xoshiro128ss {
    const x = new Xoshiro128ss();
    x.a = a | 0;
    x.b = b | 0;
    x.c = c | 0;
    x.d = d | 0;
    return x;
  }

  /** Состояние — четыре выхода splitmix32(seed); один объект на пакет, без аллокаций на прогон. */
  reseed(seed: number): void {
    let s = seed | 0;
    s = (s + GOLDEN_GAMMA) | 0;
    this.a = mix32(s) | 0;
    s = (s + GOLDEN_GAMMA) | 0;
    this.b = mix32(s) | 0;
    s = (s + GOLDEN_GAMMA) | 0;
    this.c = mix32(s) | 0;
    s = (s + GOLDEN_GAMMA) | 0;
    this.d = mix32(s) | 0;
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1; // нулевое состояние xoshiro вырождено
  }

  nextU32(): number {
    const b = this.b;
    const m = Math.imul(b, 5);
    const r = Math.imul((m << 7) | (m >>> 25), 9);
    const t = b << 9;
    this.c ^= this.a;
    this.d ^= b;
    this.b = b ^ this.c;
    this.a ^= this.d;
    this.c ^= t;
    this.d = (this.d << 11) | (this.d >>> 21);
    return r >>> 0;
  }

  /** Равномерное число [0, 1). */
  next(): number {
    return this.nextU32() / TWO_POW_32;
  }
}

/** Seed прогона i: baseSeed + i по модулю 2³² (13.4). */
export function runSeed(baseSeed: number, i: number): number {
  return (baseSeed + i) >>> 0;
}

export function rngForRun(baseSeed: number, i: number): Xoshiro128ss {
  return new Xoshiro128ss(runSeed(baseSeed, i));
}
