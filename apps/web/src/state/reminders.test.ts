import { describe, expect, it } from 'vitest';
import { makeHarness } from '../test/harness';
import { createActions } from './actions';
import { computeModel } from './model';
import { dueReminders } from './reminders';

async function modelAt(now: string, prep?: (a: ReturnType<typeof createActions>) => Promise<void>) {
  const h = await makeHarness();
  if (prep) await prep(createActions(h.store));
  const s = h.store.getState();
  return computeModel(s.game!, s.docs, now, 5);
}
const keys = (m: Awaited<ReturnType<typeof modelAt>>) => dueReminders(m).map((r) => r.key);

describe('напоминания (раздел 17)', () => {
  it('дейлики — за 3 ч до сброса', async () => {
    expect(keys(await modelAt('2026-10-20T00:30:00Z'))).toContain('daily_commissions:2026-10-19:3h');
    expect(keys(await modelAt('2026-10-19T20:00:00Z'))).not.toContain('daily_commissions:2026-10-19:3h');
  });

  it('бездна не добита — за 48 ч до сброса', async () => {
    expect(keys(await modelAt('2026-11-14T04:00:00Z'))).toContain('abyss:2026-10:48h');
    expect(keys(await modelAt('2026-11-12T04:00:00Z'))).not.toContain('abyss:2026-10:48h');
  });

  it('почта компенсации — за 3 дня до истечения, дедлайн ивента — за сутки', async () => {
    const m = await modelAt('2026-10-21T00:00:00Z');
    expect(keys(m)).toContain('7.1-maint-comp:mail');
    expect(keys(await modelAt('2026-10-22T04:00:00Z'))).toContain('7.1-maint-comp:24h');
  });

  it('закрытие покупки БП — только если БП покупается', async () => {
    const at = '2026-11-01T03:00:00Z';
    expect(keys(await modelAt(at))).not.toContain('bp-buy:7.1');
    const paid = await modelAt(at, (a) =>
      a.savePayment({
        welkinPurchases: [],
        welkinPlanned: 'none',
        bpPaid: 'everyVersion',
        plannedTopUps: [],
      }),
    );
    expect(keys(paid)).toContain('bp-buy:7.1');
  });

  it('спецпрограмма — в день стрима', async () => {
    expect(keys(await modelAt('2026-10-22T18:00:00Z'))).toContain('stream_codes:7.2:day');
  });
});

describe('напоминания: правки аудита', () => {
  it('компенсация по правилу — за 3 дня до 30-го дня письма, а не до конца версии', async () => {
    // 7.2: старт 03.11 22:00 UTC (у 7.1 своя компенсация ивентом) → письмо живёт до 03.12 22:00
    expect(keys(await modelAt('2026-12-01T00:00:00Z'))).toContain('maint_comp:7.2:mail');
    expect(keys(await modelAt('2026-11-28T00:00:00Z'))).not.toContain('maint_comp:7.2:mail');
    expect(keys(await modelAt('2026-12-04T00:00:00Z'))).not.toContain('maint_comp:7.2:mail');
  });

  it('«Луна заканчивается» срабатывает и при «держать луну активной»', async () => {
    const m = await modelAt('2026-11-16T00:00:00Z', async (a) => {
      await a.savePayment({
        ...(await import('./model')).DEFAULT_PAYMENT,
        welkinPurchases: [{ id: 'w1', at: '2026-10-19T07:00:00Z' }],
        welkinPlanned: 'keepActive',
      });
    });
    expect(keys(m).some((k) => k.startsWith('welkin-end:'))).toBe(true);
  });
});
