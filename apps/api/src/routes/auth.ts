// Аккаунты (14.2, 14.4): регистрация, вход и выход, восстановление, пароль, профиль, удаление.
import {
  ChangePasswordBodySchema,
  DeleteAccountBodySchema,
  LoginBodySchema,
  NewRecoveryCodeBodySchema,
  RecoverBodySchema,
  RegisterBodySchema,
} from '@primo/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { newRecoveryCode } from '../auth/secrets';
import { userOf } from '../auth/sessions';
import { users } from '../db/schema';
import type { Deps } from '../deps';
import { badCredentials, conflict, parse } from '../errors';

const OK = { ok: true } as const;

export async function authRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, sessions, secrets, limiters } = deps;
  const authed = { preHandler: [sessions.authenticate, limiters.credentials] };

  const findUser = async (username: string) =>
    (await db.select().from(users).where(eq(users.username, username)).limit(1))[0];

  /** Пароль текущего пользователя; неверный — 401 BAD_CREDENTIALS. */
  const checkPassword = async (userId: string, password: string) => {
    const [row] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId));
    if (!(await secrets.verify(row?.hash, password))) throw badCredentials('Неверный пароль');
  };

  app.post('/api/auth/register', { preHandler: limiters.register }, async (req, reply) => {
    const body = parse(RegisterBodySchema, req.body);
    if (await findUser(body.username)) throw conflict('Такой логин уже занят');
    const recoveryCode = newRecoveryCode();
    const [passwordHash, recoveryHash] = await Promise.all([
      secrets.hash(body.password),
      secrets.hash(recoveryCode),
    ]);
    // citext unique: гонка двух регистраций одного логина тоже даёт 409
    const [user] = await db
      .insert(users)
      .values({ username: body.username, passwordHash, recoveryHash })
      .onConflictDoNothing()
      .returning();
    if (!user) throw conflict('Такой логин уже занят');
    await sessions.start(reply, req, user.id);
    reply.status(201);
    return {
      user: { id: user.id, username: user.username, createdAt: user.createdAt.toISOString() },
      recoveryCode,
    };
  });

  app.post('/api/auth/login', { preHandler: limiters.credentials }, async (req, reply) => {
    const body = parse(LoginBodySchema, req.body);
    const user = await findUser(body.username);
    if (!(await secrets.verify(user?.passwordHash, body.password)) || !user) throw badCredentials();
    await sessions.start(reply, req, user.id);
    return OK;
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await sessions.endCurrent(req, reply);
    return OK;
  });

  app.post('/api/auth/logout-all', { preHandler: sessions.authenticate }, async (req, reply) => {
    await sessions.endAll(userOf(req).id);
    sessions.clearCookie(reply);
    return OK;
  });

  // Сброс пароля по коду: новый код взамен использованного, все сессии закрываются.
  app.post('/api/auth/recover', { preHandler: limiters.credentials }, async (req, reply) => {
    const body = parse(RecoverBodySchema, req.body);
    const user = await findUser(body.username);
    if (!(await secrets.verify(user?.recoveryHash, body.recoveryCode)) || !user) {
      throw badCredentials('Неверный логин или код восстановления');
    }
    const recoveryCode = newRecoveryCode();
    const [passwordHash, recoveryHash] = await Promise.all([
      secrets.hash(body.newPassword),
      secrets.hash(recoveryCode),
    ]);
    await db
      .update(users)
      .set({ passwordHash, recoveryHash, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await sessions.endAll(user.id);
    sessions.clearCookie(reply);
    return { recoveryCode };
  });

  // Смена пароля: остальные устройства выходят, текущая сессия остаётся (D-307).
  app.post('/api/auth/password', authed, async (req) => {
    const body = parse(ChangePasswordBodySchema, req.body);
    const user = userOf(req);
    await checkPassword(user.id, body.currentPassword);
    const passwordHash = await secrets.hash(body.newPassword);
    await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id));
    await sessions.endAll(user.id, user.sessionId);
    return OK;
  });

  app.post('/api/auth/recovery-code', authed, async (req) => {
    const body = parse(NewRecoveryCodeBodySchema, req.body);
    const user = userOf(req);
    await checkPassword(user.id, body.password);
    const recoveryCode = newRecoveryCode();
    const recoveryHash = await secrets.hash(recoveryCode);
    await db.update(users).set({ recoveryHash, updatedAt: new Date() }).where(eq(users.id, user.id));
    return { recoveryCode };
  });

  app.get('/api/me', { preHandler: sessions.authenticate }, async (req) => {
    const user = userOf(req);
    return {
      id: user.id,
      username: user.username,
      createdAt: user.createdAt.toISOString(),
      isAdmin: user.isAdmin,
    };
  });

  // Удаление аккаунта: каскадом уходят сессии и документы (14.3).
  app.delete('/api/account', authed, async (req, reply) => {
    const body = parse(DeleteAccountBodySchema, req.body);
    const user = userOf(req);
    await checkPassword(user.id, body.password);
    await db.delete(users).where(eq(users.id, user.id));
    sessions.clearCookie(reply);
    return OK;
  });
}
