// Разбор датапака (раздел 16, приложение A): резолв времени под сервер и нормализация правил.
import { RULE_META } from './catalog';
import { resolveTime } from './time';
import type {
  Banner,
  Category,
  Confidence,
  EventTask,
  EventSlot,
  EventTemplate,
  LimitedEvent,
  RawTime,
  Reward,
  Schedule,
  ServerId,
  SourceRule,
  TrackerKind,
} from './types';
import type { RawVersion } from './versions';

export interface RawBanner {
  id: string;
  versionId: string;
  phase: number | null;
  kind: string;
  featured5: string[];
  featured4: string[];
  start: RawTime;
  end: RawTime;
  confidence: string;
}

export interface RawEvent {
  id: string;
  versionId: string;
  title: string;
  start: RawTime;
  end: RawTime | null;
  reward: Reward;
  nonPrimoReward?: string;
  tasks?: EventTask[];
  slot?: string;
  confidence: string;
  ref?: string;
  note?: string;
}

export interface RawRule {
  id: string;
  title?: string;
  category?: string;
  reward: Reward;
  expected?: Reward;
  expectedMin?: Reward;
  schedule: Record<string, unknown> & { kind: string };
  paid: boolean;
  enabled?: boolean;
  claimLagHours: number;
  tracker?: string;
  confidence: string;
  ref?: string;
}

export interface RawDatapack {
  packVersion: number;
  generatedAt: string;
  gameVersion: string;
  versions: RawVersion[];
  banners: RawBanner[];
  events: RawEvent[];
  rules: RawRule[];
  eventTemplate?: EventTemplate;
  notes?: string[];
}

export function resolveBanners(raw: RawBanner[], server: ServerId): Banner[] {
  return raw.map((b) => ({
    id: b.id,
    versionId: b.versionId,
    phase: b.phase === 1 || b.phase === 2 ? b.phase : null,
    kind: b.kind as Banner['kind'],
    featured5: [...b.featured5],
    featured4: [...b.featured4],
    start: resolveTime(b.start, server),
    end: resolveTime(b.end, server),
    confidence: b.confidence as Confidence,
  }));
}

export function resolveEvents(raw: RawEvent[], server: ServerId): LimitedEvent[] {
  return raw.map((e) => {
    const ev: LimitedEvent = {
      id: e.id,
      versionId: e.versionId,
      title: e.title,
      start: resolveTime(e.start, server),
      end: e.end ? resolveTime(e.end, server) : null,
      reward: { ...e.reward },
      confidence: e.confidence as Confidence,
    };
    if (e.nonPrimoReward) ev.nonPrimoReward = e.nonPrimoReward;
    if (e.tasks) ev.tasks = e.tasks.map((t) => ({ ...t, reward: { ...t.reward } }));
    if (e.slot) ev.slot = e.slot;
    if (e.ref) ev.ref = e.ref;
    if (e.note) ev.note = e.note;
    return ev;
  });
}

/** Правила датапака → `SourceRule`: недостающие title/category — из каталога, enabled по умолчанию true. */
export function normalizeRules(raw: RawRule[]): SourceRule[] {
  return raw.map((r) => {
    const meta = RULE_META[r.id];
    const rule: SourceRule = {
      id: r.id,
      title: r.title ?? meta?.title ?? r.id,
      category: (r.category as Category | undefined) ?? meta?.category ?? 'special',
      reward: { ...r.reward },
      schedule: r.schedule as unknown as Schedule,
      paid: r.paid,
      enabled: r.enabled ?? true,
      claimLagHours: r.claimLagHours,
      confidence: r.confidence as Confidence,
    };
    if (r.expected) rule.expected = { ...r.expected };
    if (r.expectedMin) rule.expectedMin = { ...r.expectedMin };
    if (r.tracker) rule.tracker = r.tracker as TrackerKind;
    if (r.ref) rule.ref = r.ref;
    return rule;
  });
}

/** Слоты шаблона для версии с учётом переопределений `versions[versionId]`. */
export function slotsForVersion(template: EventTemplate, versionId: string): EventSlot[] {
  const patch = template.versions?.[versionId] ?? {};
  return template.slots.map((slot) => {
    const p = patch[slot.id];
    return p ? { ...slot, ...p, reward: { ...(p.reward ?? slot.reward) } } : slot;
  });
}
