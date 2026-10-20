// Пределы /api/sync и экспорта: размер документа, квоты аккаунта, страницы по байтам, один sync на пользователя
// (D-312–D-314).
import {
  ExportResponseSchema,
  jsonBytes,
  parseDoc,
  SyncResponseSchema,
  type Collection,
  type SyncResponse,
} from '@primo/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { Db } from '../db';
import { openPglite, type PgliteDatabase } from '../db/pglite';
import {
  createTestContext,
  errorCode,
  nextIp,
  testConfig,
  TestClient,
  type TestContext,
} from '../test/helpers';

const AT = '2026-10-19T05:00:00Z';

async function sync(
  c: TestClient,
  cursor: number,
  changes: unknown[] = [],
  epoch?: string,
): Promise<SyncResponse> {
  const res = await c.post('/api/sync', { cursor, changes, ...(epoch ? { epoch } : {}) });
  expect(res.statusCode, res.body).toBe(200);
  return SyncResponseSchema.parse(res.json());
}

const occ = (id: string) => ({
  collection: 'occ_status',
  id,
  data: { id, status: 'claimed' },
  baseVersion: 0,
});
/** Своя область с заметкой нужной длины — документ заданного размера. */
const area = (id: string, noteLength: number) => ({
  id,
  kind: 'area' as const,
  data: { regionId: 'natlan', name: 'Остров', chestBracket: 'high', note: 'x'.repeat(noteLength) },
});
const put = (collection: Collection, id: string, data: unknown, baseVersion = 0) => ({
  collection,
  id,
  data,
  baseVersion,
});
/** Размер документа так, как его считает сервер: JSON после схемы коллекции. */
const sizeOf = (collection: Collection, data: unknown) => jsonBytes(parseDoc(collection, data).data);

/** Счётчики пользователя против фактических строк user_docs. */
async function usage(ctx: TestContext, userId: string) {
  const counters = await ctx.database.client.query<{ doc_count: number; doc_bytes: string }>(
    'select doc_count, doc_bytes from users where id = $1',
    [userId],
  );
  const actual = await ctx.database.client.query<{ n: number; b: string | null }>(
    'select count(*)::int as n, sum(size)::text as b from user_docs where user_id = $1',
    [userId],
  );
  const c = counters.rows[0]!;
  const a = actual.rows[0]!;
  return {
    counters: { docs: c.doc_count, bytes: Number(c.doc_bytes) },
    actual: { docs: a.n, bytes: Number(a.b ?? 0) },
  };
}

describe('SEC-1: документ больше DOC_MAX_BYTES', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('прошедший схему, но больше 256 КБ — в rejected с понятной причиной и не сохраняется', async () => {
    const c = ctx.client();
    await c.register('big_doc');
    // 3000 типов сундуков по ~100 байт — схема cat_progress пропускает, размер ~300 КБ
    const chestCounts = Object.fromEntries(
      Array.from({ length: 3000 }, (_, i) => [`type_${i}_${'t'.repeat(80)}`, { low: i }]),
    );
    const huge = { categoryId: 'huge', chestCounts, updatedAt: AT };
    expect(parseDoc('cat_progress', huge).success).toBe(true);
    expect(jsonBytes(huge)).toBeGreaterThan(256 * 1024);

    const res = await sync(c, 0, [put('cat_progress', 'huge', huge), occ('small')]);
    expect(res.applied).toMatchObject([{ collection: 'occ_status', id: 'small' }]);
    expect(res.rejected).toEqual([
      { collection: 'cat_progress', id: 'huge', message: expect.stringMatching(/256 КБ/) },
    ]);
    expect((await c.get('/api/docs/cat_progress/huge')).statusCode).toBe(404);
  });

  it('свободные поля без своей схемы ограничены схемой коллекции', async () => {
    const c = ctx.client();
    await c.register('free_fields');
    const res = await sync(c, 0, [
      put('sim_preset', 'last', { runs: 1000, junk: 'x'.repeat(20_000) }),
      put('user_entity', 'user_area:x', area('user_area:x', 20_000)),
      put('override', 'category:x:title', {
        entity: 'category',
        id: 'x',
        field: 'title',
        value: 'x'.repeat(5000),
        at: AT,
      }),
      put('sim_preset', 'ok', { runs: 1000, mode: 'char_only' }),
    ]);
    expect(res.rejected?.map((r) => r.id)).toEqual(['last', 'user_area:x', 'category:x:title']);
    expect(res.applied.map((a) => a.id)).toEqual(['ok']);
  });
});

describe('SEC-1: страница ответа ограничена байтами', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({ syncPullLimit: 100, syncPullMaxBytes: 1000 });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('pull: строки добавляются, пока до них меньше бюджета; первая — всегда; more и курсор', async () => {
    const c = ctx.client();
    await c.register('byte_pages');
    const docs = [
      area('user_area:a', 1500), // одна больше бюджета — страница из неё одной
      area('user_area:b', 300),
      area('user_area:c', 300),
      area('user_area:d', 300),
      area('user_area:e', 300),
    ];
    const sizes = docs.map((d) => sizeOf('user_entity', d));
    expect(sizes[0]).toBeGreaterThan(1000);
    expect(sizes[1]! * 2).toBeLessThan(1000);
    expect(sizes[1]! * 3).toBeGreaterThan(1000);
    const written = await sync(
      c,
      0,
      docs.map((d) => put('user_entity', d.id, d)),
    );
    expect(written.applied).toHaveLength(5);
    const seqs = written.applied.map((a) => a.seq);

    // ответ на запись: первая страница — один большой документ
    expect(written.changes.map((ch) => ch.id)).toEqual(['user_area:a']);
    expect(written.more).toBe(true);
    expect(written.cursor).toBe(seqs[0]);

    // b + c: до c — 1 размер (< 1000), до d — 2 размера (< 1000) → b, c, d; до e — 3 размера ≥ 1000
    const second = await sync(c, written.cursor);
    expect(second.changes.map((ch) => ch.id)).toEqual(['user_area:b', 'user_area:c', 'user_area:d']);
    expect(second.more).toBe(true);
    expect(second.cursor).toBe(seqs[3]);

    const third = await sync(c, second.cursor);
    expect(third.changes.map((ch) => ch.id)).toEqual(['user_area:e']);
    expect(third.more ?? false).toBe(false);
    expect(third.cursor).toBe(seqs[4]);
  });

  it('конфликты тоже в пределах бюджета: остальные изменения не обработаны и ждут следующего запроса', async () => {
    const c = ctx.client();
    await c.register('conflict_budget');
    const docs = ['p', 'q', 'r'].map((id) => area(`user_area:${id}`, 600));
    await sync(
      c,
      0,
      docs.map((d) => put('user_entity', d.id, d)),
    );
    // устаревшая версия у всех трёх + новый документ в конце
    const stale = [...docs.map((d) => put('user_entity', d.id, area(d.id, 10), 0)), occ('after')];

    const r1 = await sync(c, 0, stale);
    expect(r1.conflicts.map((x) => x.id)).toEqual(['user_area:p']);
    expect(r1.conflicts[0]!.server).toEqual({ data: docs[0], version: 1, deleted: false });
    expect(r1.applied).toEqual([]);
    expect(r1.rejected ?? []).toEqual([]);
    expect(r1.more).toBe(true);

    // страница изменений здесь уже полная — more только из-за необработанных изменений
    const r2 = await sync(c, r1.cursor, stale.slice(1));
    expect(r2.conflicts.map((x) => x.id)).toEqual(['user_area:q']);
    expect(r2.applied).toEqual([]);
    expect(r2.more).toBe(true);
    const r3 = await sync(c, r2.cursor, stale.slice(2));
    expect(r3.conflicts.map((x) => x.id)).toEqual(['user_area:r']);
    expect(r3.applied).toMatchObject([{ collection: 'occ_status', id: 'after', version: 1 }]);
    expect(r3.more ?? false).toBe(false);
  });

  it('экспорт идёт потоком страницами по ключу и байтам: все неудалённые документы по порядку', async () => {
    const c = ctx.client();
    const { user } = await c.register('streamer');
    const changes = [
      ...Array.from({ length: 12 }, (_, i) => occ(`occ:${String(i).padStart(2, '0')}`)),
      ...Array.from({ length: 6 }, (_, i) =>
        put('user_entity', `user_area:${i}`, area(`user_area:${i}`, 400)),
      ),
      put('goal', 'gone', {
        id: 'gone',
        title: 'x',
        target: { kind: 'date', at: AT },
        need: { kind: 'pulls', n: 1 },
      }),
    ];
    await sync(c, 0, changes);
    await sync(c, 0, [{ collection: 'goal', id: 'gone', data: null, baseVersion: 1 }]);

    const res = await c.get('/api/export');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    // поток: длина заранее неизвестна
    expect(res.headers['content-length']).toBeUndefined();
    const body = ExportResponseSchema.parse(res.json());
    expect(body.user).toEqual(user);
    const keys = body.docs.map((d) => `${d.collection}/${d.id}`);
    expect(keys).toHaveLength(18);
    expect(keys).toEqual([...keys].sort());
    expect(keys).not.toContain('goal/gone');
    expect(body.docs.find((d) => d.id === 'user_area:3')).toMatchObject({ data: area('user_area:3', 400) });

    // пустой аккаунт — корректный JSON с пустым списком
    const empty = ctx.client();
    await empty.register('empty_export');
    expect(ExportResponseSchema.parse((await empty.get('/api/export')).json()).docs).toEqual([]);
  });
});

describe('SEC-4: квоты аккаунта', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({ userMaxDocs: 5, userMaxBytes: 2000 });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('документов не больше userMaxDocs: лишние — в rejected, удалённые тоже занимают место', async () => {
    const c = ctx.client();
    const { user } = await c.register('doc_quota');
    const res = await sync(c, 0, ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(occ));
    expect(res.applied.map((a) => a.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(res.rejected).toEqual([
      { collection: 'occ_status', id: 'f', message: expect.stringMatching(/5 документов/) },
      { collection: 'occ_status', id: 'g', message: expect.stringMatching(/5 документов/) },
    ]);
    expect((await c.get('/api/docs/occ_status/f')).statusCode).toBe(404);

    // правка и удаление существующего документа — не новые строки, проходят
    const edit = await sync(c, res.cursor, [
      { collection: 'occ_status', id: 'a', data: { id: 'a', status: 'skipped' }, baseVersion: 1 },
      { collection: 'occ_status', id: 'b', data: null, baseVersion: 1 },
      occ('h'),
    ]);
    expect(edit.applied.map((a) => a.id)).toEqual(['a', 'b']);
    expect(edit.rejected?.map((r) => r.id)).toEqual(['h']);

    const u = await usage(ctx, user.id);
    expect(u.counters).toEqual(u.actual);
    expect(u.counters.docs).toBe(5);
  });

  it('байт не больше userMaxBytes: рост сверх квоты отклоняется, уменьшение и удаление — всегда', async () => {
    const c = ctx.client();
    const { user } = await c.register('byte_quota');
    const big = area('user_area:big', 900);
    const res = await sync(c, 0, [
      put('user_entity', 'user_area:big', big),
      put('user_entity', 'user_area:big2', area('user_area:big2', 900)),
    ]);
    expect(res.applied.map((a) => a.id)).toEqual(['user_area:big']);
    expect(res.rejected).toEqual([
      { collection: 'user_entity', id: 'user_area:big2', message: expect.stringMatching(/2 КБ/) },
    ]);

    // рост существующего сверх квоты — нет; уменьшение — да
    const grow = await sync(c, res.cursor, [
      put('user_entity', 'user_area:big', area('user_area:big', 1900), 1),
    ]);
    expect(grow.rejected?.map((r) => r.id)).toEqual(['user_area:big']);
    const shrink = await sync(c, grow.cursor, [
      put('user_entity', 'user_area:big', area('user_area:big', 100), 1),
    ]);
    expect(shrink.applied).toMatchObject([{ id: 'user_area:big', version: 2 }]);

    // место освободилось — второй документ помещается
    const again = await sync(c, shrink.cursor, [
      put('user_entity', 'user_area:big2', area('user_area:big2', 900)),
    ]);
    expect(again.applied.map((a) => a.id)).toEqual(['user_area:big2']);

    // удаление при заполненной квоте проходит и освобождает байты
    const del = await sync(c, again.cursor, [
      { collection: 'user_entity', id: 'user_area:big2', data: null, baseVersion: 1 },
    ]);
    expect(del.applied).toMatchObject([{ id: 'user_area:big2', version: 2 }]);

    const u = await usage(ctx, user.id);
    expect(u.counters).toEqual(u.actual);
    expect(u.counters.bytes).toBe(sizeOf('user_entity', area('user_area:big', 100)));
  });
});

describe('SEC-4: частота записей', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({ syncWritesPerMinute: 3 });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('не больше syncWritesPerMinute запросов с изменениями на пользователя; чтение и другие — не ограничены', async () => {
    const c = ctx.client();
    await c.register('writer');
    for (let i = 0; i < 3; i++) await sync(c, 0, [occ(`w${i}`)]);
    const limited = await c.post('/api/sync', { cursor: 0, changes: [occ('w3')] });
    expect(limited.statusCode).toBe(429);
    expect(errorCode(limited)).toBe('RATE_LIMIT');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await c.get('/api/docs/occ_status/w3')).statusCode).toBe(404);

    // без изменений — только чтение, не считается
    expect((await sync(c, 0)).changes).toHaveLength(3);
    // тот же пользователь с другого устройства — тот же счётчик
    const laptop = ctx.client();
    await laptop.login('writer');
    expect((await laptop.post('/api/sync', { cursor: 0, changes: [occ('w4')] })).statusCode).toBe(429);

    const other = ctx.client();
    await other.register('other_writer');
    expect((await sync(other, 0, [occ('x')])).applied).toHaveLength(1);
  });
});

describe('SEC-3: один /api/sync пользователя за раз', () => {
  let database: PgliteDatabase;
  let app: FastifyInstance;
  /** Одноразовая задержка: следующая db.transaction ждёт её перед началом. */
  let hold: (() => Promise<void>) | null = null;
  let transactions = 0;

  beforeAll(async () => {
    const config = testConfig();
    database = await openPglite();
    await database.migrate(config.migrationsDir);
    const real = database.db;
    const db = Object.create(real) as Db;
    Object.defineProperty(db, 'transaction', {
      value: async (...args: Parameters<Db['transaction']>) => {
        transactions++;
        const wait = hold;
        hold = null;
        if (wait) await wait();
        return real.transaction(...args);
      },
    });
    app = await buildApp({ config, db });
  });
  afterAll(async () => {
    await app.close();
    await database.close();
  });

  it('второй параллельный sync того же пользователя — 429 сразу, без транзакции; другой пользователь работает', async () => {
    const alice = new TestClient(app, nextIp());
    await alice.register('alice_sec3');
    const bob = new TestClient(app, nextIp());
    await bob.register('bob_sec3');

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inside = new Promise<void>((r) => (entered = r));
    hold = async () => {
      entered();
      await gate;
    };

    const first = alice.post('/api/sync', { cursor: 0, changes: [occ('first')] });
    await inside; // первый sync Алисы в обработчике и ждёт начала транзакции
    const before = transactions;

    const second = await alice.post('/api/sync', { cursor: 0, changes: [occ('second')] });
    expect(second.statusCode).toBe(429);
    expect(errorCode(second)).toBe('RATE_LIMIT');
    expect(second.headers['retry-after']).toBe('1');
    expect(transactions).toBe(before);

    const fromBob = await bob.post('/api/sync', { cursor: 0, changes: [occ('bob')] });
    expect(fromBob.statusCode).toBe(200);
    expect(SyncResponseSchema.parse(fromBob.json()).applied).toHaveLength(1);

    release();
    const done = await first;
    expect(done.statusCode).toBe(200);
    expect(SyncResponseSchema.parse(done.json()).applied.map((a) => a.id)).toEqual(['first']);

    // первый закончился — следующий проходит
    const next = await alice.post('/api/sync', { cursor: 0, changes: [occ('second')] });
    expect(next.statusCode).toBe(200);
  });
});
