// Сборка Fastify-приложения (раздел 14): аккаунты, синхронизация, экспорт, игровые данные, админка данных.
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import { Secrets } from './auth/secrets';
import { SessionStore } from './auth/sessions';
import type { Config } from './config';
import { pingDb, type Db } from './db';
import type { Deps } from './deps';
import { installErrorHandlers } from './errors';
import { GameFiles } from './gamedata';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { dataRoutes } from './routes/data';
import { syncRoutes } from './routes/sync';
import { createLimiters, installOriginCheck } from './security';

/** Тело запроса — до 1 МБ (14.2). */
export const BODY_LIMIT = 1024 * 1024;

/** Что не должно попасть в логи (15.6): пароли, коды восстановления, cookie. */
export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'headers.cookie',
  'headers["set-cookie"]',
  'body',
  '*.body',
  'password',
  'newPassword',
  'currentPassword',
  'recoveryCode',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.recoveryCode',
];

export interface BuildOptions {
  config: Config;
  db: Db;
  /** Переопределение логгера (тесты): уровень и поток вывода. */
  logger?: { level?: string; stream?: NodeJS.WritableStream };
}

export async function buildApp({ config, db, logger }: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: { paths: REDACT_PATHS, censor: '[скрыто]' },
      ...logger,
    },
    bodyLimit: BODY_LIMIT,
    trustProxy: config.trustProxy,
  });
  app.decorateRequest('user', null);
  installErrorHandlers(app);

  await app.register(helmet);
  await app.register(cors, {
    origin: config.allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });
  await app.register(cookie);
  installOriginCheck(app, config.allowedOrigins);
  const limiters = await createLimiters(app);

  const deps: Deps = {
    config,
    db,
    limiters,
    sessions: new SessionStore(db, config),
    secrets: new Secrets(config.argon2),
    files: new GameFiles(config.dataDir),
  };

  app.get('/api/health', async (_req, reply) => {
    const up = await pingDb(db);
    if (!up) reply.status(503);
    return { ok: up, db: up ? 'up' : 'down', version: config.version };
  });

  await authRoutes(app, deps);
  await syncRoutes(app, deps);
  await adminRoutes(app, deps);
  await dataRoutes(app, deps);

  return app;
}
