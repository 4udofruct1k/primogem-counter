// Время, серверы, сбросы (раздел 4). Все моменты — UTC ISO без миллисекунд (I1).
import { DateTime, FixedOffsetZone } from 'luxon';
import type { ISO, RawTime, ServerId } from './types';

/** Фиксированные смещения серверов, без летнего времени (4.1). */
export const SERVER_OFFSET_HOURS: Record<ServerId, number> = {
  asia: 8,
  tw_hk_mo: 8,
  europe: 1,
  america: -5,
};

/** Серверный день начинается в 04:00 по серверу (4.1). */
export const SERVER_DAY_START = '04:00';
const SERVER_DAY_START_HOURS = 4;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function offsetZone(hours: number): FixedOffsetZone {
  return FixedOffsetZone.instance(hours * 60);
}

export function serverZone(server: ServerId): FixedOffsetZone {
  return offsetZone(SERVER_OFFSET_HOURS[server]);
}

const UTC8 = offsetZone(8);

function toIso(dt: DateTime): ISO {
  if (!dt.isValid) throw new Error(`invalid date: ${dt.invalidExplanation ?? ''}`);
  return dt.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
}

function fromIso(iso: ISO): DateTime {
  const dt = DateTime.fromISO(iso, { zone: 'utc' });
  if (!dt.isValid) throw new Error(`invalid ISO: ${iso}`);
  return dt;
}

/** Миллисекунды UTC — для сравнений и арифметики. */
export function ms(iso: ISO): number {
  return fromIso(iso).toMillis();
}

export function fromMs(value: number): ISO {
  return toIso(DateTime.fromMillis(value, { zone: 'utc' }));
}

/** Приводит любую ISO-строку к каноническому виду `YYYY-MM-DDTHH:mm:ssZ`. */
export function normalizeIso(iso: ISO): ISO {
  return toIso(fromIso(iso));
}

/** Резолвит время из данных (4.2) в UTC для выбранного сервера. */
export function resolveTime(t: RawTime, server: ServerId): ISO {
  const zone = t.clock === 'utc8' ? UTC8 : serverZone(server);
  return toIso(DateTime.fromISO(t.at, { zone }));
}

/** Момент `date` + `time` (HH:mm) по времени сервера. */
export function atServer(date: string, time: string, server: ServerId): ISO {
  return toIso(DateTime.fromISO(`${date}T${time}`, { zone: serverZone(server) }));
}

export function atUtc8(date: string, time: string): ISO {
  return toIso(DateTime.fromISO(`${date}T${time}`, { zone: UTC8 }));
}

/** Начало серверного дня `date` (04:00 server). */
export function serverDayStart(date: string, server: ServerId): ISO {
  return atServer(date, SERVER_DAY_START, server);
}

/** Серверная дата момента с учётом смены дня в 04:00. */
export function serverDateOf(iso: ISO, server: ServerId): string {
  return fromIso(iso).setZone(serverZone(server)).minus({ hours: SERVER_DAY_START_HOURS }).toISODate()!;
}

/** Календарная дата момента по UTC+8. */
export function utc8DateOf(iso: ISO): string {
  return fromIso(iso).setZone(UTC8).toISODate()!;
}

/** Календарная дата момента в заданном смещении (часы). */
export function dateInOffset(iso: ISO, offsetHours: number): string {
  return fromIso(iso).setZone(offsetZone(offsetHours)).toISODate()!;
}

export function addHours(iso: ISO, hours: number): ISO {
  return fromMs(ms(iso) + hours * HOUR_MS);
}

/** Сдвиг на n × 24 ч (смещения фиксированные, летнего времени нет). */
export function addDays(iso: ISO, days: number): ISO {
  return fromMs(ms(iso) + days * DAY_MS);
}

/** Дата `YYYY-MM-DD` ± n дней. */
export function addDaysToDate(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: 'utc' }).plus({ days }).toISODate()!;
}

/** Месяц `YYYY-MM` ± n месяцев. */
export function addMonths(month: string, n: number): string {
  return DateTime.fromISO(`${month}-01`, { zone: 'utc' }).plus({ months: n }).toFormat('yyyy-MM');
}

export function daysBetweenDates(from: string, to: string): number {
  return Math.round((ms(`${to}T00:00:00Z`) - ms(`${from}T00:00:00Z`)) / DAY_MS);
}

export function hoursBetween(from: ISO, to: ISO): number {
  return (ms(to) - ms(from)) / HOUR_MS;
}

/** Форматирует момент в заданном смещении (часы), по умолчанию `yyyy-MM-dd HH:mm`. */
export function formatInOffset(iso: ISO, offsetHours: number, format = 'yyyy-MM-dd HH:mm'): string {
  return fromIso(iso).setZone(offsetZone(offsetHours)).toFormat(format);
}

export function isBefore(a: ISO, b: ISO): boolean {
  return ms(a) < ms(b);
}

export function maxIso(a: ISO, b: ISO): ISO {
  return ms(a) >= ms(b) ? a : b;
}

export function minIso(a: ISO, b: ISO): ISO {
  return ms(a) <= ms(b) ? a : b;
}
