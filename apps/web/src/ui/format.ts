import { formatInOffset, type Confidence, type ISO, type Reward } from '@primo/domain';

const nf = new Intl.NumberFormat('ru-RU');

export function num(n: number | null | undefined): string {
  if (n === null || n === undefined) return '?';
  return nf.format(Math.round(n * 100) / 100);
}

/** «1 600 · 10 IF · 3 AF»; null-суммы — «?». */
export function rewardText(r: Reward | null | undefined, empty = '—'): string {
  if (!r) return '?';
  const parts: string[] = [];
  if (r.primo !== undefined) parts.push(r.primo === null ? '? примо' : `${num(r.primo)}`);
  if (r.crystal !== undefined) parts.push(r.crystal === null ? '? крист.' : `${num(r.crystal)} крист.`);
  if (r.if !== undefined) parts.push(r.if === null ? '? IF' : `${num(r.if)} IF`);
  if (r.af !== undefined) parts.push(r.af === null ? '? AF' : `${num(r.af)} AF`);
  if (r.starglitter) parts.push(`${num(r.starglitter)} блеска`);
  if (r.stardust) parts.push(`${num(r.stardust)} пыли`);
  const nonZero = parts.filter((p) => !/^0( |$)/.test(p));
  return nonZero.length ? nonZero.join(' · ') : empty;
}

export function dateTime(iso: ISO | null | undefined, offset: number): string {
  return iso ? formatInOffset(iso, offset, 'dd.MM HH:mm') : '—';
}

export function date(iso: ISO | null | undefined, offset: number, format = 'dd.MM.yyyy'): string {
  return iso ? formatInOffset(iso, offset, format) : '—';
}

/** «через 2 д 3 ч» / «3 ч 10 мин» / «прошло». */
export function untilText(iso: ISO, now: ISO): string {
  const ms = Date.parse(iso) - Date.parse(now);
  if (ms <= 0) return 'прошло';
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d} д ${h % 24} ч`;
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h ? `${h} ч ${m} мин` : `${m} мин`;
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  official: 'офиц.',
  announced: 'анонс',
  video: 'видео',
  tally: 'сходится',
  derived: 'выведено',
  conflict: 'спорно',
  projected: 'проекция',
  leak: 'утечка',
  user: 'вручную',
  unknown: '?',
};
