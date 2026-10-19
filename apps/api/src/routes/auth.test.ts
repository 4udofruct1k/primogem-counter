import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessions, userDocs, users } from '../db/schema';
import { createTestContext, errorCode, nextIp, type TestContext } from '../test/helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('TC-45: регистрация → выход → вход', () => {
  it('сессия выдана; код восстановления показан один раз; тот же логин в любом регистре → 409', async () => {
    const c = ctx.client();
    const res = await c.post('/api/auth/register', { username: 'Lumine_45', password: 'correct horse' });
    expect(res.statusCode).toBe(201);
    const body = res.json<{
      user: { id: string; username: string; createdAt: string };
      recoveryCode: string;
    }>();
    expect(body.user.username).toBe('lumine_45');
    expect(body.user.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(body.recoveryCode).toMatch(/^[A-Z0-9]{16}$/);

    // cookie сессии по 14.2
    const cookie = res.cookies.find((x) => x.name === 'sid');
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    expect(cookie?.maxAge).toBe(30 * 86400);
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/); // 256 бит, base64url

    const me = await c.get('/api/me');
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({
      id: body.user.id,
      username: 'lumine_45',
      createdAt: body.user.createdAt,
      isAdmin: false,
    });

    // код хранится только как argon2id-хэш и больше нигде не отдаётся
    const [row] = await ctx.database.db.select().from(users).where(eq(users.id, body.user.id));
    expect(row!.recoveryHash).toMatch(/^\$argon2id\$/);
    expect(row!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(row)).not.toContain(body.recoveryCode);
    expect(me.body).not.toContain(body.recoveryCode);

    const out = await c.post('/api/auth/logout');
    expect(out.statusCode).toBe(200);
    expect(out.json()).toEqual({ ok: true });
    expect(c.sid).toBeNull();
    const after = await c.get('/api/me');
    expect(after.statusCode).toBe(401);
    expect(errorCode(after)).toBe('AUTH_REQUIRED');

    const login = await c.login('LUMINE_45');
    expect(login.statusCode).toBe(200);
    expect(login.json()).toEqual({ ok: true });
    expect(login.body).not.toContain(body.recoveryCode);
    expect((await c.get('/api/me')).json()).toMatchObject({ username: 'lumine_45' });

    for (const username of ['lumine_45', 'LUMINE_45', 'lUmInE_45']) {
      const dup = await ctx.client().post('/api/auth/register', { username, password: 'another pass' });
      expect(dup.statusCode).toBe(409);
      expect(errorCode(dup)).toBe('CONFLICT');
    }
  });

  it('неверный пароль и неизвестный логин → 401 BAD_CREDENTIALS', async () => {
    const c = ctx.client();
    await c.register('aether_45');
    const wrong = await ctx.client().login('aether_45', 'wrong password');
    expect(wrong.statusCode).toBe(401);
    expect(errorCode(wrong)).toBe('BAD_CREDENTIALS');
    expect(wrong.cookies.find((x) => x.name === 'sid')).toBeUndefined();
    const unknown = await ctx.client().login('nobody_here', 'whatever1');
    expect(unknown.statusCode).toBe(401);
    expect(errorCode(unknown)).toBe('BAD_CREDENTIALS');
  });

  it('вход валидируется zod: логин 3–32 [a-z0-9_], пароль от 8 символов → 400 VALIDATION', async () => {
    const c = ctx.client();
    for (const body of [
      { username: 'ab', password: 'correct horse' },
      { username: 'паймон', password: 'correct horse' },
      { username: 'paimon_ok', password: 'short' },
      { username: 'paimon_ok' },
      ['not an object'],
    ]) {
      const res = await c.post('/api/auth/register', body);
      expect(res.statusCode).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION');
      expect(res.json<{ error: { message: string } }>().error.message).not.toBe('');
    }
  });
});

describe('сессии', () => {
  it('в БД хранится SHA-256 токена, а не сам токен; user_agent записан', async () => {
    const c = ctx.client();
    const { user } = await c.register('session_hash');
    const rows = await ctx.database.db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(sha256(c.sid!));
    expect(rows[0]!.id).not.toBe(c.sid);
    expect(rows[0]!.userAgent).toBe('lightMyRequest');
  });

  it('подделанная cookie → 401 AUTH_REQUIRED', async () => {
    const c = ctx.client();
    c.sid = 'A'.repeat(43);
    const res = await c.get('/api/me');
    expect(res.statusCode).toBe(401);
    expect(errorCode(res)).toBe('AUTH_REQUIRED');
  });

  it('скользящее продление: осталось меньше половины срока → срок снова 30 дней и новая cookie', async () => {
    const c = ctx.client();
    const { user } = await c.register('sliding_user');
    const db = ctx.database.db;

    // больше половины срока — без продления
    const fresh = await c.get('/api/me');
    expect(fresh.cookies.find((x) => x.name === 'sid')).toBeUndefined();

    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + 86400_000) })
      .where(eq(sessions.userId, user.id));
    const res = await c.get('/api/me');
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((x) => x.name === 'sid');
    expect(cookie?.maxAge).toBe(30 * 86400);
    const [row] = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86400_000);
  });

  it('истёкшая сессия → 401 и удаляется', async () => {
    const c = ctx.client();
    const { user } = await c.register('expired_user');
    await ctx.database.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, user.id));
    const res = await c.get('/api/me');
    expect(res.statusCode).toBe(401);
    expect(errorCode(res)).toBe('AUTH_REQUIRED');
    expect(await ctx.database.db.select().from(sessions).where(eq(sessions.userId, user.id))).toHaveLength(0);
  });

  it('«Выйти на всех устройствах» удаляет все сессии пользователя', async () => {
    const phone = ctx.client();
    const { user } = await phone.register('many_devices');
    const laptop = ctx.client();
    expect((await laptop.login('many_devices')).statusCode).toBe(200);
    const other = ctx.client();
    await other.register('other_person');

    const res = await phone.post('/api/auth/logout-all');
    expect(res.json()).toEqual({ ok: true });
    expect((await laptop.get('/api/me')).statusCode).toBe(401);
    expect((await phone.get('/api/me')).statusCode).toBe(401);
    expect((await other.get('/api/me')).statusCode).toBe(200);
    expect(await ctx.database.db.select().from(sessions).where(eq(sessions.userId, user.id))).toHaveLength(0);
  });
});

describe('восстановление и пароль (14.2)', () => {
  it('recover: новый пароль и новый код, все сессии закрыты, старый код больше не подходит', async () => {
    const c = ctx.client();
    const { recoveryCode } = await c.register('forgetful');
    const formatted = `${recoveryCode.slice(0, 4).toLowerCase()}-${recoveryCode.slice(4, 8)} ${recoveryCode.slice(8)}`;

    const res = await ctx.client().post('/api/auth/recover', {
      username: 'Forgetful',
      recoveryCode: formatted,
      newPassword: 'brand new pass',
    });
    expect(res.statusCode).toBe(200);
    const next = res.json<{ recoveryCode: string }>().recoveryCode;
    expect(next).toMatch(/^[A-Z0-9]{16}$/);
    expect(next).not.toBe(recoveryCode);

    expect((await c.get('/api/me')).statusCode).toBe(401);
    expect((await ctx.client().login('forgetful')).statusCode).toBe(401);
    expect((await ctx.client().login('forgetful', 'brand new pass')).statusCode).toBe(200);

    const reuse = await ctx.client().post('/api/auth/recover', {
      username: 'forgetful',
      recoveryCode,
      newPassword: 'hacker pass 1',
    });
    expect(reuse.statusCode).toBe(401);
    expect(errorCode(reuse)).toBe('BAD_CREDENTIALS');
  });

  it('смена пароля: нужен текущий; остальные сессии закрываются, текущая остаётся', async () => {
    const c = ctx.client();
    await c.register('changer');
    const other = ctx.client();
    await other.login('changer');

    const wrong = await c.post('/api/auth/password', {
      currentPassword: 'nope nope',
      newPassword: 'new password 1',
    });
    expect(wrong.statusCode).toBe(401);
    expect(errorCode(wrong)).toBe('BAD_CREDENTIALS');

    const ok = await c.post('/api/auth/password', {
      currentPassword: 'correct horse',
      newPassword: 'new password 1',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true });
    expect((await c.get('/api/me')).statusCode).toBe(200);
    expect((await other.get('/api/me')).statusCode).toBe(401);
    expect((await ctx.client().login('changer', 'new password 1')).statusCode).toBe(200);
    expect((await ctx.client().login('changer')).statusCode).toBe(401);
  });

  it('новый код восстановления по паролю; старый код перестаёт работать', async () => {
    const c = ctx.client();
    const { recoveryCode } = await c.register('new_code');
    const bad = await c.post('/api/auth/recovery-code', { password: 'wrong pass' });
    expect(bad.statusCode).toBe(401);
    const res = await c.post('/api/auth/recovery-code', { password: 'correct horse' });
    expect(res.statusCode).toBe(200);
    const fresh = res.json<{ recoveryCode: string }>().recoveryCode;
    expect(fresh).toMatch(/^[A-Z0-9]{16}$/);
    expect(fresh).not.toBe(recoveryCode);

    const old = await ctx
      .client()
      .post('/api/auth/recover', { username: 'new_code', recoveryCode, newPassword: 'x'.repeat(8) });
    expect(old.statusCode).toBe(401);
    const good = await ctx
      .client()
      .post('/api/auth/recover', { username: 'new_code', recoveryCode: fresh, newPassword: 'y'.repeat(8) });
    expect(good.statusCode).toBe(200);
  });

  it('без сессии: смена пароля, новый код, logout-all → 401 AUTH_REQUIRED', async () => {
    const anon = ctx.client();
    for (const [url, body] of [
      ['/api/auth/password', { currentPassword: 'a', newPassword: 'b'.repeat(8) }],
      ['/api/auth/recovery-code', { password: 'a' }],
      ['/api/auth/logout-all', {}],
    ] as const) {
      const res = await anon.post(url, body);
      expect(res.statusCode).toBe(401);
      expect(errorCode(res)).toBe('AUTH_REQUIRED');
    }
    // выход без сессии — не ошибка
    expect((await anon.post('/api/auth/logout')).statusCode).toBe(200);
  });
});

describe('TC-49: лимит попыток входа и восстановления', () => {
  it('6 неверных входов за минуту с одного IP → шестой 429 RATE_LIMIT', async () => {
    await ctx.client().register('victim_49');
    const attacker = ctx.client();
    for (let i = 1; i <= 5; i++) {
      const res = await attacker.login('victim_49', `wrong pass ${i}`);
      expect(res.statusCode).toBe(401);
    }
    const sixth = await attacker.login('victim_49', 'wrong pass 6');
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json()).toMatchObject({ error: { code: 'RATE_LIMIT' } });
    expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(0);
    // даже верный пароль с этого IP — подождать
    expect((await attacker.login('victim_49')).statusCode).toBe(429);
    // другой IP не задет
    expect((await ctx.client().login('victim_49')).statusCode).toBe(200);
  });

  it('10 попыток в час на логин — с любых IP', async () => {
    await ctx.client().register('victim_hour');
    for (let i = 1; i <= 10; i++) {
      expect((await ctx.client().login('VICTIM_HOUR', 'wrong pass')).statusCode).toBe(401);
    }
    const res = await ctx.client().login('victim_hour', 'correct horse');
    expect(res.statusCode).toBe(429);
    expect(errorCode(res)).toBe('RATE_LIMIT');
    // другой логин с тех же условий входит
    await ctx.client().register('bystander');
    expect((await ctx.client().login('bystander')).statusCode).toBe(200);
  });

  it('восстановление ограничено так же: 5 в минуту на IP', async () => {
    const ip = nextIp();
    for (let i = 1; i <= 5; i++) {
      const res = await ctx.client(ip).post('/api/auth/recover', {
        username: `guess_${i}`,
        recoveryCode: 'AAAAAAAAAAAAAAAA',
        newPassword: 'p'.repeat(8),
      });
      expect(res.statusCode).toBe(401);
    }
    const res = await ctx.client(ip).post('/api/auth/recover', {
      username: 'guess_6',
      recoveryCode: 'AAAAAAAAAAAAAAAA',
      newPassword: 'p'.repeat(8),
    });
    expect(res.statusCode).toBe(429);
    expect(errorCode(res)).toBe('RATE_LIMIT');
  });
});

describe('TC-50: удаление аккаунта', () => {
  async function seedDocs(c: ReturnType<TestContext['client']>) {
    const res = await c.post('/api/sync', {
      cursor: 0,
      changes: [
        {
          collection: 'occ_status',
          id: 'daily_commissions:2026-10-19',
          data: { id: 'daily_commissions:2026-10-19', status: 'claimed' },
          baseVersion: 0,
        },
        {
          collection: 'region_state',
          id: 'mondstadt',
          data: { regionId: 'mondstadt', closed: true },
          baseVersion: 0,
        },
      ],
    });
    expect(res.json<{ applied: unknown[] }>().applied).toHaveLength(2);
  }

  it('неверный пароль → 401, ничего не удалено', async () => {
    const c = ctx.client();
    const { user } = await c.register('keeper_50');
    await seedDocs(c);
    const res = await c.delete('/api/account', { password: 'wrong password' });
    expect(res.statusCode).toBe(401);
    expect(errorCode(res)).toBe('BAD_CREDENTIALS');
    expect(await ctx.database.db.select().from(users).where(eq(users.id, user.id))).toHaveLength(1);
    expect((await c.get('/api/me')).statusCode).toBe(200);
  });

  it('верный пароль → пользователь, сессии и документы удалены; старая cookie → 401', async () => {
    const c = ctx.client();
    const { user } = await c.register('leaver_50');
    await seedDocs(c);
    const second = ctx.client();
    await second.login('leaver_50');
    const neighbour = ctx.client();
    await neighbour.register('neighbour_50');
    await seedDocs(neighbour);
    const oldSid = c.sid;

    const res = await c.delete('/api/account', { password: 'correct horse' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const db = ctx.database.db;
    expect(await db.select().from(users).where(eq(users.id, user.id))).toHaveLength(0);
    expect(await db.select().from(sessions).where(eq(sessions.userId, user.id))).toHaveLength(0);
    expect(await db.select().from(userDocs).where(eq(userDocs.userId, user.id))).toHaveLength(0);

    c.sid = oldSid;
    for (const client of [c, second]) {
      const me = await client.get('/api/me');
      expect(me.statusCode).toBe(401);
      expect(errorCode(me)).toBe('AUTH_REQUIRED');
    }
    // соседа не задело
    expect((await neighbour.get('/api/export')).json<{ docs: unknown[] }>().docs).toHaveLength(2);
    // логин свободен снова
    expect(
      (await ctx.client().post('/api/auth/register', { username: 'leaver_50', password: 'x'.repeat(8) }))
        .statusCode,
    ).toBe(201);
  });
});
