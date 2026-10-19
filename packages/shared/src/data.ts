// Игровые данные: манифест /data, датапак, seed регионов и патч админки (14.6, 16).
import { z } from 'zod';
import { ConfidenceSchema, RewardSchema } from './primitives';

const RawTimeSchema = z.object({ at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), clock: z.enum(['server', 'utc8']) });
const id = z.string().min(1).max(100);

export const RawVersionSchema = z.looseObject({
  id,
  name: z.string().optional(),
  start: RawTimeSchema.optional(),
  phase2Start: RawTimeSchema.optional(),
  specialProgram: RawTimeSchema.optional(),
  durationDaysOverride: z.number().int().min(1).max(120).optional(),
  confidence: ConfidenceSchema,
});

export const RawBannerSchema = z.looseObject({
  id,
  versionId: z.string(),
  phase: z.union([z.literal(1), z.literal(2), z.null()]),
  kind: z.enum(['character', 'weapon', 'chronicled']),
  featured5: z.array(z.string()),
  featured4: z.array(z.string()),
  start: RawTimeSchema,
  end: RawTimeSchema,
  confidence: ConfidenceSchema,
});

export const RawEventSchema = z.looseObject({
  id,
  versionId: z.string(),
  title: z.string(),
  start: RawTimeSchema,
  end: RawTimeSchema.nullable(),
  reward: RewardSchema,
  nonPrimoReward: z.string().optional(),
  tasks: z.array(z.object({ id, title: z.string(), reward: RewardSchema, done: z.boolean() })).optional(),
  slot: z.string().optional(),
  confidence: ConfidenceSchema,
  ref: z.string().optional(),
  note: z.string().optional(),
});

export const RawRuleSchema = z.looseObject({
  id,
  title: z.string().optional(),
  category: z.string().optional(),
  reward: RewardSchema,
  expected: RewardSchema.optional(),
  expectedMin: RewardSchema.optional(),
  schedule: z.looseObject({ kind: z.enum(['daily', 'monthly', 'perVersion', 'perPhase', 'subscription', 'fixed']) }),
  paid: z.boolean(),
  enabled: z.boolean().optional(),
  claimLagHours: z.number().min(0),
  tracker: z.enum(['abyss', 'theater', 'stygian', 'hoyolab']).optional(),
  confidence: ConfidenceSchema,
  ref: z.string().optional(),
});

export const EventSlotSchema = z.object({
  id,
  title: z.string(),
  count: z.number().int().min(0).max(10),
  reward: RewardSchema,
  note: z.string().optional(),
});
export const EventTemplateSchema = z.object({
  confidence: ConfidenceSchema,
  slots: z.array(EventSlotSchema),
  trialsPerPhase: RewardSchema.optional(),
  versions: z.record(z.string(), z.record(z.string(), EventSlotSchema.omit({ id: true }).partial())).optional(),
  ref: z.string().optional(),
  note: z.string().optional(),
});

export const DatapackSchema = z.looseObject({
  packVersion: z.number().int(),
  generatedAt: z.string(),
  gameVersion: z.string(),
  versions: z.array(RawVersionSchema).min(1),
  banners: z.array(RawBannerSchema),
  events: z.array(RawEventSchema),
  rules: z.array(RawRuleSchema),
  eventTemplate: EventTemplateSchema.optional(),
  notes: z.array(z.string()).optional(),
});

export const SeedSchema = z.looseObject({
  schemaVersion: z.number().int(),
  chestTypes: z.array(z.looseObject({ id, name: z.string(), values: z.object({ low: z.number(), high: z.number() }) })),
  levelSchedules: z.record(z.string(), z.looseObject({ title: z.string(), levels: z.array(z.looseObject({ level: z.number() })) })),
  regions: z.array(
    z.looseObject({
      id,
      name: z.string(),
      areas: z.array(z.looseObject({ id, name: z.string(), chestBracket: z.enum(['low', 'high', 'mixed']), categories: z.array(z.looseObject({ kind: z.string(), editor: z.string() })) })),
    }),
  ),
  general: z.array(z.looseObject({ id, editor: z.string() })),
  endgame: z.looseObject({}),
});

/** Запись патча с `_delete: true` удаляет запись пака с этим id. */
const deletable = <T extends z.ZodType>(s: T) => z.union([s, z.object({ id, _delete: z.literal(true) })]);

/** Патч админки поверх датапака (16): записи мержатся по id, шаблон ивентов — по слотам и версиям. */
export const DatapackPatchSchema = z.object({
  versions: z.array(deletable(RawVersionSchema.partial().required({ id: true }))).optional(),
  banners: z.array(deletable(RawBannerSchema.partial().required({ id: true }))).optional(),
  events: z.array(deletable(RawEventSchema.partial().required({ id: true }))).optional(),
  rules: z.array(deletable(RawRuleSchema.partial().required({ id: true }))).optional(),
  eventTemplate: EventTemplateSchema.partial().optional(),
  notes: z.array(z.string()).optional(),
});
export type DatapackPatch = z.infer<typeof DatapackPatchSchema>;

const FileRefSchema = z.object({ path: z.string(), sha256: z.string() });
export const ManifestSchema = z.object({
  generatedAt: z.string(),
  packVersion: z.number(),
  seedSchemaVersion: z.number(),
  files: z.object({ datapack: FileRefSchema, seed: FileRefSchema }),
  patch: z.object({ version: z.number().int(), sha256: z.string(), path: z.string(), updatedAt: z.string() }).nullable(),
});
export type Manifest = z.infer<typeof ManifestSchema>;
