// Материализация вхождений регулярных источников и ивентов (раздел 7).
import { minRewards } from './reward';
import {
  addDays,
  addDaysToDate,
  addHours,
  addMonths,
  atServer,
  hoursBetween,
  maxIso,
  minIso,
  ms,
  serverDateOf,
  serverDayStart,
} from './time';
import type {
  Banner,
  Confidence,
  ISO,
  LimitedEvent,
  Occurrence,
  OccStatusDoc,
  PaymentProfile,
  Reward,
  Schedule,
  ServerId,
  SourceRule,
  Version,
} from './types';

/** Горизонт материализации: now − 1 версия … now + 400 дней. */
export const HORIZON_DAYS_BACK = 42;
export const HORIZON_DAYS_AHEAD = 400;
/** Задержка забора для ивентов: min(168, окно − 24) ч (раздел 6). */
export const EVENT_MAX_LAG_HOURS = 168;
export const EVENT_LAG_MARGIN_HOURS = 24;

export interface StardustShopPlan {
  if: number;
  af: number;
}

export interface MaterializeSettings {
  /** Переопределение claimLagHours по id правила. */
  claimLagHours?: Record<string, number>;
  /** Сколько круток в месяц покупается за звёздную пыль (DECISIONS D-104), по умолчанию 0 + 0. */
  stardustShop?: StardustShopPlan;
}

export interface MaterializeInput {
  now: ISO;
  server: ServerId;
  versions: Version[];
  banners: Banner[];
  events: LimitedEvent[];
  rules: SourceRule[];
  payment: PaymentProfile;
  /** Версии, в которых по seed появились новые области (11.7) — для них нет new_content_tpl. */
  newContentVersions?: string[];
  settings?: MaterializeSettings;
  horizon?: { from: ISO; to: ISO };
}

export function defaultHorizon(now: ISO): { from: ISO; to: ISO } {
  return { from: addDays(now, -HORIZON_DAYS_BACK), to: addDays(now, HORIZON_DAYS_AHEAD) };
}

export function materialize(input: MaterializeInput): Occurrence[] {
  const horizon = input.horizon ?? defaultHorizon(input.now);
  const out: Occurrence[] = [];
  const push = (o: Occurrence) => {
    if (ms(o.from) < ms(horizon.to) && ms(o.deadline ?? o.from) >= ms(horizon.from)) out.push(o);
  };

  for (const rule of input.rules) {
    if (!rule.enabled) continue;
    const ctx: RuleContext = { input, rule, horizon, push };
    switch (rule.schedule.kind) {
      case 'daily':
        materializeDaily(ctx);
        break;
      case 'monthly':
        materializeMonthly(ctx, rule.schedule.day);
        break;
      case 'perVersion':
        materializePerVersion(ctx, rule.schedule);
        break;
      case 'perPhase':
        materializePerPhase(ctx);
        break;
      case 'subscription':
        materializeSubscription(ctx, rule.schedule);
        break;
      case 'fixed':
        push(occurrence(ctx, rule.id, rule.schedule.from, rule.schedule.to));
        break;
    }
  }

  for (const ev of input.events) {
    // конец ивента неизвестен — забрать можно до «дедлайна конца версии» (DECISIONS D-107)
    const fallback = ev.end ? undefined : input.versions.find((v) => v.id === ev.versionId)?.endDeadline;
    materializeEvent(ev, fallback, push);
  }
  return out;
}

// ── правила ────────────────────────────────────────────────────────────────

interface RuleContext {
  input: MaterializeInput;
  rule: SourceRule;
  horizon: { from: ISO; to: ISO };
  push: (o: Occurrence) => void;
}

function lagHours(ctx: RuleContext): number {
  return ctx.input.settings?.claimLagHours?.[ctx.rule.id] ?? ctx.rule.claimLagHours;
}

function occurrence(
  ctx: RuleContext,
  id: string,
  from: ISO,
  deadline: ISO | undefined,
  extra: Partial<Occurrence> = {},
): Occurrence {
  const { rule } = ctx;
  const o: Occurrence = {
    id,
    ruleId: rule.id,
    title: rule.title,
    category: rule.category,
    paid: rule.paid,
    from,
    expectedClaimAt: expectedClaimAt(from, lagHours(ctx), deadline),
    reward: { ...rule.reward },
    expected: { ...(rule.expected ?? rule.reward) },
    status: 'planned',
    confidence: rule.confidence,
    ...extra,
  };
  if (deadline) o.deadline = deadline;
  if (rule.tracker) o.tracker = rule.tracker;
  if (rule.expectedMin && !o.expectedMin) o.expectedMin = { ...rule.expectedMin };
  return o;
}

/** expectedClaimAt = clamp(from + claimLagHours, from, deadline ?? +∞). */
export function expectedClaimAt(from: ISO, lag: number, deadline?: ISO): ISO {
  const at = addHours(from, Math.max(0, lag));
  return deadline ? minIso(at, maxIso(from, deadline)) : at;
}

function materializeDaily(ctx: RuleContext) {
  const { server } = ctx.input;
  const last = serverDateOf(ctx.horizon.to, server);
  for (let d = serverDateOf(ctx.horizon.from, server); d <= last; d = addDaysToDate(d, 1)) {
    ctx.push(
      occurrence(
        ctx,
        `${ctx.rule.id}:${d}`,
        serverDayStart(d, server),
        serverDayStart(addDaysToDate(d, 1), server),
      ),
    );
  }
}

function materializeMonthly(ctx: RuleContext, day: number) {
  const { server } = ctx.input;
  const resetAt = (month: string) => atServer(`${month}-${String(day).padStart(2, '0')}`, '04:00', server);
  const last = serverDateOf(ctx.horizon.to, server).slice(0, 7);
  for (
    let m = addMonths(serverDateOf(ctx.horizon.from, server).slice(0, 7), -1);
    m <= last;
    m = addMonths(m, 1)
  ) {
    const extra: Partial<Occurrence> = {};
    if (ctx.rule.id === 'stardust_shop') {
      const plan = ctx.input.settings?.stardustShop ?? { if: 0, af: 0 };
      extra.reward = minRewards({ if: plan.if, af: plan.af }, ctx.rule.reward);
      extra.expected = extra.reward;
      extra.confidence = 'user';
    }
    ctx.push(occurrence(ctx, `${ctx.rule.id}:${m}`, resetAt(m), resetAt(addMonths(m, 1)), extra));
  }
}

function versionsInHorizon(ctx: RuleContext): Version[] {
  const from = ms(ctx.horizon.from);
  const to = ms(ctx.horizon.to);
  // окна perVersion выходят за границы версии (коды стрима — до старта), поэтому берём с запасом
  return ctx.input.versions.filter(
    (v) => ms(v.end) + 42 * 86_400_000 > from && ms(v.start) - 42 * 86_400_000 < to,
  );
}

function anchorTime(v: Version, anchor: string): ISO {
  switch (anchor) {
    case 'start':
      return v.start;
    case 'phase2':
      return v.phase2Start;
    case 'bpEnd':
      return v.bpEnd;
    case 'versionEndDeadline':
      return v.endDeadline;
    case 'versionEnd':
      return v.end;
    default:
      throw new Error(`unknown anchor: ${anchor}`);
  }
}

function bpPaidFor(payment: PaymentProfile, versionId: string): boolean {
  const p = payment.bpPaid;
  if (p === 'never') return false;
  if (p === 'everyVersion') return true;
  return p.versions.includes(versionId);
}

function materializePerVersion(ctx: RuleContext, s: Extract<Schedule, { kind: 'perVersion' }>) {
  const { input, rule } = ctx;
  for (const v of versionsInHorizon(ctx)) {
    if (!versionRuleApplies(input, rule.id, v.id)) continue;
    const from =
      rule.id === 'stream_codes' && v.specialProgram
        ? v.specialProgram
        : addDays(anchorTime(v, s.anchor), s.offsetDays);
    const deadline = s.windowDays
      ? addDays(from, s.windowDays)
      : anchorTime(v, s.deadlineAnchor ?? 'versionEnd');
    ctx.push(occurrence(ctx, `${rule.id}:${v.id}`, from, deadline, { versionId: v.id }));
  }
}

/** Подавление правил версии конкретными данными (7; DECISIONS D-102, D-103). */
function versionRuleApplies(input: MaterializeInput, ruleId: string, versionId: string): boolean {
  switch (ruleId) {
    case 'bp_paid':
      return bpPaidFor(input.payment, versionId);
    case 'events_tpl':
      return !input.events.some((e) => e.versionId === versionId && e.confidence !== 'leak');
    case 'new_content_tpl':
      return !(input.newContentVersions ?? []).includes(versionId);
    case 'maint_comp':
      return !input.events.some((e) => e.id === `${versionId}-maint-comp`);
    default:
      return true;
  }
}

function materializePerPhase(ctx: RuleContext) {
  const { input, rule } = ctx;
  for (const v of versionsInHorizon(ctx)) {
    const charBanners = input.banners.filter((b) => b.versionId === v.id && b.kind === 'character');
    for (const phase of [1, 2] as const) {
      // баннер без фазы (`phase: null`) относится к первой фазе (DECISIONS D-105)
      const banners = charBanners.filter((b) => (b.phase ?? 1) === phase);
      const from = phase === 1 ? v.start : v.phase2Start;
      const deadline = phase === 1 ? v.phase2Start : v.end;
      const extra: Partial<Occurrence> = { versionId: v.id };
      if (banners.length === 0) {
        extra.reward = nullReward(rule.reward);
        extra.expected = extra.reward;
        extra.confidence = 'unknown';
      } else {
        const count = banners.reduce((n, b) => n + b.featured5.length, 0);
        extra.reward = scaleKnown(rule.reward, count);
        extra.expected = extra.reward;
        extra.confidence = weakest([rule.confidence, ...banners.map((b) => b.confidence)]);
      }
      ctx.push(occurrence(ctx, `${rule.id}:${v.id}:p${phase}`, from, deadline, extra));
    }
  }
}

function materializeSubscription(ctx: RuleContext, s: Extract<Schedule, { kind: 'subscription' }>) {
  const { input, rule } = ctx;
  const { server } = input;
  const purchases = [...input.payment.welkinPurchases].sort((a, b) => ms(a.at) - ms(b.at));
  const state: { activeEnd: string | null } = { activeEnd: null }; // последняя оплаченная серверная дата

  const buy = (purchaseId: string, at: ISO, virtual: boolean): boolean => {
    const date = serverDateOf(at, server);
    const startDate = state.activeEnd && state.activeEnd >= date ? addDaysToDate(state.activeEnd, 1) : date;
    const remainingAfter = daysInclusive(date, addDaysToDate(startDate, s.days - 1));
    if (remainingAfter > s.maxDays) return false;
    const extra: Partial<Occurrence> = virtual ? { virtual: true } : {};
    ctx.push(
      occurrence(ctx, `${rule.id}:${purchaseId}:buy`, at, undefined, {
        ...extra,
        reward: { ...s.perPurchase },
        expected: { ...s.perPurchase },
      }),
    );
    for (let k = 0; k < s.days; k++) {
      const d = addDaysToDate(startDate, k);
      ctx.push(
        occurrence(
          ctx,
          `${rule.id}:${purchaseId}:d${k}`,
          serverDayStart(d, server),
          serverDayStart(addDaysToDate(d, 1), server),
          extra,
        ),
      );
    }
    state.activeEnd = addDaysToDate(startDate, s.days - 1);
    return true;
  };

  for (const p of purchases) buy(p.id, p.at, false);

  if (input.payment.welkinPlanned === 'keepActive') {
    const today = serverDateOf(input.now, server);
    const lastDate = serverDateOf(ctx.horizon.to, server);
    // виртуальная покупка — в день окончания активной луны (или сегодня, если луны нет)
    let date = state.activeEnd && state.activeEnd >= today ? state.activeEnd : today;
    while (date <= lastDate) {
      if (!buy(`v${date}`, serverDayStart(date, server), true)) break;
      date = state.activeEnd!;
    }
  }
}

function daysInclusive(from: string, to: string): number {
  return Math.round((ms(`${to}T00:00:00Z`) - ms(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

// ── ивенты ─────────────────────────────────────────────────────────────────

function eventLagHours(ev: LimitedEvent): number {
  if (!ev.end) return EVENT_MAX_LAG_HOURS;
  return Math.max(0, Math.min(EVENT_MAX_LAG_HOURS, hoursBetween(ev.start, ev.end) - EVENT_LAG_MARGIN_HOURS));
}

function materializeEvent(
  ev: LimitedEvent,
  fallbackDeadline: ISO | undefined,
  push: (o: Occurrence) => void,
) {
  const deadline = ev.end ?? fallbackDeadline;
  const base = (id: string, title: string, reward: Reward): Occurrence => {
    const o: Occurrence = {
      id,
      eventId: ev.id,
      versionId: ev.versionId,
      title,
      category: 'event',
      paid: false,
      from: ev.start,
      expectedClaimAt: expectedClaimAt(ev.start, eventLagHours(ev), deadline),
      reward: { ...reward },
      expected: { ...reward },
      status: 'planned',
      confidence: ev.confidence,
    };
    if (deadline) o.deadline = deadline;
    return o;
  };
  if (ev.tasks?.length) {
    for (const t of ev.tasks) push(base(`${ev.id}:${t.id}`, `${ev.title} — ${t.title}`, t.reward));
  } else {
    push(base(ev.id, ev.title, ev.reward));
  }
}

// ── статусы ────────────────────────────────────────────────────────────────

/**
 * Накладывает сохранённые статусы (14.3, коллекция occ_status).
 * I3: planned с прошедшим дедлайном → missed; такие id возвращаются в `autoMissed`, чтобы их сохранить.
 */
export function applyStatuses(
  occurrences: Occurrence[],
  docs: OccStatusDoc[] | Record<string, OccStatusDoc>,
  now: ISO,
): { occurrences: Occurrence[]; autoMissed: string[] } {
  const byId = Array.isArray(docs) ? new Map(docs.map((d) => [d.id, d])) : new Map(Object.entries(docs));
  const autoMissed: string[] = [];
  const t = ms(now);
  const result = occurrences.map((o) => {
    const doc = byId.get(o.id);
    const next: Occurrence = { ...o };
    if (doc) {
      next.status = doc.status;
      if (doc.claimedAt) next.claimedAt = doc.claimedAt;
      if (doc.actual) next.actual = doc.actual;
    }
    if (next.status === 'planned' && next.deadline && ms(next.deadline) <= t) {
      next.status = 'missed';
      autoMissed.push(o.id);
    }
    return next;
  });
  return { occurrences: result, autoMissed };
}

/**
 * Попадает ли вхождение в прогноз на момент T: planned, срок не вышел и его можно забрать не позже T.
 * Уже доступное, но не отмеченное — забираемо «сейчас» (DECISIONS D-101).
 */
export function isClaimableBy(o: Occurrence, now: ISO, T: ISO): boolean {
  if (o.status !== 'planned') return false;
  if (o.deadline && ms(o.deadline) <= ms(now)) return false;
  return ms(claimAt(o, now)) <= ms(T);
}

/** Момент, когда вхождение попадает в прогноз: max(expectedClaimAt, now). */
export function claimAt(o: Occurrence, now: ISO): ISO {
  return maxIso(o.expectedClaimAt, now);
}

// ── метки достоверности ────────────────────────────────────────────────────

const CONFIDENCE_RANK: Record<Confidence, number> = {
  official: 0,
  announced: 0,
  video: 0,
  tally: 0,
  derived: 0,
  conflict: 0,
  user: 0,
  projected: 1,
  leak: 2,
  unknown: 3,
};

/** Самая слабая метка из списка (unknown > leak > projected > остальные); при равенстве — первая. */
export function weakest(list: Confidence[]): Confidence {
  return list.reduce((a, b) => (CONFIDENCE_RANK[b] > CONFIDENCE_RANK[a] ? b : a));
}

export function confidenceRank(c: Confidence): number {
  return CONFIDENCE_RANK[c];
}

function nullReward(r: Reward): Reward {
  const out: Reward = {};
  for (const k of Object.keys(r) as (keyof Reward)[]) out[k] = null;
  return out;
}

function scaleKnown(r: Reward, k: number): Reward {
  const out: Reward = {};
  for (const [c, v] of Object.entries(r) as [keyof Reward, number | null][])
    out[c] = v === null ? null : v * k;
  return out;
}
