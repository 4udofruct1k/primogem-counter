// Сессии в БД и cookie `sid` (14.2): HttpOnly, Secure, SameSite=Lax, 30 дней, продление при активности.
import { and, eq, lt, ne } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config';
import type { Db } from '../db';
import { sessions, users } from '../db/schema';
import { authRequired } from '../errors';
import { newSessionToken, sessionIdOf } from './secrets';

export const SESSION_COOKIE = 'sid';
const DAY_MS = 86_400_000;
const USER_AGENT_MAX = 300;

export interface AuthUser {
  id: string;
  username: string;
  createdAt: Date;
  /** Админ данных: флаг `users.is_admin` (D-316), читается при каждом запросе — снятие действует сразу. */
  isAdmin: boolean;
  /** Id текущей сессии (SHA-256 токена). */
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Пользователь сессии; заполняет `authenticate`. */
    user: AuthUser | null;
  }
}

export class SessionStore {
  readonly ttlMs: number;

  constructor(
    private readonly db: Db,
    private readonly config: Pick<Config, 'sessionTtlDays' | 'cookieSecure'>,
  ) {
    this.ttlMs = config.sessionTtlDays * DAY_MS;
  }

  /** Новая сессия + cookie. Заодно убирает истёкшие сессии этого пользователя. */
  async start(reply: FastifyReply, req: FastifyRequest, userId: string): Promise<void> {
    const token = newSessionToken();
    const now = Date.now();
    await this.db
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date(now))));
    await this.db.insert(sessions).values({
      id: sessionIdOf(token),
      userId,
      expiresAt: new Date(now + this.ttlMs),
      userAgent: req.headers['user-agent']?.slice(0, USER_AGENT_MAX) ?? null,
    });
    this.setCookie(reply, token);
  }

  /**
   * preHandler для защищённых маршрутов: сессия по cookie → `req.user`, иначе 401 AUTH_REQUIRED.
   * Скользящий срок: когда осталось меньше половины, срок и cookie продлеваются на полный TTL.
   */
  authenticate = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) throw authRequired();
    const id = sessionIdOf(token);
    const [row] = await this.db
      .select({
        expiresAt: sessions.expiresAt,
        userId: users.id,
        username: users.username,
        createdAt: users.createdAt,
        isAdmin: users.isAdmin,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, id))
      .limit(1);
    const now = Date.now();
    if (!row || row.expiresAt.getTime() <= now) {
      if (row) await this.db.delete(sessions).where(eq(sessions.id, id));
      this.clearCookie(reply);
      throw authRequired();
    }
    if (row.expiresAt.getTime() - now < this.ttlMs / 2) {
      await this.db
        .update(sessions)
        .set({ expiresAt: new Date(now + this.ttlMs) })
        .where(eq(sessions.id, id));
      this.setCookie(reply, token);
    }
    req.user = {
      id: row.userId,
      username: row.username,
      createdAt: row.createdAt,
      isAdmin: row.isAdmin,
      sessionId: id,
    };
  };

  /** Выход: сессия из cookie удаляется, если есть. */
  async endCurrent(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await this.db.delete(sessions).where(eq(sessions.id, sessionIdOf(token)));
    this.clearCookie(reply);
  }

  /** Все сессии пользователя, кроме `keepSessionId`, если задан. */
  async endAll(userId: string, keepSessionId?: string): Promise<void> {
    const where = keepSessionId
      ? and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId))
      : eq(sessions.userId, userId);
    await this.db.delete(sessions).where(where);
  }

  setCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(SESSION_COOKIE, token, {
      ...this.cookieOptions(),
      maxAge: Math.floor(this.ttlMs / 1000),
    });
  }

  clearCookie(reply: FastifyReply): void {
    reply.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  private cookieOptions() {
    return { path: '/', httpOnly: true, secure: this.config.cookieSecure, sameSite: 'lax' as const };
  }
}

/** Пользователь защищённого маршрута (после `authenticate`). */
export function userOf(req: FastifyRequest): AuthUser {
  if (!req.user) throw authRequired();
  return req.user;
}
