// Права админа данных (D-316): только флаг users.is_admin, который ставит оператор командой сервера.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli, setAdmin, USAGE } from './admins';
import { adminPatches, users } from './db/schema';
import { openPglite } from './db/pglite';
import { ADMIN, createTestContext, errorCode, type TestClient, type TestContext } from './test/helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

const isAdmin = async (c: TestClient) => (await c.get('/api/me')).json<{ isAdmin: boolean }>().isAdmin;
const putPatch = (c: TestClient, baseVersion: number) =>
  c.put('/api/admin/patch', { patch: { notes: ['фишинг'] }, baseVersion });
const latestVersion = async () =>
  (await ctx.database.db.select({ v: adminPatches.version }).from(adminPatches)).length;

/** Вывод CLI в массивы строк. */
function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) } };
}

describe('права админа данных не берутся из логина', () => {
  it('логин из ADMIN_USERNAMES, занятый кем угодно, прав не даёт', async () => {
    // testConfig по-прежнему передаёт ADMIN_USERNAMES=«DATA_ADMIN, someone_else» — переменная больше не читается
    for (const name of ['someone_else', 'DATA_ADMIN']) {
      const c = ctx.client();
      await c.register(name);
      expect(await isAdmin(c)).toBe(false);
      const put = await putPatch(c, 0);
      expect(put.statusCode).toBe(403);
      expect(errorCode(put)).toBe('FORBIDDEN');
    }
    expect(await latestVersion()).toBe(0);
  });

  it('выдача и снятие — сразу, без нового входа; права не переходят к новому владельцу логина', async () => {
    const owner = ctx.client();
    const { user } = await owner.register('ops_owner');
    expect(await isAdmin(owner)).toBe(false);

    expect(await setAdmin(ctx.database.db, 'OPS_OWNER', true)).toMatchObject({
      id: user.id,
      username: 'ops_owner',
      changed: true,
    });
    expect(await isAdmin(owner)).toBe(true);
    expect((await putPatch(owner, 0)).statusCode).toBe(200);

    expect(await setAdmin(ctx.database.db, 'ops_owner', false)).toMatchObject({ changed: true });
    expect(await isAdmin(owner)).toBe(false);
    expect((await putPatch(owner, 1)).statusCode).toBe(403);

    // снова админ — и удаляет аккаунт: строка users уходит вместе с флагом
    await setAdmin(ctx.database.db, 'ops_owner', true);
    expect((await owner.delete('/api/account', { password: 'correct horse' })).statusCode).toBe(200);
    const [patch] = await ctx.database.db.select().from(adminPatches).where(eq(adminPatches.version, 1));
    expect(patch!.createdBy).toBeNull();

    const squatter = ctx.client();
    const again = await squatter.register('Ops_Owner');
    expect(again.user.id).not.toBe(user.id);
    expect(await isAdmin(squatter)).toBe(false);
    expect((await putPatch(squatter, 1)).statusCode).toBe(403);
    expect(await latestVersion()).toBe(1);
  });

  it('неизвестный логин — null, база не меняется', async () => {
    expect(await setAdmin(ctx.database.db, 'nobody_here', true)).toBeNull();
    const admins = await ctx.database.db.select().from(users).where(eq(users.isAdmin, true));
    expect(admins.map((u) => u.username)).not.toContain('nobody_here');
  });
});

describe('CLI оператора: admin grant | revoke | list', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  // CLI — отдельный процесс со своим подключением: проверяем его по DATABASE_URL на PGlite в папке
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'primo-cli-'));
    const db = await openPglite(dir);
    await db.migrate(ctx.config.migrationsDir);
    await db.db.insert(users).values([
      { username: ADMIN, passwordHash: 'x', recoveryHash: 'x' },
      { username: 'second_admin', passwordHash: 'x', recoveryHash: 'x' },
      { username: 'plain_user', passwordHash: 'x', recoveryHash: 'x' },
    ]);
    await db.close();
    env = { NODE_ENV: 'production', DATABASE_URL: `pglite:${dir}` };
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const run = async (...argv: string[]) => {
    const c = capture();
    const code = await runCli(argv, env, c.io);
    return { code, out: c.out.join('\n'), err: c.err.join('\n') };
  };

  it('без аргументов и с ошибкой в команде — подсказка и код 2, база не открывается', async () => {
    const bad = { NODE_ENV: 'production' };
    for (const argv of [[], ['admin'], ['admin', 'grant'], ['admin', 'promote', 'x'], ['user', 'list']]) {
      const c = capture();
      expect(await runCli(argv, bad, c.io), argv.join(' ')).toBe(2);
      expect(c.err.join('\n')).toContain(USAGE);
    }
    const c = capture();
    expect(await runCli(['admin', 'grant', 'bad name!'], bad, c.io)).toBe(2);
    expect(c.err.join('\n')).toMatch(/логин/);
    const help = capture();
    expect(await runCli(['--help'], bad, help.io)).toBe(0);
    expect(help.out.join('\n')).toContain(USAGE);
  });

  it('без DATABASE_URL в production — ошибка настройки и код 1', async () => {
    const c = capture();
    expect(await runCli(['admin', 'list'], { NODE_ENV: 'production' }, c.io)).toBe(1);
    expect(c.err.join('\n')).toMatch(/DATABASE_URL/);
  });

  it('grant, list, revoke; повтор — без ошибки; неизвестный логин — код 1', async () => {
    expect(await run('admin', 'list')).toMatchObject({ code: 0, out: expect.stringMatching(/нет/) });

    const granted = await run('admin', 'grant', 'DATA_ADMIN');
    expect(granted.code).toBe(0);
    expect(granted.out).toMatch(/выданы.*data_admin/);
    expect(await run('admin', 'grant', 'second_admin')).toMatchObject({ code: 0 });
    expect((await run('admin', 'grant', ADMIN)).out).toMatch(/уже/);

    const listed = await run('admin', 'list');
    expect(listed.code).toBe(0);
    expect(listed.out).toMatch(/data_admin/);
    expect(listed.out).toMatch(/second_admin/);
    expect(listed.out).not.toMatch(/plain_user/);

    expect(await run('admin', 'revoke', 'second_admin')).toMatchObject({
      code: 0,
      out: expect.stringMatching(/сняты.*second_admin/),
    });
    expect((await run('admin', 'revoke', 'second_admin')).out).toMatch(/не админ/);
    expect((await run('admin', 'list')).out).not.toMatch(/second_admin/);

    const missing = await run('admin', 'grant', 'ghost_user');
    expect(missing.code).toBe(1);
    expect(missing.err).toMatch(/ghost_user.*не найден/);

    const db = await openPglite(dir);
    try {
      const rows = await db.db.select().from(users).where(eq(users.isAdmin, true));
      expect(rows.map((u) => u.username)).toEqual([ADMIN]);
    } finally {
      await db.close();
    }
  });
});
