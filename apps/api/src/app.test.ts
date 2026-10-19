import { Writable } from 'node:stream';
import { HealthResponseSchema } from '@primo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { openPglite } from './db/pglite';
import { createTestContext, errorCode, TEST_ORIGIN, testConfig, type TestContext } from './test/helpers';

let ctx: TestContext;
const client = () => ctx.database.client;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

describe('БД и миграции (14.3)', () => {
  it('миграции идемпотентны; логин — citext: уникален без учёта регистра даже в обход API', async () => {
    await ctx.database.migrate(ctx.config.migrationsDir);
    const pg = client();
    const ext = await pg.query<{ extname: string }>(
      "select extname from pg_extension where extname = 'citext'",
    );
    expect(ext.rows).toHaveLength(1);
    const insert = (name: string) =>
      pg.query("insert into users (username, password_hash, recovery_hash) values ($1, 'x', 'y')", [name]);
    await insert('Raw_Case');
    await expect(insert('raw_CASE')).rejects.toThrow(/unique/i);
    const found = await pg.query('select username from users where username = $1', ['RAW_case']);
    expect(found.rows).toEqual([{ username: 'Raw_Case' }]);
  });

  it('seq документов — одна глобальная последовательность', async () => {
    const seq = await client().query<{ n: string }>(
      "select count(*)::text as n from pg_class where relkind = 'S' and relname = 'user_docs_seq'",
    );
    expect(seq.rows[0]!.n).toBe('1');
  });
});

describe('GET /api/health (15.6)', () => {
  it('БД доступна → { ok: true, db: up, version }', async () => {
    const res = await ctx.app.inject({ url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(HealthResponseSchema.parse(res.json())).toEqual({ ok: true, db: 'up', version: 'test' });
  });

  it('БД недоступна → 503 { ok: false, db: down }', async () => {
    const database = await openPglite();
    const app = await buildApp({ config: testConfig(), db: database.db });
    await database.close();
    try {
      const res = await app.inject({ url: '/api/health' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ ok: false, db: 'down', version: 'test' });
    } finally {
      await app.close();
    }
  });
});

describe('защита (14.2)', () => {
  it('изменяющие запросы без Origin или с чужим Origin → 403 FORBIDDEN', async () => {
    const c = ctx.client();
    await c.register('origin_user');
    const cases: [string, string, unknown][] = [
      ['POST', '/api/auth/login', { username: 'origin_user', password: 'correct horse' }],
      ['POST', '/api/auth/register', { username: 'origin_new', password: 'correct horse' }],
      ['POST', '/api/sync', { cursor: 0, changes: [] }],
      ['DELETE', '/api/account', { password: 'correct horse' }],
      ['PUT', '/api/admin/patch', { patch: {}, baseVersion: 0 }],
      ['POST', '/api/auth/logout', {}],
    ];
    for (const origin of [
      undefined,
      'https://evil.example',
      'null',
      `${TEST_ORIGIN}.evil.example`,
      'http://primo.test',
    ]) {
      for (const [method, url, payload] of cases) {
        const res = await ctx.app.inject({
          method: method as 'POST',
          url,
          payload: payload as object,
          headers: { cookie: `sid=${c.sid}`, ...(origin === undefined ? {} : { origin }) },
        });
        expect(res.statusCode, `${method} ${url} origin=${origin}`).toBe(403);
        expect(errorCode(res)).toBe('FORBIDDEN');
      }
    }
    // сессия жива, аккаунт на месте
    expect((await c.get('/api/me')).statusCode).toBe(200);
    // чтение без Origin — можно
    expect((await ctx.app.inject({ url: '/api/health' })).statusCode).toBe(200);
  });

  it('CORS — только свой домен', async () => {
    const preflight = (origin: string) =>
      ctx.app.inject({
        method: 'OPTIONS',
        url: '/api/sync',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      });
    const own = await preflight(TEST_ORIGIN);
    expect(own.headers['access-control-allow-origin']).toBe(TEST_ORIGIN);
    expect(own.headers['access-control-allow-credentials']).toBe('true');
    const evil = await preflight('https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('заголовки безопасности helmet', async () => {
    const res = await ctx.app.inject({ url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('тело больше 1 МБ → 413 VALIDATION; битый JSON → 400 VALIDATION', async () => {
    const big = await ctx
      .client()
      .post('/api/sync', { cursor: 0, changes: [], pad: 'x'.repeat(1024 * 1024) });
    expect(big.statusCode).toBe(413);
    expect(errorCode(big)).toBe('VALIDATION');

    const broken = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: '{"username":',
      headers: { origin: TEST_ORIGIN, 'content-type': 'application/json' },
    });
    expect(broken.statusCode).toBe(400);
    expect(errorCode(broken)).toBe('VALIDATION');
  });

  it('неизвестный путь → 404 { error: { code: NOT_FOUND } }', async () => {
    const res = await ctx.app.inject({ url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });
});

describe('логи (15.6)', () => {
  it('JSON-логи без паролей, кодов восстановления и cookie', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(chunk.toString('utf8'));
        done();
      },
    });
    const app = await buildApp({
      config: testConfig(),
      db: ctx.database.db,
      logger: { level: 'trace', stream },
    });
    try {
      const headers = { origin: TEST_ORIGIN };
      const reg = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { username: 'logged_user', password: 'very secret pw' },
        headers,
        remoteAddress: '10.9.9.9',
      });
      expect(reg.statusCode).toBe(201);
      const code = reg.json<{ recoveryCode: string }>().recoveryCode;
      const sid = reg.cookies.find((x) => x.name === 'sid')!.value;
      await app.inject({ url: '/api/me', headers: { cookie: `sid=${sid}` } });
      await app.inject({
        method: 'POST',
        url: '/api/auth/recover',
        payload: { username: 'logged_user', recoveryCode: code, newPassword: 'another secret' },
        headers: { ...headers, cookie: `sid=${sid}` },
        remoteAddress: '10.9.9.9',
      });
      // даже если кто-то залогирует заголовки или тело целиком
      app.log.info(
        {
          req: { headers: { cookie: `sid=${sid}` } },
          body: { password: 'very secret pw', recoveryCode: code },
        },
        'probe',
      );

      const all = lines.join('');
      expect(lines.length).toBeGreaterThan(3);
      for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
      for (const secret of ['very secret pw', 'another secret', code, sid]) expect(all).not.toContain(secret);
      expect(all).toContain('probe');
    } finally {
      await app.close();
    }
  });
});
