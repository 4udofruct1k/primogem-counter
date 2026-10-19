import { DEFAULT_SETTINGS, ExportResponseSchema, SyncResponseSchema, type SyncResponse } from '@primo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, errorCode, type TestClient, type TestContext } from '../test/helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext({ syncPullLimit: 3 });
});

afterAll(async () => {
  await ctx.close();
});

const AT = '2026-10-19T05:00:00Z';

const progress = (count: number) => ({ categoryId: 'mondstadt_main:waypoints', count, updatedAt: AT });
const ledger = (id: string, primo: number) => ({ id, at: AT, delta: { primo }, reason: 'manual' as const });

async function sync(c: TestClient, cursor: number, changes: unknown[] = []): Promise<SyncResponse> {
  const res = await c.post('/api/sync', { cursor, changes });
  expect(res.statusCode, res.body).toBe(200);
  return SyncResponseSchema.parse(res.json());
}

describe('TC-46: два устройства меняют один cat_progress', () => {
  it('первое принято (version 2), второе — конфликт с серверной версией; ledger с обоих принят', async () => {
    const phone = ctx.client();
    await phone.register('two_devices');
    const laptop = ctx.client();
    await laptop.login('two_devices');
    const id = 'mondstadt_main:waypoints';

    const created = await sync(phone, 0, [
      { collection: 'cat_progress', id, data: progress(1), baseVersion: 0 },
    ]);
    expect(created.applied).toMatchObject([{ collection: 'cat_progress', id, version: 1 }]);

    const pulled = await sync(laptop, 0);
    expect(pulled.changes).toEqual([
      { collection: 'cat_progress', id, data: progress(1), version: 1, deleted: false },
    ]);

    const first = await sync(phone, created.cursor, [
      { collection: 'cat_progress', id, data: progress(5), baseVersion: 1 },
      { collection: 'ledger', id: 'claim:phone', data: ledger('claim:phone', 60), baseVersion: 0 },
    ]);
    expect(first.conflicts).toEqual([]);
    expect(first.applied).toMatchObject([
      { collection: 'cat_progress', id, version: 2 },
      { collection: 'ledger', id: 'claim:phone', version: 1 },
    ]);
    expect(first.applied[0]!.seq).toBeGreaterThan(created.applied[0]!.seq);

    const second = await sync(laptop, pulled.cursor, [
      { collection: 'cat_progress', id, data: progress(9), baseVersion: 1 },
      { collection: 'ledger', id: 'claim:laptop', data: ledger('claim:laptop', 40), baseVersion: 0 },
      // повтор чужой записи леджера (например, после обрыва связи) — не конфликт и не перезапись
      { collection: 'ledger', id: 'claim:phone', data: ledger('claim:phone', 9999), baseVersion: 0 },
    ]);
    expect(second.conflicts).toEqual([
      { collection: 'cat_progress', id, server: { data: progress(5), version: 2, deleted: false } },
    ]);
    expect(second.applied).toMatchObject([
      { collection: 'ledger', id: 'claim:laptop', version: 1 },
      { collection: 'ledger', id: 'claim:phone', version: 1, seq: first.applied[1]!.seq },
    ]);

    const all = await sync(phone, 0);
    const byId = Object.fromEntries(all.changes.map((ch) => [ch.id, ch]));
    expect(byId[id]).toMatchObject({ data: progress(5), version: 2 });
    expect(byId['claim:phone']).toMatchObject({ data: ledger('claim:phone', 60), version: 1 });
    expect(byId['claim:laptop']).toMatchObject({ data: ledger('claim:laptop', 40), version: 1 });
  });
});

describe('TC-47: гость → «Сохранить в аккаунт»', () => {
  it('после регистрации все локальные документы на сервере, GET /api/export их содержит', async () => {
    const guestDocs = [
      { collection: 'settings', id: 'settings', data: { ...DEFAULT_SETTINGS, server: 'asia' } },
      {
        collection: 'wallet_snapshot',
        id: 'ws1',
        data: {
          id: 'ws1',
          at: AT,
          primo: 5000,
          crystal: 300,
          if: 12,
          af: 20,
          starglitter: 0,
          stardust: 0,
          pity: {
            char: 23,
            charGuaranteed: false,
            radiance: 0,
            weapon: 10,
            weaponGuaranteed: false,
            weaponFatePoint: 0,
          },
        },
      },
      { collection: 'ledger', id: 'l1', data: ledger('l1', 160) },
      {
        collection: 'occ_status',
        id: 'daily_commissions:2026-10-19',
        data: { id: 'daily_commissions:2026-10-19', status: 'claimed', claimedAt: AT },
      },
      {
        collection: 'cat_progress',
        id: 'natlan_main:statue',
        data: { categoryId: 'natlan_main:statue', levels: [7], updatedAt: AT },
      },
      {
        collection: 'area_state',
        id: 'dragonspine',
        data: { areaId: 'dragonspine', chests100: false, closed: true, plan: { kind: 'none' } },
      },
      {
        collection: 'abyss',
        id: 'abyss:2026-10-16',
        data: {
          id: 'abyss:2026-10-16',
          stars: [
            [3, 3, 3],
            [3, 3, 3],
            [3, 3, 3],
            [3, 2, 2],
          ],
          claimed: false,
        },
      },
      {
        collection: 'goal',
        id: 'g1',
        data: {
          id: 'g1',
          title: 'Скирк C2',
          target: { kind: 'date', at: '2026-12-01T00:00:00Z' },
          need: { kind: 'char5', copies: 3 },
        },
      },
      { collection: 'sim_preset', id: 'last', data: { runs: 10000, mode: 'char_weapon' } },
    ];

    const c = ctx.client();
    const { user } = await c.register('guest_saver');
    const res = await sync(
      c,
      0,
      guestDocs.map((d) => ({ ...d, baseVersion: 0 })),
    );
    expect(res.conflicts).toEqual([]);
    expect(res.rejected ?? []).toEqual([]);
    expect(res.applied).toHaveLength(guestDocs.length);

    const exp = await c.get('/api/export');
    expect(exp.statusCode).toBe(200);
    const body = ExportResponseSchema.parse(exp.json());
    expect(body.user).toEqual(user);
    expect(body.docs).toHaveLength(guestDocs.length);
    for (const d of guestDocs) {
      expect(body.docs).toContainEqual(
        expect.objectContaining({ collection: d.collection, id: d.id, data: d.data, version: 1 }),
      );
    }
  });
});

describe('TC-48: доступ к чужим данным', () => {
  it('запросы видят только документы своей сессии; чужой doc_id → 404', async () => {
    const alice = ctx.client();
    await alice.register('alice_48');
    const bob = ctx.client();
    await bob.register('bob_48');
    const id = 'sumeru_main:chests';
    const secret = { categoryId: id, count: 42, updatedAt: AT };
    await sync(alice, 0, [{ collection: 'cat_progress', id, data: secret, baseVersion: 0 }]);

    const own = await alice.get(`/api/docs/cat_progress/${encodeURIComponent(id)}`);
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({ collection: 'cat_progress', id, data: secret, version: 1 });

    const foreign = await bob.get(`/api/docs/cat_progress/${encodeURIComponent(id)}`);
    expect(foreign.statusCode).toBe(404);
    expect(errorCode(foreign)).toBe('NOT_FOUND');

    const pulled = await sync(bob, 0);
    expect(pulled.changes).toEqual([]);
    expect(pulled.cursor).toBe(0);
    expect((await bob.get('/api/export')).json<{ docs: unknown[] }>().docs).toEqual([]);

    // правка «того же» документа у Боба — свой документ; у Алисы ничего не меняется
    const bobUpdate = await sync(bob, 0, [
      { collection: 'cat_progress', id, data: progress(1), baseVersion: 1 },
    ]);
    expect(bobUpdate.conflicts).toEqual([
      { collection: 'cat_progress', id, server: { data: null, version: 0, deleted: true } },
    ]);
    const bobCreate = await sync(bob, 0, [
      { collection: 'cat_progress', id, data: progress(1), baseVersion: 0 },
    ]);
    expect(bobCreate.applied).toMatchObject([{ id, version: 1 }]);
    expect((await alice.get(`/api/docs/cat_progress/${encodeURIComponent(id)}`)).json()).toMatchObject({
      data: secret,
      version: 1,
    });

    const anon = await ctx.client().get(`/api/docs/cat_progress/${encodeURIComponent(id)}`);
    expect(anon.statusCode).toBe(401);
    expect(errorCode(anon)).toBe('AUTH_REQUIRED');
    expect((await ctx.client().post('/api/sync', { cursor: 0, changes: [] })).statusCode).toBe(401);
    expect((await ctx.client().get('/api/export')).statusCode).toBe(401);
  });
});

describe('sync: удаление, новые документы, отклонённые изменения', () => {
  it('data null — мягкое удаление с новой версией; повтор на старой версии — конфликт', async () => {
    const c = ctx.client();
    await c.register('deleter');
    const id = 'g1';
    const goal = { id, title: 'Цель', target: { kind: 'date', at: AT }, need: { kind: 'pulls', n: 80 } };
    await sync(c, 0, [{ collection: 'goal', id, data: goal, baseVersion: 0 }]);
    const del = await sync(c, 0, [{ collection: 'goal', id, data: null, baseVersion: 1 }]);
    expect(del.applied).toMatchObject([{ collection: 'goal', id, version: 2 }]);
    expect(del.changes).toEqual([{ collection: 'goal', id, data: null, version: 2, deleted: true }]);
    expect((await c.get(`/api/docs/goal/${id}`)).statusCode).toBe(404);
    expect((await c.get('/api/export')).json<{ docs: unknown[] }>().docs).toEqual([]);

    const stale = await sync(c, del.cursor, [{ collection: 'goal', id, data: goal, baseVersion: 1 }]);
    expect(stale.conflicts).toEqual([
      { collection: 'goal', id, server: { data: null, version: 2, deleted: true } },
    ]);

    const again = await sync(c, del.cursor, [{ collection: 'goal', id, data: goal, baseVersion: 2 }]);
    expect(again.applied).toMatchObject([{ id, version: 3 }]);
    expect((await c.get(`/api/docs/goal/${id}`)).json()).toMatchObject({ data: goal, version: 3 });

    // удаление документа, которого на сервере не было (создан и удалён офлайн)
    const ghost = await sync(c, 0, [{ collection: 'goal', id: 'ghost', data: null, baseVersion: 0 }]);
    expect(ghost.applied).toMatchObject([{ id: 'ghost', version: 1 }]);
  });

  it('новый документ с baseVersion > 0 — конфликт «на сервере нет»', async () => {
    const c = ctx.client();
    await c.register('stale_base');
    const res = await sync(c, 0, [
      { collection: 'cat_progress', id: 'x', data: progress(1), baseVersion: 4 },
    ]);
    expect(res.applied).toEqual([]);
    expect(res.conflicts).toEqual([
      { collection: 'cat_progress', id: 'x', server: { data: null, version: 0, deleted: true } },
    ]);
  });

  it('документ не по схеме коллекции и удаление из леджера — отклонены, остальное применено', async () => {
    const c = ctx.client();
    await c.register('rejected_user');
    await sync(c, 0, [{ collection: 'ledger', id: 'keep', data: ledger('keep', 10), baseVersion: 0 }]);
    const res = await sync(c, 0, [
      { collection: 'cat_progress', id: 'bad', data: { categoryId: 'bad', count: -1 }, baseVersion: 0 },
      { collection: 'abyss', id: 'a', data: { id: 'a', stars: [], claimed: false }, baseVersion: 0 },
      { collection: 'ledger', id: 'keep', data: null, baseVersion: 1 },
      { collection: 'occ_status', id: 'ok', data: { id: 'ok', status: 'skipped' }, baseVersion: 0 },
    ]);
    expect(res.applied).toMatchObject([{ collection: 'occ_status', id: 'ok', version: 1 }]);
    expect(res.conflicts).toEqual([]);
    expect(res.rejected?.map((r) => `${r.collection}/${r.id}`)).toEqual([
      'cat_progress/bad',
      'abyss/a',
      'ledger/keep',
    ]);
    for (const r of res.rejected ?? []) expect(r.message).not.toBe('');
    expect((await c.get('/api/docs/cat_progress/bad')).statusCode).toBe(404);
    expect((await c.get('/api/docs/ledger/keep')).json()).toMatchObject({
      data: ledger('keep', 10),
      version: 1,
    });
  });

  it('сервер хранит очищенный по схеме документ', async () => {
    const c = ctx.client();
    await c.register('cleaner');
    await sync(c, 0, [
      {
        collection: 'region_state',
        id: 'inazuma',
        data: { regionId: 'inazuma', closed: false, junk: 'x'.repeat(100) },
        baseVersion: 0,
      },
    ]);
    expect((await c.get('/api/docs/region_state/inazuma')).json<{ data: unknown }>().data).toEqual({
      regionId: 'inazuma',
      closed: false,
    });
  });

  it('запрос не по схеме (коллекция, > 500 изменений) → 400 VALIDATION целиком', async () => {
    const c = ctx.client();
    await c.register('bad_request');
    const unknown = await c.post('/api/sync', {
      cursor: 0,
      changes: [{ collection: 'users', id: 'x', data: null, baseVersion: 0 }],
    });
    expect(unknown.statusCode).toBe(400);
    expect(errorCode(unknown)).toBe('VALIDATION');
    const change = { collection: 'occ_status', id: 'x', data: null, baseVersion: 0 };
    const tooMany = await c.post('/api/sync', { cursor: 0, changes: Array(501).fill(change) });
    expect(tooMany.statusCode).toBe(400);
    expect((await c.get('/api/export')).json<{ docs: unknown[] }>().docs).toEqual([]);
  });
});

describe('sync: курсор и пакеты', () => {
  it('изменения после курсора отдаются частями с more: true; seq глобальный и растёт', async () => {
    const c = ctx.client();
    await c.register('batcher');
    const changes = Array.from({ length: 7 }, (_, i) => ({
      collection: 'occ_status',
      id: `occ:${i}`,
      data: { id: `occ:${i}`, status: 'claimed' },
      baseVersion: 0,
    }));
    const first = await sync(c, 0, changes);
    expect(first.applied).toHaveLength(7);
    const seqs = first.applied.map((a) => a.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(7);

    // лимит ответа в тесте — 3 (в проде 1000)
    expect(first.changes.map((ch) => ch.id)).toEqual(['occ:0', 'occ:1', 'occ:2']);
    expect(first.more).toBe(true);
    expect(first.cursor).toBe(seqs[2]);

    const second = await sync(c, first.cursor);
    expect(second.changes.map((ch) => ch.id)).toEqual(['occ:3', 'occ:4', 'occ:5']);
    expect(second.more).toBe(true);
    const third = await sync(c, second.cursor);
    expect(third.changes.map((ch) => ch.id)).toEqual(['occ:6']);
    expect(third.more ?? false).toBe(false);
    expect(third.cursor).toBe(seqs[6]);

    const idle = await sync(c, third.cursor);
    expect(idle.changes).toEqual([]);
    expect(idle.cursor).toBe(third.cursor);

    // другой пользователь пишет — его seq больше, но мне он не виден и курсор не двигает
    const other = ctx.client();
    await other.register('batcher_neighbour');
    const theirs = await sync(other, 0, [
      { collection: 'occ_status', id: 'n', data: { id: 'n', status: 'planned' }, baseVersion: 0 },
    ]);
    expect(theirs.applied[0]!.seq).toBeGreaterThan(seqs[6]!);
    expect((await sync(c, third.cursor)).cursor).toBe(third.cursor);
  });

  it('курсор впереди сервера (БД восстановлена из бэкапа) — сервер отдаёт всё заново', async () => {
    const c = ctx.client();
    await c.register('time_traveller');
    const res = await sync(c, 0, [
      {
        collection: 'region_state',
        id: 'fontaine',
        data: { regionId: 'fontaine', closed: false },
        baseVersion: 0,
      },
    ]);
    const ahead = await sync(c, res.cursor + 1_000_000);
    expect(ahead.changes.map((ch) => ch.id)).toEqual(['fontaine']);
    expect(ahead.cursor).toBe(res.cursor);
  });
});
