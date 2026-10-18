// Доменная модель (PRIMO_SPEC.md, раздел 5).

export type ServerId = 'asia' | 'tw_hk_mo' | 'europe' | 'america';
export type Confidence =
  | 'official'
  | 'announced'
  | 'video'
  | 'tally'
  | 'derived'
  | 'conflict'
  | 'projected'
  | 'leak'
  | 'user'
  | 'unknown';
/** UTC, всегда с 'Z' (I1). */
export type ISO = string;

export const CURRENCIES = ['primo', 'crystal', 'if', 'af', 'starglitter', 'stardust'] as const;
export type Currency = (typeof CURRENCIES)[number];
export type Reward = { [K in Currency]?: number | null };

// ── время в данных (4.2) ───────────────────────────────────────────────────
export type Clock = 'server' | 'utc8';
export interface RawTime {
  at: string; // 'YYYY-MM-DDTHH:mm'
  clock: Clock;
}

// ── версии, баннеры, ивенты, регулярные источники ─────────────────────────
export interface Version {
  id: string;
  name?: string;
  start: ISO;
  phase2Start: ISO;
  end: ISO;
  specialProgram?: ISO;
  durationDaysOverride?: number;
  confidence: Confidence;
  /** Конец БП, 03:59 server (4.3). */
  bpEnd: ISO;
  /** Закрытие покупки БП, 02:59 server (4.3). */
  bpPurchaseEnd: ISO;
  /** «Дедлайн конца версии», 14:59 server (4.3). */
  endDeadline: ISO;
  /** Версии нет в датапаке — сгенерирована проекцией «старт + 42 дня». */
  generated: boolean;
}

export interface Banner {
  id: string;
  versionId: string;
  phase: 1 | 2 | null;
  kind: 'character' | 'weapon' | 'chronicled';
  featured5: string[];
  featured4: string[];
  start: ISO;
  end: ISO;
  confidence: Confidence;
}

export type Category =
  'daily' | 'endgame' | 'shop' | 'version_fixed' | 'event' | 'paid' | 'external' | 'special' | 'one_time';

export type VersionAnchor = 'start' | 'phase2' | 'bpEnd' | 'versionEndDeadline';
export type Schedule =
  | { kind: 'daily' }
  | { kind: 'monthly'; day: number }
  | {
      kind: 'perVersion';
      anchor: VersionAnchor;
      offsetDays: number;
      windowDays?: number;
      deadlineAnchor?: 'versionEnd' | 'bpEnd' | 'versionEndDeadline';
    }
  | { kind: 'perPhase' }
  | { kind: 'subscription'; perPurchase: Reward; days: number; maxDays: number }
  | { kind: 'fixed'; from: ISO; to?: ISO };

export type TrackerKind = 'abyss' | 'theater' | 'stygian' | 'hoyolab';

export interface SourceRule {
  id: string;
  title: string;
  category: Category;
  reward: Reward;
  expected?: Reward;
  expectedMin?: Reward;
  schedule: Schedule;
  paid: boolean;
  enabled: boolean;
  claimLagHours: number;
  tracker?: TrackerKind;
  confidence: Confidence;
  ref?: string;
}

export type OccStatus = 'planned' | 'claimed' | 'missed' | 'skipped';

export interface Occurrence {
  id: string;
  ruleId?: string;
  eventId?: string;
  versionId?: string;
  title: string;
  category: Category;
  paid: boolean;
  tracker?: TrackerKind;
  /** Виртуальная покупка луны (welkinPlanned = 'keepActive'). */
  virtual?: boolean;
  from: ISO;
  deadline?: ISO;
  expectedClaimAt: ISO;
  reward: Reward;
  expected: Reward;
  expectedMin?: Reward;
  status: OccStatus;
  claimedAt?: ISO;
  actual?: Reward;
  confidence: Confidence;
}

/** Документ коллекции `occ_status` (14.3): только статус и факт. */
export interface OccStatusDoc {
  id: string;
  status: OccStatus;
  claimedAt?: ISO;
  actual?: Reward;
}

export interface EventTask {
  id: string;
  title: string;
  reward: Reward;
  done: boolean;
}

export interface LimitedEvent {
  id: string;
  versionId: string;
  title: string;
  start: ISO;
  end: ISO | null;
  reward: Reward;
  nonPrimoReward?: string;
  tasks?: EventTask[];
  /** Слот шаблона ивентов версии, который занимает этот ивент (`small` / `big`). */
  slot?: string;
  confidence: Confidence;
  ref?: string;
  note?: string;
}

/** Слот шаблона ивентов версии: `count` ивентов по `reward`. */
export interface EventSlot {
  id: string;
  title: string;
  count: number;
  reward: Reward;
  note?: string;
}

/**
 * Шаблон будущих ивентов версии (датапак, `eventTemplate`; правится в админке):
 * 2 × 420 + 1 × 950, переопределения по версиям; пробные персонажи — сумма за фазу без объявленных баннеров.
 */
export interface EventTemplate {
  confidence: Confidence;
  slots: EventSlot[];
  trialsPerPhase?: Reward;
  versions?: Record<string, Record<string, Partial<Omit<EventSlot, 'id'>>>>;
  ref?: string;
  note?: string;
}

// ── регионы и разовый контент (раздел 11) ──────────────────────────────────
export type RegionId = string;
export type Editor = 'chests' | 'amount' | 'count' | 'level' | 'checklist' | 'binary';
export type ChestBracket = 'low' | 'high' | 'mixed';

export interface ChestType {
  id: string;
  name: string;
  values: { low: number; high: number };
  variants?: number[];
  confidence: Confidence;
  note?: string;
}

export interface LevelRow {
  level: number;
  primo?: number;
  af?: number;
  if?: number;
  key?: number;
  req?: number;
}

export interface LevelSchedule {
  id: string;
  title: string;
  levels: LevelRow[];
  confidence: Confidence;
  ref: string;
}

export type CategoryKind =
  | 'chests'
  | 'side_quests'
  | 'archon_quests'
  | 'waypoints'
  | 'statue'
  | 'offering'
  | 'shrines'
  | 'domains'
  | 'shadow_realm'
  | 'other';

export interface ChestCounts {
  common?: number;
  exquisite?: number;
  precious?: number;
  luxurious?: number;
  remarkable?: number;
  total?: number;
  asOf: string;
  source: string;
}

export interface CategoryDef {
  id: string;
  kind: CategoryKind;
  title: string;
  total: Reward | null;
  editor: Editor;
  unit?: Reward;
  count?: number | null;
  countDerived?: boolean;
  chestCounts?: ChestCounts;
  schedule?: string | null;
  multiplier?: number;
  /** Таблица уровней прямо в категории (общие источники: чайник). */
  levels?: LevelRow[];
  items?: string[];
  quick?: number[];
  maxLevelNow?: number;
  maxLevelNowNote?: string;
  confidence: Confidence;
  note?: string;
  ref?: string;
}

export interface Area {
  id: string;
  regionId: RegionId;
  name: string;
  addedIn?: string;
  chestBracket: ChestBracket;
  videoTotal?: Reward;
  categories: CategoryDef[];
  note?: string;
}

export interface Region {
  id: RegionId;
  name: string;
  videoChapter?: string | null;
  areas: Area[];
}

export interface GeneralSource extends Omit<CategoryDef, 'kind'> {
  levels?: LevelRow[];
}

export type ChestVariant = 'low' | 'high' | number;

export interface CategoryProgress {
  categoryId: string;
  amount?: Reward;
  count?: number;
  levels?: number[];
  checked?: string[];
  done?: boolean;
  chestCounts?: Record<string, Record<string, number>>;
  chestLog?: { type: string; variant: ChestVariant; delta: 1 | -1; at: ISO }[];
  flagSnapshot?: Omit<CategoryProgress, 'flagSnapshot'>;
  updatedAt: ISO;
}

export type AreaPlan = { kind: 'none' } | { kind: 'byDate'; at: ISO } | { kind: 'rate' };

export interface AreaState {
  areaId: string;
  chests100: boolean;
  closed: boolean;
  plan: AreaPlan;
}

export interface RegionState {
  regionId: RegionId;
  closed: boolean;
}

// ── эндгейм (раздел 12) ────────────────────────────────────────────────────
export interface AbyssCycle {
  id: string;
  stars: [number, number, number][];
  claimed: boolean;
}
export type TheaterDifficulty = 'easy' | 'normal' | 'hard' | 'visionary' | 'lunar';
export interface TheaterSeason {
  id: string;
  difficulty: TheaterDifficulty;
  acts: number;
  arcana: number;
  claimed: boolean;
}
export interface StygianIteration {
  id: string;
  maxDifficulty: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  claimed: boolean;
}
export interface HoyolabMonth {
  id: string;
  checkIns: number;
}

// ── кошелёк, цели, оплата ──────────────────────────────────────────────────
export interface Pity {
  char: number;
  charGuaranteed: boolean;
  radiance: 0 | 1 | 2 | 3;
  weapon: number;
  weaponGuaranteed: boolean;
  weaponFatePoint: number;
  char4?: number;
  weapon4?: number;
}

export interface Balance {
  primo: number;
  crystal: number;
  if: number;
  af: number;
  starglitter: number;
  stardust: number;
}

export interface WalletSnapshot extends Balance {
  at: ISO;
  pity: Pity;
}

export type LedgerReason = 'claim' | 'progress' | 'spend_pulls' | 'purchase' | 'manual';
export interface LedgerEntry {
  id: string;
  at: ISO;
  delta: Reward;
  reason: LedgerReason;
  refId?: string;
}

export interface PaymentProfile {
  welkinPurchases: { id: string; at: ISO }[];
  welkinPlanned: 'none' | 'keepActive';
  bpPaid: 'never' | 'everyVersion' | { versions: string[] };
  plannedTopUps: { at: ISO; crystal: number }[];
}

export type GoalNeed =
  | { kind: 'pulls'; n: number }
  | { kind: 'char5'; copies: number }
  | { kind: 'weapon5'; copies: number }
  | { kind: 'sum'; parts: GoalNeed[] };

export interface Goal {
  id: string;
  title: string;
  target: { kind: 'date'; at: ISO } | { kind: 'banner'; bannerId: string; point: 'start' | 'end' };
  need: GoalNeed;
}

export interface Override {
  entity: string;
  id: string;
  field: string;
  value: unknown;
  at: ISO;
}
