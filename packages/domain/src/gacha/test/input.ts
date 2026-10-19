// Помощники тестов симулятора.
import type { Pity } from '../../types';
import { makeModel, STARGLITTER_DEFAULTS } from '../model';
import type { Ramp, SimInput } from '../types';

export const pity = (p: Partial<Pity> = {}): Pity => ({
  char: 0,
  charGuaranteed: false,
  radiance: 0,
  weapon: 0,
  weaponGuaranteed: false,
  weaponFatePoint: 0,
  ...p,
});

export const simInput = (p: Partial<SimInput> = {}): SimInput => ({
  budget: 0,
  pity: pity(),
  mode: 'char_only',
  consTarget: 0,
  refTarget: 1,
  runs: 10000,
  seed: 20261019,
  starglitter: { ...STARGLITTER_DEFAULTS },
  model: makeModel('community'),
  ...p,
});

/** Детерминированная «лесенка»: 0% до крутки n, 100% на крутке n. */
export const always = (n: number): Ramp => ({ base: 0, start: n, step: 0, hard: n });
