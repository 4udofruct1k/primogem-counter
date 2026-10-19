// Защита (14.2): проверка Origin на изменяющих запросах и лимиты попыток (@fastify/rate-limit).
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { forbidden, rateLimited } from './errors';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** CSRF: изменяющий запрос без Origin или с чужим Origin → 403 FORBIDDEN. */
export function installOriginCheck(app: FastifyInstance, allowedOrigins: readonly string[]): void {
  const allowed = new Set(allowedOrigins);
  app.addHook('onRequest', async (req) => {
    if (!MUTATING.has(req.method)) return;
    const origin = req.headers.origin;
    if (!origin || !allowed.has(origin)) throw forbidden('Запрос с чужого сайта отклонён (заголовок Origin)');
  });
}

/** Лимиты попыток по 14.2 (D-304). */
export const LIMITS = {
  /** Вход, восстановление и всё, что проверяет пароль: на IP. */
  credentialsPerIp: { max: 5, timeWindow: 60_000 },
  /** То же на логин — с любых IP. */
  credentialsPerAccount: { max: 10, timeWindow: 3_600_000 },
  /** Регистрация: на IP. */
  registerPerIp: { max: 10, timeWindow: 3_600_000 },
} as const;

export interface Limiters {
  /** Вход, восстановление, смена пароля, новый код, удаление аккаунта. */
  credentials: preHandlerAsyncHookHandler;
  register: preHandlerAsyncHookHandler;
}

/** Логин для лимита: пользователь сессии или `username` из тела запроса (до проверки схемой). */
function accountKey(req: FastifyRequest): string {
  if (req.user) return `user:${req.user.username}`;
  const username = (req.body as { username?: unknown } | null | undefined)?.username;
  return typeof username === 'string' ? `user:${username.trim().toLowerCase()}` : `ip:${req.ip}`;
}

export async function createLimiters(app: FastifyInstance): Promise<Limiters> {
  // глобального лимита нет: только явные на маршрутах
  await app.register(rateLimit, { global: false });

  type Check = ReturnType<FastifyInstance['createRateLimit']>;
  const ipCredentials = app.createRateLimit({ ...LIMITS.credentialsPerIp });
  const accountCredentials = app.createRateLimit({
    ...LIMITS.credentialsPerAccount,
    keyGenerator: accountKey,
  });
  const ipRegister = app.createRateLimit({ ...LIMITS.registerPerIp });

  // Каждый лимитер — свой счётчик; первый превышенный отвечает 429 и следующие не трогает.
  const chain =
    (...checks: Check[]): preHandlerAsyncHookHandler =>
    async (req, reply) => {
      for (const check of checks) {
        const r = await check(req);
        if (!r.isAllowed && r.isExceeded) {
          reply.header('retry-after', r.ttlInSeconds);
          throw rateLimited(r.ttlInSeconds);
        }
      }
    };

  return { credentials: chain(ipCredentials, accountCredentials), register: chain(ipRegister) };
}
