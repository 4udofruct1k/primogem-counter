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
export const IsoSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/, 'ожидается UTC ISO с Z');

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
