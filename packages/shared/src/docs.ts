// Документы пользователя по коллекциям (14.3). Схемы общие для клиента и сервера.
import type * as D from '@primo/domain';
import { z } from 'zod';
import { DocIdSchema, IsoSchema, PitySchema, RewardSchema, ServerIdSchema } from './primitives';

const int = z.number().int();
const nonNeg = int.min(0);
const balance = {
  primo: z.number().finite(),
  crystal: z.number().finite(),
  if: z.number().finite(),
  af: z.number().finite(),
  starglitter: z.number().finite(),
  stardust: z.number().finite(),
};

export const WalletSnapshotSchema = z.object({ id: DocIdSchema, at: IsoSchema, ...balance, pity: PitySchema });

export const LedgerEntrySchema = z.object({
  id: DocIdSchema,
  at: IsoSchema,
  delta: RewardSchema,
  reason: z.enum(['claim', 'progress', 'spend_pulls', 'purchase', 'manual']),
  refId: z.string().max(200).optional(),
});

export const OccStatusSchema = z.object({
  id: DocIdSchema,
  status: z.enum(['planned', 'claimed', 'missed', 'skipped']),
  claimedAt: IsoSchema.optional(),
  actual: RewardSchema.optional(),
});

const chestVariant = z.union([z.literal('low'), z.literal('high'), z.number().positive()]);
const progressFields = {
  categoryId: DocIdSchema,
  amount: RewardSchema.optional(),
  count: nonNeg.optional(),
  levels: z.array(nonNeg).max(50).optional(),
  checked: z.array(z.string().max(300)).max(200).optional(),
  done: z.boolean().optional(),
  chestCounts: z.record(z.string(), z.record(z.string(), nonNeg)).optional(),
  chestLog: z
    .array(
      z.object({
        type: z.string(),
        variant: chestVariant,
        delta: z.union([z.literal(1), z.literal(-1)]),
        at: IsoSchema,
      }),
    )
    .max(50)
    .optional(),
  updatedAt: z.string(),
};
export const CategoryProgressSchema = z.object({
  ...progressFields,
  flagSnapshot: z.object(progressFields).optional(),
});

export const AreaPlanSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('byDate'), at: IsoSchema }),
  z.object({ kind: z.literal('rate') }),
]);
export const AreaStateSchema = z.object({
  areaId: DocIdSchema,
  chests100: z.boolean(),
  closed: z.boolean(),
  plan: AreaPlanSchema,
});
export const RegionStateSchema = z.object({ regionId: DocIdSchema, closed: z.boolean() });

const stars = int.min(0).max(3);
export const AbyssCycleSchema = z.object({
  id: DocIdSchema,
  stars: z.array(z.tuple([stars, stars, stars])).length(4),
  claimed: z.boolean(),
});
export const TheaterSeasonSchema = z.object({
  id: DocIdSchema,
  difficulty: z.enum(['easy', 'normal', 'hard', 'visionary', 'lunar']),
  acts: int.min(0).max(10),
  arcana: int.min(0).max(2),
  claimed: z.boolean(),
});
export const StygianIterationSchema = z.object({
  id: DocIdSchema,
  maxDifficulty: z.literal([0, 1, 2, 3, 4, 5, 6]),
  claimed: z.boolean(),
});
export const HoyolabMonthSchema = z.object({ id: DocIdSchema, checkIns: int.min(0).max(31) });

type Need = D.GoalNeed;
export const GoalNeedSchema: z.ZodType<Need> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal('pulls'), n: nonNeg }),
    z.object({ kind: z.literal('char5'), copies: int.min(1).max(7) }),
    z.object({ kind: z.literal('weapon5'), copies: int.min(1).max(5) }),
    z.object({ kind: z.literal('sum'), parts: z.array(GoalNeedSchema).max(10) }),
  ]),
);
export const GoalSchema = z.object({
  id: DocIdSchema,
  title: z.string().max(200),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('date'), at: IsoSchema }),
    z.object({ kind: z.literal('banner'), bannerId: z.string(), point: z.enum(['start', 'end']) }),
  ]),
  need: GoalNeedSchema,
});

export const PaymentProfileSchema = z.object({
  welkinPurchases: z.array(z.object({ id: DocIdSchema, at: IsoSchema })).max(500),
  welkinPlanned: z.enum(['none', 'keepActive']),
  bpPaid: z.union([
    z.literal('never'),
    z.literal('everyVersion'),
    z.object({ versions: z.array(z.string().max(20)).max(200) }),
  ]),
  plannedTopUps: z.array(z.object({ at: IsoSchema, crystal: nonNeg })).max(200),
});

export const OverrideSchema = z.object({
  entity: z.string().max(50),
  id: DocIdSchema,
  field: z.string().max(100),
  value: z.unknown(),
  at: IsoSchema,
});

const expectationMode = z.object({
  mode: z.enum(['pack', 'max', 'last', 'avg3', 'manual']),
  primo: nonNeg.optional(),
  min: z.union([z.literal('pack'), z.literal('min3'), nonNeg]).optional(),
});

export const SettingsSchema = z.object({
  server: ServerIdSchema,
  countCrystals: z.boolean(),
  countStarglitter: z.boolean(),
  autoApplyClaims: z.boolean(),
  /** Переопределения claimLagHours по id правила (раздел 6). */
  claimLagHours: z.record(z.string(), z.number().min(0).max(24 * 60)),
  /** Ожидания эндгейма для прогноза по id правила (abyss / theater / stygian). */
  expectations: z.record(z.string(), expectationMode),
  /** Темп разового контента, примогемов в неделю (11.6), 0 = выкл. */
  weeklyOneTimePrimo: nonNeg,
  /** Магазин пыли: крутки в месяц (D-104). */
  stardustShop: z.object({ if: int.min(0).max(5), af: int.min(0).max(5) }),
  notifications: z.object({ enabled: z.boolean(), minPrimo: nonNeg }),
  scenario: z.enum(['min', 'expected', 'max']),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  server: 'europe',
  countCrystals: true,
  countStarglitter: false,
  autoApplyClaims: true,
  claimLagHours: {},
  expectations: {},
  weeklyOneTimePrimo: 0,
  stardustShop: { if: 0, af: 0 },
  notifications: { enabled: true, minPrimo: 100 },
  scenario: 'expected',
};

/** Параметры симулятора (раздел 13) — схема уточняется в M9, сервер хранит как есть. */
export const SimPresetSchema = z.record(z.string(), z.unknown());

/** Пользовательские области, категории, ивенты (11.1) — `confidence: 'user'`. */
export const UserEntitySchema = z.object({
  id: DocIdSchema,
  kind: z.enum(['area', 'category', 'event']),
  data: z.record(z.string(), z.unknown()),
});

export const COLLECTIONS = [
  'wallet_snapshot',
  'ledger',
  'occ_status',
  'cat_progress',
  'area_state',
  'region_state',
  'abyss',
  'theater',
  'stygian',
  'hoyolab',
  'goal',
  'payment',
  'override',
  'settings',
  'sim_preset',
  'user_entity',
] as const;
export type Collection = (typeof COLLECTIONS)[number];
export const CollectionSchema = z.enum(COLLECTIONS);

export const COLLECTION_SCHEMAS = {
  wallet_snapshot: WalletSnapshotSchema,
  ledger: LedgerEntrySchema,
  occ_status: OccStatusSchema,
  cat_progress: CategoryProgressSchema,
  area_state: AreaStateSchema,
  region_state: RegionStateSchema,
  abyss: AbyssCycleSchema,
  theater: TheaterSeasonSchema,
  stygian: StygianIterationSchema,
  hoyolab: HoyolabMonthSchema,
  goal: GoalSchema,
  payment: PaymentProfileSchema,
  override: OverrideSchema,
  settings: SettingsSchema,
  sim_preset: SimPresetSchema,
  user_entity: UserEntitySchema,
} satisfies Record<Collection, z.ZodType>;

export type DocOf<C extends Collection> = z.infer<(typeof COLLECTION_SCHEMAS)[C]>;

/** Коллекции только с добавлением (14.5): уникальные id, не конфликтуют. */
export const APPEND_ONLY: readonly Collection[] = ['ledger', 'wallet_snapshot'];

/** Проверка документа коллекции; возвращает очищенные данные или ошибку. */
export function parseDoc<C extends Collection>(collection: C, data: unknown) {
  return COLLECTION_SCHEMAS[collection].safeParse(data) as z.ZodSafeParseResult<DocOf<C>>;
}

// совместимость с доменными типами: схема должна давать значения доменного типа
const _compat: [
  z.ZodType<Omit<D.WalletSnapshot, never>>,
  z.ZodType<D.LedgerEntry>,
  z.ZodType<D.OccStatusDoc>,
  z.ZodType<D.CategoryProgress>,
  z.ZodType<D.AreaState>,
  z.ZodType<D.RegionState>,
  z.ZodType<D.AbyssCycle>,
  z.ZodType<D.TheaterSeason>,
  z.ZodType<D.StygianIteration>,
  z.ZodType<D.HoyolabMonth>,
  z.ZodType<D.Goal>,
  z.ZodType<D.PaymentProfile>,
  z.ZodType<D.Override>,
] = [
  WalletSnapshotSchema,
  LedgerEntrySchema,
  OccStatusSchema,
  CategoryProgressSchema,
  AreaStateSchema,
  RegionStateSchema,
  AbyssCycleSchema,
  TheaterSeasonSchema,
  StygianIterationSchema,
  HoyolabMonthSchema,
  GoalSchema,
  PaymentProfileSchema,
  OverrideSchema,
];
void _compat;
