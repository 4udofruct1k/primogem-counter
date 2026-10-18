import { describe, expect, it } from 'vitest';
import { applyStatuses, isClaimableBy, materialize, type MaterializeInput } from './recurrence';
import { addRewards } from './reward';
import { noPayments, packFor } from './test/context';
import { DEVICE_OFFSET } from './test/fixtures';
import { formatInOffset } from './time';
import type { Occurrence, PaymentProfile, ServerId } from './types';

// 2026-10-19 10:00 UTC+5
const NOW = '2026-10-19T05:00:00Z';

function input(server: ServerId = 'europe', extra: Partial<MaterializeInput> = {}): MaterializeInput {
  return { now: NOW, server, ...packFor(server, NOW), payment: noPayments, ...extra };
}

function byRule(occs: Occurrence[], ruleId: string) {
  return occs.filter((o) => o.ruleId === ruleId);
}

function find(occs: Occurrence[], id: string) {
  return occs.find((o) => o.id === id);
}

describe('recurrence: материализация вхождений (раздел 7)', () => {
  it('TC-04: дейлики до 2026-11-04 03:00 UTC+5 — 16 вхождений, 960', () => {
    const T = '2026-11-03T22:00:00Z';
    const occs = byRule(materialize(input()), 'daily_commissions');
    const today = find(occs, 'daily_commissions:2026-10-19')!;
    expect(today.from).toBe('2026-10-19T03:00:00Z');
    expect(today.deadline).toBe('2026-10-20T03:00:00Z');
    expect(today.expectedClaimAt).toBe('2026-10-19T17:00:00Z');

    const due = occs.filter((o) => isClaimableBy(o, NOW, T));
    expect(due).toHaveLength(16);
    expect(addRewards(...due.map((o) => o.reward))).toEqual({ primo: 960 });
  });

  it('TC-05: сбросы в (2026-10-19 10:00; 2026-11-30 23:59] UTC+5 — театр 1, бездна 1', () => {
    const from = NOW;
    const to = '2026-11-30T18:59:00Z';
    const occs = materialize(input());
    const resets = (ruleId: string) => byRule(occs, ruleId).filter((o) => o.from > from && o.from <= to);

    const theater = resets('theater');
    expect(theater.map((o) => o.id)).toEqual(['theater:2026-11']);
    expect(formatInOffset(theater[0]!.from, DEVICE_OFFSET)).toBe('2026-11-01 08:00');

    const abyss = resets('abyss');
    expect(abyss.map((o) => o.id)).toEqual(['abyss:2026-11']);
    expect(formatInOffset(abyss[0]!.from, DEVICE_OFFSET)).toBe('2026-11-16 08:00');
  });

  it('TC-06: луна куплена 2026-10-19 — +300 crystal и 30 вхождений 19.10–17.11 → 2700', () => {
    const payment: PaymentProfile = { ...noPayments, welkinPurchases: [{ id: 'p1', at: NOW }] };
    const occs = byRule(materialize(input('europe', { payment })), 'welkin');

    const buy = find(occs, 'welkin:p1:buy')!;
    expect(buy.reward).toEqual({ crystal: 300 });

    const days = occs.filter((o) => o.id.startsWith('welkin:p1:d'));
    expect(days).toHaveLength(30);
    expect(days[0]!.id).toBe('welkin:p1:d0');
    expect(days[0]!.from).toBe('2026-10-19T03:00:00Z');
    expect(days[29]!.id).toBe('welkin:p1:d29');
    expect(days[29]!.from).toBe('2026-11-17T03:00:00Z');
    expect(addRewards(...days.map((o) => o.reward))).toEqual({ primo: 2700 });
  });

  it('луна: вторая покупка встаёт хвостом, сверх 180 дней — отклоняется', () => {
    const purchases = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, at: NOW }));
    const payment: PaymentProfile = { ...noPayments, welkinPurchases: purchases };
    const occs = byRule(materialize(input('europe', { payment })), 'welkin');
    expect(find(occs, 'welkin:p1:d0')!.from).toBe('2026-11-18T03:00:00Z');
    expect(occs.filter((o) => o.id.endsWith(':buy'))).toHaveLength(6);
    expect(find(occs, 'welkin:p6:buy')).toBeUndefined();
  });

  it('луна keepActive: виртуальные покупки в день окончания', () => {
    const payment: PaymentProfile = {
      ...noPayments,
      welkinPurchases: [{ id: 'p1', at: NOW }],
      welkinPlanned: 'keepActive',
    };
    const occs = byRule(materialize(input('europe', { payment })), 'welkin');
    const virtualBuy = find(occs, 'welkin:v2026-11-17:buy')!;
    expect(virtualBuy.virtual).toBe(true);
    expect(find(occs, 'welkin:v2026-11-17:d0')!.from).toBe('2026-11-18T03:00:00Z');
  });

  it('TC-10: planned с прошедшим дедлайном → missed (можно вернуть задним числом)', () => {
    const occs = materialize(input());
    const { occurrences, autoMissed } = applyStatuses(
      occs,
      [{ id: 'daily_commissions:2026-10-17', status: 'claimed', claimedAt: '2026-10-17T12:00:00Z' }],
      NOW,
    );
    expect(find(occurrences, 'daily_commissions:2026-10-18')!.status).toBe('missed');
    expect(autoMissed).toContain('daily_commissions:2026-10-18');
    expect(find(occurrences, 'daily_commissions:2026-10-17')!.status).toBe('claimed');
    expect(find(occurrences, 'daily_commissions:2026-10-19')!.status).toBe('planned');
  });

  it('TC-14: смена сервера Europe → Asia перерезолвит время, статусы сохраняются', () => {
    const docs = [
      { id: 'daily_commissions:2026-10-19', status: 'claimed' as const },
      { id: 'abyss:2026-10', status: 'claimed' as const },
      { id: 'bp_free:7.1', status: 'skipped' as const },
    ];
    const europe = applyStatuses(materialize(input('europe')), docs, NOW).occurrences;
    const asia = applyStatuses(materialize(input('asia')), docs, NOW).occurrences;
    for (const d of docs) {
      expect(find(europe, d.id)!.status).toBe(d.status);
      expect(find(asia, d.id)!.status).toBe(d.status);
    }
    expect(find(europe, 'daily_commissions:2026-10-19')!.from).toBe('2026-10-19T03:00:00Z');
    expect(find(asia, 'daily_commissions:2026-10-19')!.from).toBe('2026-10-18T20:00:00Z');
  });

  it('id вхождений детерминированы (I7)', () => {
    const a = materialize(input()).map((o) => o.id);
    const b = materialize(input()).map((o) => o.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });
});

describe('recurrence: правила версий', () => {
  const occs = materialize(input());

  it('компенсация 7.1: ивент 7.1-maint-comp заменяет maint_comp:7.1, вместе с fix_comp — 600', () => {
    expect(find(occs, 'maint_comp:7.1')).toBeUndefined();
    expect(find(occs, '7.1-maint-comp')!.reward).toEqual({ primo: 300 });
    const fix = find(occs, 'fix_comp:7.1')!;
    expect(fix.reward).toEqual({ primo: 300 });
    expect(fix.deadline).toBe('2026-09-25T22:00:00Z');
    expect(find(occs, 'maint_comp:7.2')!.reward).toEqual({ primo: 300 });
    expect(find(occs, 'fix_comp:7.2')!.reward).toEqual({ primo: 300 });
  });

  it('ивенты версии по шаблону: 2 × 420 + 1 × 950, реальные ивенты со slot занимают слоты', () => {
    // 7.1: малые — Predictive Victory и Snowball Fight, большой прошёл (count 0 в шаблоне)
    expect(occs.filter((o) => o.id.startsWith('events_tpl:7.1:'))).toEqual([]);
    const v72 = occs.filter((o) => o.id.startsWith('events_tpl:7.2:'));
    expect(v72.map((o) => [o.id, o.reward])).toEqual([
      ['events_tpl:7.2:small1', { primo: 420 }],
      ['events_tpl:7.2:small2', { primo: 420 }],
      ['events_tpl:7.2:big1', { primo: 950 }],
    ]);
    expect(v72.every((o) => o.confidence === 'projected' && o.category === 'event')).toBe(true);
    // утёкший ивент без slot слоты не занимает
    expect(occs.filter((o) => o.id.startsWith('events_tpl:7.4:'))).toHaveLength(3);
  });

  it('шаблон: в версии бывает 3 малых ивента, сумма большого правится по версии', () => {
    const ctx = input();
    const eventTemplate = {
      ...ctx.eventTemplate!,
      versions: {
        ...ctx.eventTemplate!.versions,
        '7.3': { small: { count: 3 }, big: { reward: { primo: 1000 } } },
      },
    };
    const occs73 = materialize({ ...ctx, eventTemplate }).filter((o) => o.id.startsWith('events_tpl:7.3:'));
    expect(occs73.map((o) => [o.id, o.reward.primo])).toEqual([
      ['events_tpl:7.3:small1', 420],
      ['events_tpl:7.3:small2', 420],
      ['events_tpl:7.3:small3', 420],
      ['events_tpl:7.3:big1', 1000],
    ]);
  });

  it('без шаблона — одна строка events_tpl и правило раздела 7', () => {
    const plain = materialize(input('europe', { eventTemplate: undefined }));
    expect(find(plain, 'events_tpl:7.1')).toBeUndefined();
    expect(find(plain, 'events_tpl:7.2')!.reward).toEqual({ primo: 1790 });
    expect(find(plain, 'trials:7.2:p2')!.reward).toEqual({ primo: null });
  });

  it('new_content_tpl не генерируется для версии с новыми областями', () => {
    const withAreas = materialize(input('europe', { newContentVersions: ['7.2'] }));
    expect(find(withAreas, 'new_content_tpl:7.2')).toBeUndefined();
    expect(find(withAreas, 'new_content_tpl:7.3')).toBeDefined();
  });

  it('коды стрима: дата спецпрограммы из датапака, иначе старт − 12 дней', () => {
    const s72 = find(occs, 'stream_codes:7.2')!;
    expect(s72.from).toBe('2026-10-22T16:00:00Z');
    expect(s72.deadline).toBe('2026-10-23T16:00:00Z');
    expect(formatInOffset(find(occs, 'stream_codes:7.3')!.from, 8)).toBe('2026-12-04 06:00');
  });

  it('пробные персонажи: 20 × 5★ объявленной фазы, иначе 40 за фазу по шаблону', () => {
    expect(find(occs, 'trials:7.1:p1')!.reward).toEqual({ primo: 40 });
    expect(find(occs, 'trials:7.1:p2')!.reward).toEqual({ primo: 40 });
    expect(find(occs, 'trials:7.1:p1')!.confidence).toBe('tally');
    expect(find(occs, 'trials:7.2:p1')!.reward).toEqual({ primo: 40 });
    const p2 = find(occs, 'trials:7.2:p2')!;
    expect(p2.reward).toEqual({ primo: 40 });
    expect(p2.confidence).toBe('projected');
    // 7.3: известна только утечка (одна 5★) — тоже шаблон
    const t73 = find(occs, 'trials:7.3:p1')!;
    expect(t73.reward).toEqual({ primo: 40 });
    expect(t73.confidence).toBe('projected');
    expect(formatInOffset(find(occs, 'trials:7.5:p2')!.from, 1)).toBe('2027-03-30 18:00');
  });

  it('натиск: окно 35 дней от старт + 7, id по версии', () => {
    const s = find(occs, 'stygian:7.2')!;
    expect(formatInOffset(s.from, 8)).toBe('2026-11-11 06:00');
    expect(formatInOffset(s.deadline!, 8)).toBe('2026-12-16 06:00');
    expect(s.tracker).toBe('stygian');
    expect(s.expected).toEqual({ primo: 450 });
  });

  it('платное: БП только по профилю оплаты', () => {
    expect(byRule(occs, 'bp_paid')).toHaveLength(0);
    const every = materialize(input('europe', { payment: { ...noPayments, bpPaid: 'everyVersion' } }));
    expect(find(every, 'bp_paid:7.1')!.deadline).toBe('2026-11-02T02:59:00Z');
    const listed = materialize(
      input('europe', { payment: { ...noPayments, bpPaid: { versions: ['7.2'] } } }),
    );
    expect(byRule(listed, 'bp_paid').map((o) => o.id)).toEqual(['bp_paid:7.2']);
  });

  it('магазин пыли: число круток в месяц — настройка, по умолчанию 0', () => {
    expect(find(occs, 'stardust_shop:2026-11')!.reward).toEqual({});
    const set = materialize(input('europe', { settings: { stardustShop: { if: 2, af: 0 } } }));
    expect(find(set, 'stardust_shop:2026-11')!.reward).toEqual({ if: 2 });
    const capped = materialize(input('europe', { settings: { stardustShop: { if: 9, af: 7 } } }));
    expect(find(capped, 'stardust_shop:2026-11')!.reward).toEqual({ if: 5, af: 5 });
  });

  it('ивенты: задания — отдельные вхождения; задержка min(168, окно − 24)', () => {
    const letters = occs.filter((o) => o.eventId === '7.1-missive-of-grace');
    expect(letters.map((o) => o.id)).toEqual([
      '7.1-missive-of-grace:m1',
      '7.1-missive-of-grace:m2',
      '7.1-missive-of-grace:m3',
      '7.1-missive-of-grace:m4',
    ]);
    expect(letters[0]!.expectedClaimAt).toBe('2026-10-04T23:00:00Z');
    const comp = find(occs, '7.1-maint-comp')!;
    expect(comp.expectedClaimAt).toBe('2026-09-30T03:00:00Z');
    const snowball = find(occs, '7.1-snowball')!;
    // конец не опубликован — дедлайн по «дедлайну конца версии» 7.1
    expect(snowball.deadline).toBe('2026-11-03T13:59:00Z');
    expect(snowball.expectedClaimAt).toBe('2026-10-28T09:00:00Z');
  });

  it('отключённое правило не генерируется', () => {
    const ctx = input();
    const rules = ctx.rules.map((r) => (r.id === 'hoyolab' ? { ...r, enabled: false } : r));
    expect(byRule(materialize({ ...ctx, rules }), 'hoyolab')).toHaveLength(0);
  });

  it('горизонт: now − 42 дня (одна версия) … now + 400 дней', () => {
    const daily = byRule(occs, 'daily_commissions');
    expect(daily[0]!.id).toBe('daily_commissions:2026-09-07');
    expect(daily.at(-1)!.id).toBe('daily_commissions:2027-11-23');
  });
});
