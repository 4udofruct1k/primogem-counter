// Восстановление из бэкапа по 15.5 и курсоры клиентов: эпоха данных сервера (D-315).
import { SyncResponseSchema, type SyncResponse } from '@primo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { createTestContext, nextIp, TestClient, type TestContext } from '../test/helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext({ syncPullLimit: 100 });
});

afterAll(async () => {
  await ctx.close();
});

async function sync(
  c: TestClient,
  cursor: number,
  changes: unknown[] = [],
  epoch?: string,
): Promise<SyncResponse> {
  const res = await c.post('/api/sync', { cursor, changes, ...(epoch === undefined ? {} : { epoch }) });
  expect(res.statusCode, res.body).toBe(200);
  return SyncResponseSchema.parse(res.json());
}

const occ = (id: string, status = 'claimed') => ({
  collection: 'occ_status',
  id,
  data: { id, status },
  baseVersion: 0,
});

/**
 * `pg_restore --clean` дампа, снятого при `last_value = dumpSeq`: строки, записанные после дампа, пропадают,
 * счётчики пользователя возвращаются, последовательность пересоздаётся со значением из дампа.
 */
async function restoreDump(dumpSeq: number, users: { id: string; doc_count: number; doc_bytes: string }[]) {
  const db = ctx.database.client;
  await db.query('delete from user_docs where seq > $1', [dumpSeq]);
  for (const u of users)
    await db.query('update users set doc_count = $2, doc_bytes = $3 where id = $1', [
      u.id,
      u.doc_count,
      u.doc_bytes,
    ]);
  await db.exec(`
    drop sequence user_docs_seq cascade;
    create sequence user_docs_seq;
    alter table user_docs alter column seq set default nextval('user_docs_seq');
  `);
  await db.query(`select setval('user_docs_seq', $1)`, [dumpSeq]);
}

describe('F2: восстановление из бэкапа (15.5)', () => {
  it('эпоха стабильна между запросами и перезапуском api', async () => {
    const c = ctx.client();
    await c.register('epoch_stable');
    const a = await sync(c, 0);
    const b = await sync(c, a.cursor, [occ('x')], a.epoch);
    expect(a.epoch).toMatch(/^[0-9a-f]{16}$/);
    expect(b.epoch).toBe(a.epoch);

    // новый процесс api на той же базе
    const restarted = await buildApp({ config: ctx.config, db: ctx.database.db });
    try {
      const again = new TestClient(restarted, nextIp());
      await again.login('epoch_stable');
      expect((await sync(again, b.cursor, [], b.epoch)).epoch).toBe(a.epoch);
    } finally {
      await restarted.close();
    }
  });

  it('курсор впереди восстановленной последовательности: клиент с эпохой получает всё записанное после восстановления', async () => {
    const phone = ctx.client();
    const { user } = await phone.register('restored_user');
    const laptop = ctx.client();
    await laptop.login('restored_user');

    // до дампа: d1, d2
    const before = await sync(phone, 0, [occ('d1'), occ('d2')]);
    const epoch = before.epoch!;
    const dumpSeq = Number(
      (await ctx.database.client.query<{ v: string }>('select last_value::text as v from user_docs_seq'))
        .rows[0]!.v,
    );
    const snapshot = (
      await ctx.database.client.query<{ id: string; doc_count: number; doc_bytes: string }>(
        'select id, doc_count, doc_bytes::text as doc_bytes from users',
      )
    ).rows;

    // после дампа телефон пишет ещё — его курсор уходит дальше значения последовательности в дампе
    const lost = await sync(phone, before.cursor, [occ('lost1'), occ('lost2'), occ('lost3')], epoch);
    const phoneCursor = lost.cursor;
    expect(phoneCursor).toBeGreaterThan(dumpSeq);

    await restoreDump(dumpSeq, snapshot);

    // после восстановления ноутбук (без сохранённой эпохи) пишет новые документы и правит d1:
    // их seq снова начинаются с dumpSeq + 1 — часть из них не больше курсора телефона
    const after = await sync(laptop, 0, [
      occ('new1'),
      { collection: 'occ_status', id: 'd1', data: { id: 'd1', status: 'missed' }, baseVersion: 1 },
      occ('new2'),
      occ('new3'),
      occ('new4'),
      occ('new5'),
    ]);
    expect(after.applied).toHaveLength(6);
    expect(Math.min(...after.applied.map((a) => a.seq))).toBeLessThanOrEqual(phoneCursor);
    expect(after.cursor).toBeGreaterThan(phoneCursor); // ветка «курсор впереди сервера» (D-306) не сработает
    expect(after.epoch).not.toBe(epoch);

    // старый клиент без эпохи — прежнее поведение: только seq > курсора, new1 и d1 потеряны для него
    const legacy = await sync(phone, phoneCursor);
    expect(legacy.changes.map((ch) => ch.id)).not.toContain('new1');

    // клиент с эпохой: эпоха не совпала — курсор игнорируется, всё с нуля
    const healed = await sync(phone, phoneCursor, [], epoch);
    expect(healed.epoch).toBe(after.epoch);
    expect(healed.more ?? false).toBe(false);
    expect(healed.cursor).toBe(after.cursor);
    const got = Object.fromEntries(healed.changes.map((ch) => [ch.id, ch]));
    expect(Object.keys(got).sort()).toEqual(['d1', 'd2', 'new1', 'new2', 'new3', 'new4', 'new5']);
    expect(got.d1).toMatchObject({ data: { id: 'd1', status: 'missed' }, version: 2 });

    // дальше — как обычно, с новой эпохой
    const idle = await sync(phone, healed.cursor, [], healed.epoch);
    expect(idle.changes).toEqual([]);
    expect(idle.cursor).toBe(healed.cursor);

    // счётчики квоты после восстановления сходятся с таблицей
    const usage = await ctx.database.client.query<{ doc_count: number; n: number }>(
      `select u.doc_count, (select count(*)::int from user_docs d where d.user_id = u.id) as n
       from users u where u.id = $1`,
      [user.id],
    );
    expect(usage.rows[0]!.doc_count).toBe(usage.rows[0]!.n);
  });

  it('при несовпадении эпохи правки с baseVersion > 0 — конфликт: версии до восстановления несравнимы', async () => {
    const phone = ctx.client();
    await phone.register('stale_base_restore');
    const first = await sync(phone, 0, [occ('s1')]);
    const old = first.epoch!;
    const dumpSeq = Number(
      (await ctx.database.client.query<{ v: string }>('select last_value::text as v from user_docs_seq'))
        .rows[0]!.v,
    );
    const snapshot = (
      await ctx.database.client.query<{ id: string; doc_count: number; doc_bytes: string }>(
        'select id, doc_count, doc_bytes::text as doc_bytes from users',
      )
    ).rows;
    await restoreDump(dumpSeq, snapshot);

    const res = await sync(
      phone,
      first.cursor,
      [
        { collection: 'occ_status', id: 's1', data: { id: 's1', status: 'skipped' }, baseVersion: 1 },
        occ('fresh'),
        {
          collection: 'ledger',
          id: 'l1',
          data: { id: 'l1', at: '2026-10-19T05:00:00Z', delta: { primo: 60 }, reason: 'manual' },
          baseVersion: 0,
        },
      ],
      old,
    );
    expect(res.epoch).not.toBe(old);
    expect(res.conflicts).toEqual([
      {
        collection: 'occ_status',
        id: 's1',
        server: { data: { id: 's1', status: 'claimed' }, version: 1, deleted: false },
      },
    ]);
    expect(res.applied.map((a) => a.id)).toEqual(['fresh', 'l1']);

    // с новой эпохой та же правка проходит
    const retry = await sync(
      phone,
      res.cursor,
      [{ collection: 'occ_status', id: 's1', data: { id: 's1', status: 'skipped' }, baseVersion: 1 }],
      res.epoch,
    );
    expect(retry.applied).toMatchObject([{ id: 's1', version: 2 }]);
  });
});
