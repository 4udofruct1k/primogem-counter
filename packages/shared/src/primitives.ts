import { z } from 'zod';

export const ServerIdSchema = z.enum(['asia', 'tw_hk_mo', 'europe', 'america']);
export type ServerId = z.infer<typeof ServerIdSchema>;

export const ConfidenceSchema = z.enum([
  'official',
  'announced',
  'video',
  'tally',
  'derived',
  'conflict',
  'projected',
  'leak',
  'user',
  'unknown',
]);

/** UTC ISO с 'Z' (I1); миллисекунды допускаются. */
export const IsoSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/, 'ожидается UTC ISO с Z');

const amount = z.number().finite().nullable().optional();
export const RewardSchema = z.object({
  primo: amount,
  crystal: amount,
  if: amount,
  af: amount,
  starglitter: amount,
  stardust: amount,
});

export const DocIdSchema = z.string().min(1).max(200);

/** Длина строки в байтах UTF-8 — без TextEncoder и копии строки. */
export function utf8Length(s: string): number {
  let n = s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) continue;
    if (c < 0x800) n += 1;
    // суррогатная пара — 4 байта на две единицы UTF-16, одиночная — 3 байта (как U+FFFD)
    else if (c >= 0xd800 && c <= 0xdbff && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 2;
      i++;
    } else n += 2;
  }
  return n;
}

/** Размер значения в JSON, байты UTF-8: так документ уходит по сети и учитывается в лимитах (D-312). */
export function jsonBytes(value: unknown): number {
  const s = JSON.stringify(value) as string | undefined;
  return s === undefined ? 0 : utf8Length(s);
}

/** Свободное поле без своей схемы — не больше `kb` КБ в JSON (D-312). */
export const maxJson = <T extends z.ZodType>(schema: T, kb: number): T =>
  schema.refine((v) => jsonBytes(v) <= kb * 1024, `не больше ${kb} КБ в JSON`);

const nonNeg = z.number().int().min(0);
export const PitySchema = z.object({
  char: nonNeg.max(89),
  charGuaranteed: z.boolean(),
  radiance: z.literal([0, 1, 2, 3]),
  weapon: nonNeg.max(79),
  weaponGuaranteed: z.boolean(),
  weaponFatePoint: nonNeg.max(2),
  char4: nonNeg.max(9).optional(),
  weapon4: nonNeg.max(9).optional(),
});
