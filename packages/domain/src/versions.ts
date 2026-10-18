// Версии, фазы, конец БП и «дедлайн конца версии» (4.3).
import { addDays, addDaysToDate, atServer, ms, resolveTime, utc8DateOf } from './time';
import type { Confidence, ISO, RawTime, ServerId, Version } from './types';

/** Следующая версия, если не объявлена: старт + 42 дня (`projected`). */
export const VERSION_DAYS = 42;
/** Фаза 2: старт + 20 дней, 18:00 server. */
export const PHASE2_OFFSET_DAYS = 20;
export const PHASE2_TIME = '18:00';
/** Конец БП: (дата старта следующей версии по UTC+8) − 2 дня, 03:59 server; покупка — до 02:59. */
export const BP_END_DAYS_BEFORE = 2;
export const BP_END_TIME = '03:59';
export const BP_PURCHASE_END_TIME = '02:59';
/** «Дедлайн конца версии»: (дата старта следующей по UTC+8) − 1 день, 14:59 server. */
export const VERSION_END_DEADLINE_DAYS_BEFORE = 1;
export const VERSION_END_DEADLINE_TIME = '14:59';

export interface RawVersion {
  id: string;
  name?: string;
  start?: RawTime;
  phase2Start?: RawTime;
  specialProgram?: RawTime;
  durationDaysOverride?: number;
  confidence: Confidence | string;
}

interface Draft {
  id: string;
  raw?: RawVersion;
  start: ISO;
  confidence: Confidence;
}

/**
 * Резолвит версии датапака для сервера и достраивает проекции до `until`.
 * `durationDaysOverride` версии задаёт её длительность и сдвигает все последующие projected версии.
 */
export function resolveVersions(raw: RawVersion[], server: ServerId, opts: { until: ISO }): Version[] {
  if (raw.length === 0) return [];
  const drafts: Draft[] = [];
  let shiftMs = 0;

  raw.forEach((rv, i) => {
    const confidence = rv.confidence as Confidence;
    const prev = drafts[i - 1];
    if (!prev) {
      if (!rv.start) throw new Error(`version ${rv.id}: нет даты старта`);
      drafts.push({ id: rv.id, raw: rv, start: resolveTime(rv.start, server), confidence });
      return;
    }
    if (rv.start && confidence !== 'projected') {
      // объявленная дата не сдвигается проекциями
      shiftMs = 0;
      drafts.push({ id: rv.id, raw: rv, start: resolveTime(rv.start, server), confidence });
      return;
    }
    const natural = rv.start
      ? addMs(resolveTime(rv.start, server), shiftMs)
      : addDays(prev.start, VERSION_DAYS);
    const override = prev.raw?.durationDaysOverride;
    let start = natural;
    if (override !== undefined) {
      start = addDays(prev.start, override);
      shiftMs += ms(start) - ms(natural);
    }
    drafts.push({ id: rv.id, raw: rv, start, confidence });
  });

  // проекции до горизонта (+ одна версия сверху, чтобы у последней был конец)
  while (ms(drafts.at(-1)!.start) <= ms(opts.until)) {
    const prev = drafts.at(-1)!;
    const days = prev.raw?.durationDaysOverride ?? VERSION_DAYS;
    drafts.push({ id: nextVersionId(prev.id), start: addDays(prev.start, days), confidence: 'projected' });
  }
  const last = drafts.at(-1)!;
  const tailEnd = addDays(last.start, last.raw?.durationDaysOverride ?? VERSION_DAYS);

  return drafts.map((d, i) => {
    const end = drafts[i + 1]?.start ?? tailEnd;
    const endDate = utc8DateOf(end);
    const v: Version = {
      id: d.id,
      start: d.start,
      phase2Start: d.raw?.phase2Start
        ? resolveTime(d.raw.phase2Start, server)
        : atServer(addDaysToDate(utc8DateOf(d.start), PHASE2_OFFSET_DAYS), PHASE2_TIME, server),
      end,
      confidence: d.confidence,
      bpEnd: atServer(addDaysToDate(endDate, -BP_END_DAYS_BEFORE), BP_END_TIME, server),
      bpPurchaseEnd: atServer(addDaysToDate(endDate, -BP_END_DAYS_BEFORE), BP_PURCHASE_END_TIME, server),
      endDeadline: atServer(
        addDaysToDate(endDate, -VERSION_END_DEADLINE_DAYS_BEFORE),
        VERSION_END_DEADLINE_TIME,
        server,
      ),
      generated: !d.raw,
    };
    if (d.raw?.name) v.name = d.raw.name;
    if (d.raw?.specialProgram) v.specialProgram = resolveTime(d.raw.specialProgram, server);
    if (d.raw?.durationDaysOverride !== undefined) v.durationDaysOverride = d.raw.durationDaysOverride;
    return v;
  });
}

/** '7.5' → '7.6' (DECISIONS: проекции нумеруются по минорной версии). */
export function nextVersionId(id: string): string {
  const m = /^(\d+)\.(\d+)$/.exec(id);
  return m ? `${m[1]}.${Number(m[2]) + 1}` : `${id}+1`;
}

/** Версия, идущая в момент `at`. */
export function versionAt(versions: Version[], at: ISO): Version | undefined {
  const t = ms(at);
  return versions.find((v) => ms(v.start) <= t && t < ms(v.end));
}

/** Номер версии из `addedIn` области: '6.5 (Luna VI)' → '6.5'. */
export function versionIdOf(addedIn: string): string {
  return addedIn.trim().split(/\s+/)[0]!;
}

function addMs(iso: ISO, delta: number): ISO {
  return delta ? addDays(iso, delta / 86_400_000) : iso;
}
