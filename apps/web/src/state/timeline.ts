// Дорожки таймлайна (раздел 9): версии и фазы, баннеры, ивенты, эндгейм, платное, новый контент, точки.
import { addRewards, ms, versionIdOf, type ISO, type Occurrence, type Reward } from '@primo/domain';
import type { DocOf } from '@primo/shared';
import type { Model } from './model';

export type LaneId = 'versions' | 'banners' | 'events' | 'endgame' | 'paid' | 'content' | 'points';

export const LANES: { id: LaneId; title: string }[] = [
  { id: 'versions', title: 'Версии и фазы' },
  { id: 'banners', title: 'Баннеры' },
  { id: 'events', title: 'Ивенты' },
  { id: 'endgame', title: 'Эндгейм' },
  { id: 'paid', title: 'Платное' },
  { id: 'content', title: 'Новый контент' },
  { id: 'points', title: 'Точки' },
];

export type Tone = 'neutral' | 'accent' | 'projected' | 'leak' | 'empty' | 'partial' | 'full' | 'hot';

export interface TimelineItem {
  id: string;
  lane: LaneId;
  label: string;
  from: ISO;
  /** Без `to` — точка. */
  to?: ISO;
  tone: Tone;
  occ?: Occurrence;
  /** Маркер внутри полосы (закрытие покупки БП). */
  marker?: { at: ISO; label: string };
  reward?: Reward;
  detail?: string;
}

export interface TimelineOptions {
  showLeaks: boolean;
  areaStates: Record<string, DocOf<'area_state'>>;
}

function overlaps(from: ISO, to: ISO | undefined, a: number, b: number): boolean {
  const s = ms(from);
  const e = to ? ms(to) : s;
  return e >= a && s <= b;
}

export function buildTimeline(
  model: Model,
  range: { from: ISO; to: ISO },
  opts: TimelineOptions,
): TimelineItem[] {
  const a = ms(range.from);
  const b = ms(range.to);
  const items: TimelineItem[] = [];
  const push = (it: TimelineItem) => overlaps(it.from, it.to, a, b) && items.push(it);
  const weak = (c: string) => (c === 'projected' ? 'projected' : c === 'leak' ? 'leak' : null);

  // 1. версии и фазы (проекции — штриховкой)
  for (const v of model.versions) {
    push({
      id: `v:${v.id}:p1`,
      lane: 'versions',
      label: `${v.id} · фаза 1`,
      from: v.start,
      to: v.phase2Start,
      tone: v.confidence === 'projected' ? 'projected' : 'accent',
      detail: v.name,
    });
    push({
      id: `v:${v.id}:p2`,
      lane: 'versions',
      label: `${v.id} · фаза 2`,
      from: v.phase2Start,
      to: v.end,
      tone: v.confidence === 'projected' ? 'projected' : 'neutral',
    });
  }

  // 2. баннеры (утечки — фильтром)
  for (const bn of model.banners) {
    if (bn.confidence === 'leak' && !opts.showLeaks) continue;
    push({
      id: `b:${bn.id}`,
      lane: 'banners',
      label: `${bn.kind === 'weapon' ? '⚔' : '★'} ${bn.featured5.join(' / ')}`,
      from: bn.start,
      to: bn.end,
      tone: (weak(bn.confidence) as Tone | null) ?? (bn.kind === 'weapon' ? 'neutral' : 'accent'),
      detail: bn.featured4.length ? `4★: ${bn.featured4.join(', ')}` : undefined,
    });
  }

  // 3. ивенты (сумма; null — «?»), задания ивента — одной полосой
  const byEvent = new Map<string, Occurrence[]>();
  for (const o of model.occurrences) {
    if (o.eventId) byEvent.set(o.eventId, [...(byEvent.get(o.eventId) ?? []), o]);
    else if (o.ruleId === 'events_tpl' || o.ruleId === 'trials' || o.ruleId === 'web_events') {
      if (o.confidence === 'leak' && !opts.showLeaks) continue;
      push({
        id: o.id,
        lane: 'events',
        label: `${o.title} · ${sumText(o.reward)}`,
        from: o.from,
        to: o.deadline,
        tone: (weak(o.confidence) as Tone | null) ?? 'neutral',
        occ: o,
        reward: o.reward,
      });
    }
  }
  for (const [eventId, occs] of byEvent) {
    const ev = model.events.find((e) => e.id === eventId);
    if (!ev || (ev.confidence === 'leak' && !opts.showLeaks)) continue;
    const reward = addRewards(...occs.map((o) => o.reward));
    const hasNull = occs.some((o) => Object.values(o.reward).some((v) => v === null));
    const first = occs[0]!;
    push({
      id: `e:${eventId}`,
      lane: 'events',
      label: `${ev.title} · ${hasNull ? '?' : sumText(reward)}`,
      from: ev.start,
      to: first.deadline,
      tone:
        (weak(ev.confidence) as Tone | null) ??
        (occs.every((o) => o.status === 'claimed') ? 'full' : 'neutral'),
      occ: occs.length === 1 ? first : undefined,
      reward,
      detail: ev.nonPrimoReward ?? ev.note,
    });
  }

  // 4. эндгейм: цвет — по заполненности трекера (0% / частично / максимум)
  for (const o of model.occurrences) {
    if (!o.tracker || o.tracker === 'hoyolab') continue;
    const sum = model.trackerSums[o.id] ?? 0;
    const max = o.reward.primo ?? 0;
    const tone: Tone = sum <= 0 ? 'empty' : sum >= max ? 'full' : 'partial';
    push({
      id: o.id,
      lane: 'endgame',
      label: `${o.title} · ${sum}/${max}`,
      from: o.from,
      to: o.deadline,
      tone,
      occ: o,
    });
  }

  // 5. платное: окна луны и БП с маркером закрытия покупки
  const welkinRuns = new Map<string, Occurrence[]>();
  for (const o of model.occurrences) {
    if (o.ruleId !== 'welkin' || o.id.endsWith(':buy')) continue;
    const purchase = o.id.split(':')[1]!;
    welkinRuns.set(purchase, [...(welkinRuns.get(purchase) ?? []), o]);
  }
  for (const [purchase, days] of welkinRuns) {
    const first = days[0]!;
    const last = days.at(-1)!;
    push({
      id: `w:${purchase}`,
      lane: 'paid',
      label: `Луна${first.virtual ? ' (план)' : ''}`,
      from: first.from,
      to: last.deadline,
      tone: first.virtual ? 'projected' : 'accent',
    });
  }
  for (const v of model.versions) {
    const bp =
      model.occurrences.find((o) => o.id === `bp_paid:${v.id}`) ??
      model.occurrences.find((o) => o.id === `bp_free:${v.id}`);
    if (!bp) continue;
    push({
      id: `bp:${v.id}`,
      lane: 'paid',
      label: `БП ${v.id}`,
      from: v.start,
      to: v.bpEnd,
      tone: v.confidence === 'projected' ? 'projected' : 'neutral',
      marker: { at: v.bpPurchaseEnd, label: 'закрытие покупки' },
      occ: bp,
    });
  }

  // 6. новый контент: области с addedIn и планы прохождения
  for (const region of model.seed.regions) {
    for (const area of region.areas) {
      const plan = opts.areaStates[area.id]?.plan;
      if (area.addedIn) {
        const v = model.versions.find((x) => x.id === versionIdOf(area.addedIn!));
        if (v)
          push({
            id: `c:${area.id}`,
            lane: 'content',
            label: `${area.name} (${area.addedIn})`,
            from: v.start,
            tone: v.confidence === 'projected' ? 'projected' : 'accent',
          });
      }
      if (plan?.kind === 'byDate')
        push({
          id: `plan:${area.id}`,
          lane: 'content',
          label: `План: ${area.name}`,
          from: plan.at,
          tone: 'neutral',
        });
    }
  }

  // 7. точки: стримы, дедлайны (кроме ежедневных), истечение почты
  for (const o of model.occurrences) {
    if (o.ruleId === 'stream_codes')
      push({ id: `p:${o.id}`, lane: 'points', label: 'Стрим, коды', from: o.from, tone: 'accent', occ: o });
    const mail = o.ruleId === 'maint_comp' || o.ruleId === 'fix_comp' || o.eventId?.endsWith('maint-comp');
    if (mail && o.deadline)
      push({
        id: `mail:${o.id}`,
        lane: 'points',
        label: 'Почта истекает',
        from: o.deadline,
        tone: o.status === 'planned' ? 'hot' : 'neutral',
        occ: o,
      });
    else if (
      o.deadline &&
      o.status === 'planned' &&
      o.eventId &&
      Object.values(o.reward).some((x) => x === null || (typeof x === 'number' && x >= 100))
    )
      push({
        id: `d:${o.id}`,
        lane: 'points',
        label: `Дедлайн: ${o.title}`,
        from: o.deadline,
        tone: 'hot',
        occ: o,
      });
  }
  return items;
}

function sumText(r: Reward): string {
  if (Object.values(r).some((v) => v === null)) return '?';
  const parts: string[] = [];
  if (r.primo) parts.push(String(r.primo));
  if (r.if) parts.push(`${r.if} IF`);
  if (r.af) parts.push(`${r.af} AF`);
  return parts.join(' + ') || '—';
}

/** Раскладка полос дорожки по подстрокам без пересечений (жадно). */
export function stackRows(items: TimelineItem[], minPointMs: number): Map<string, number> {
  const rows: number[] = [];
  const out = new Map<string, number>();
  for (const it of [...items].sort((x, y) => ms(x.from) - ms(y.from))) {
    const s = ms(it.from);
    const e = it.to ? ms(it.to) : s + minPointMs;
    let r = rows.findIndex((end) => end <= s);
    if (r < 0) {
      r = rows.length;
      rows.push(e);
    } else rows[r] = e;
    out.set(it.id, r);
  }
  return out;
}
