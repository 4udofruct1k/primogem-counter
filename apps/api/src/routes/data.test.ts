import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyDatapackPatch, type DatapackPatchLike, type RawDatapack } from '@primo/domain';
import { DatapackPatchSchema, ManifestSchema, type Manifest } from '@primo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { ADMIN, createTestContext, errorCode, type TestClient, type TestContext } from '../test/helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const DATAPACK = 'datapack-2026-10-19.json';
const SEED = 'primo_seed_regions.json';

async function manifest(c: TestClient = ctx.client()): Promise<Manifest> {
  const res = await c.get('/data/manifest.json');
  expect(res.statusCode).toBe(200);
  return ManifestSchema.parse(res.json());
}

describe('игровые данные /data (14.6)', () => {
  it('manifest.json: текущие файлы, хэши, версии; без кэша', async () => {
    const res = await ctx.client().get('/data/manifest.json');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
    const m = ManifestSchema.parse(res.json());

    const packRaw = await readFile(path.join(ctx.config.dataDir, DATAPACK));
    const seedRaw = await readFile(path.join(ctx.config.dataDir, SEED));
    expect(m.files.datapack).toEqual({ path: `/data/${DATAPACK}`, sha256: sha256(packRaw) });
    expect(m.files.seed).toEqual({ path: `/data/${SEED}`, sha256: sha256(seedRaw) });
    expect(m.packVersion).toBe(JSON.parse(packRaw.toString('utf8')).packVersion);
    expect(m.seedSchemaVersion).toBe(JSON.parse(seedRaw.toString('utf8')).schemaVersion);
    expect(m.patch).toBeNull();
    expect(Number.isNaN(Date.parse(m.generatedAt))).toBe(false);
  });

  it('файлы по путям манифеста: тот же хэш, Cache-Control public, max-age=300', async () => {
    const m = await manifest();
    for (const ref of [m.files.datapack, m.files.seed]) {
      const res = await ctx.client().get(ref.path);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.headers['cache-control']).toBe('public, max-age=300');
      expect(sha256(res.rawPayload)).toBe(ref.sha256);
    }
    expect((await ctx.client().get(`/data/${DATAPACK}`)).json()).toMatchObject({ gameVersion: '7.1' });
  });

  it('несуществующий файл и выход за пределы data/ → 404 NOT_FOUND', async () => {
    for (const url of ['/data/nope.json', '/data/../package.json', '/data/%2e%2e/package.json', '/data/']) {
      const res = await ctx.client().get(url);
      expect(res.statusCode, url).toBe(404);
      expect(errorCode(res)).toBe('NOT_FOUND');
    }
  });

  it('датапак — самый новый data/datapack-*.json; правка файла меняет хэш в манифесте', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'primo-data-'));
    try {
      await copyFile(path.join(ctx.config.dataDir, SEED), path.join(dir, SEED));
      await copyFile(path.join(ctx.config.dataDir, DATAPACK), path.join(dir, DATAPACK));
      const pack = JSON.parse(await readFile(path.join(dir, DATAPACK), 'utf8')) as { packVersion: number };
      const newer = 'datapack-2026-11-05.json';
      await writeFile(path.join(dir, newer), JSON.stringify({ ...pack, packVersion: pack.packVersion + 1 }));

      const app = await buildApp({ config: { ...ctx.config, dataDir: dir }, db: ctx.database.db });
      try {
        const get = async () =>
          ManifestSchema.parse((await app.inject({ url: '/data/manifest.json' })).json());
        const m1 = await get();
        expect(m1.files.datapack.path).toBe(`/data/${newer}`);
        expect(m1.packVersion).toBe(pack.packVersion + 1);

        await writeFile(
          path.join(dir, newer),
          JSON.stringify({ ...pack, packVersion: pack.packVersion + 2 }, null, 1),
        );
        const m2 = await get();
        expect(m2.packVersion).toBe(pack.packVersion + 2);
        expect(m2.files.datapack.sha256).not.toBe(m1.files.datapack.sha256);
        expect(m2.files.datapack.sha256).toBe(sha256(await readFile(path.join(dir, newer))));
      } finally {
        await app.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('админка данных: патч датапака', () => {
  const patch1 = {
    events: [{ id: '7.1-overflowing-favor', note: 'правка из админки' }],
    eventTemplate: { versions: { '7.3': { small: { count: 3 } } } },
  };
  const patch2 = { ...patch1, notes: ['вторая правка'] };
  let admin: TestClient;
  let user: TestClient;
  let base: RawDatapack;

  beforeAll(async () => {
    admin = ctx.client();
    await admin.register('Data_Admin');
    user = ctx.client();
    await user.register('plain_user');
    base = JSON.parse(await readFile(path.join(ctx.config.dataDir, DATAPACK), 'utf8')) as RawDatapack;
  });

  it('админы — из ADMIN_USERNAMES без учёта регистра; /api/me.isAdmin', async () => {
    expect(ADMIN).toBe('data_admin');
    expect((await admin.get('/api/me')).json()).toMatchObject({ username: 'data_admin', isAdmin: true });
    expect((await user.get('/api/me')).json()).toMatchObject({ isAdmin: false });
  });

  it('аноним → 401 AUTH_REQUIRED, обычный пользователь → 403 FORBIDDEN', async () => {
    const anon = ctx.client();
    for (const [c, status, code] of [
      [anon, 401, 'AUTH_REQUIRED'],
      [user, 403, 'FORBIDDEN'],
    ] as const) {
      const get = await c.get('/api/admin/patch');
      expect(get.statusCode).toBe(status);
      expect(errorCode(get)).toBe(code);
      const put = await c.put('/api/admin/patch', { patch: patch1, baseVersion: 0 });
      expect(put.statusCode).toBe(status);
      expect(errorCode(put)).toBe(code);
    }
  });

  it('сохранение версий, раздача /data/patch-<n>.json и манифест; устаревшая baseVersion → 409', async () => {
    const empty = await admin.get('/api/admin/patch');
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ version: 0, patch: {}, updatedAt: null });

    const saved = await admin.put('/api/admin/patch', { patch: patch1, baseVersion: 0 });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toEqual({ version: 1 });

    const current = (await admin.get('/api/admin/patch')).json<{
      version: number;
      patch: unknown;
      updatedAt: string;
    }>();
    expect(current.version).toBe(1);
    expect(current.patch).toEqual(patch1);
    expect(Number.isNaN(Date.parse(current.updatedAt))).toBe(false);

    const m = await manifest(user);
    expect(m.patch).toMatchObject({ version: 1, path: '/data/patch-1.json', updatedAt: current.updatedAt });
    const file = await ctx.client().get(m.patch!.path);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toMatch(/application\/json/);
    expect(file.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(sha256(file.rawPayload)).toBe(m.patch!.sha256);

    // клиент (apps/web/src/data/gamedata.ts) парсит патч и накладывает на датапак
    const parsed = DatapackPatchSchema.parse(file.json()) as DatapackPatchLike;
    const merged = applyDatapackPatch(base, parsed);
    expect(merged.events.find((e) => e.id === '7.1-overflowing-favor')).toMatchObject({
      note: 'правка из админки',
    });

    const stale = await admin.put('/api/admin/patch', { patch: patch2, baseVersion: 0 });
    expect(stale.statusCode).toBe(409);
    expect(errorCode(stale)).toBe('CONFLICT');
    expect((await admin.get('/api/admin/patch')).json()).toMatchObject({ version: 1 });

    const next = await admin.put('/api/admin/patch', { patch: patch2, baseVersion: 1 });
    expect(next.json()).toEqual({ version: 2 });
    expect((await manifest()).patch).toMatchObject({ version: 2, path: '/data/patch-2.json' });
    // старые версии неизменны
    expect((await ctx.client().get('/data/patch-1.json')).json()).toEqual(patch1);
    expect((await ctx.client().get('/data/patch-2.json')).json()).toEqual(patch2);

    const missing = await ctx.client().get('/data/patch-99.json');
    expect(missing.statusCode).toBe(404);
    expect(errorCode(missing)).toBe('NOT_FOUND');
  });

  it('патч не по схеме и патч, ломающий датапак, → 400 VALIDATION; версия не меняется', async () => {
    const before = (await admin.get('/api/admin/patch')).json<{ version: number }>().version;
    const bad = await admin.put('/api/admin/patch', {
      patch: { events: [{ reward: {} }] },
      baseVersion: before,
    });
    expect(bad.statusCode).toBe(400);
    expect(errorCode(bad)).toBe('VALIDATION');

    // новая запись ивента только с id — в итоговом датапаке у неё нет обязательных полей
    const broken = await admin.put('/api/admin/patch', {
      patch: { events: [{ id: 'brand-new-event' }] },
      baseVersion: before,
    });
    expect(broken.statusCode).toBe(400);
    expect(errorCode(broken)).toBe('VALIDATION');
    expect(broken.json<{ error: { message: string } }>().error.message).toMatch(/датапак/i);

    const noVersions = await admin.put('/api/admin/patch', {
      patch: { versions: base.versions.map((v) => ({ id: v.id, _delete: true })) },
      baseVersion: before,
    });
    expect(noVersions.statusCode).toBe(400);
    expect((await admin.get('/api/admin/patch')).json<{ version: number }>().version).toBe(before);
  });
});
