// Настройки сервера из переменных окружения (15.2). Секреты — только из окружения, в коде их нет.
import path from 'node:path';

/** Параметры argon2id (14.2). */
export interface Argon2Params {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

/** argon2id по спеке: m = 64 MiB, t = 3, p = 1. Через окружение не меняется. */
export const ARGON2_PARAMS: Argon2Params = { memoryCost: 64 * 1024, timeCost: 3, parallelism: 1 };

/** Postgres из deploy/compose.dev.yml — только для разработки; в production DATABASE_URL обязателен. */
export const DEV_DATABASE_URL = 'postgres://primo:primo@localhost:5432/primo';
/** Vite dev-сервер (15.7): его Origin разрешён вне production. */
export const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

export interface Config {
  port: number;
  host: string;
  nodeEnv: string;
  production: boolean;
  /** Папка с data/*.json (датапак и seed регионов). */
  dataDir: string;
  /** Папка SQL-миграций drizzle-kit. */
  migrationsDir: string;
  version: string;
  databaseUrl: string;
  sessionTtlDays: number;
  /** Разрешённые значения заголовка Origin для изменяющих запросов и CORS. */
  allowedOrigins: string[];
  /** Логины админов данных, в нижнем регистре. */
  adminUsernames: string[];
  cookieSecure: boolean;
  /** Fastify `trustProxy`: адреса доверенных прокси перед api (Caddy в docker-сети), true или false. */
  trustProxy: string | boolean;
  logLevel: string;
  argon2: Argon2Params;
  /** Сколько изменений отдаёт один ответ /api/sync, остальное — `more: true` (D-306). */
  syncPullLimit: number;
}

export class ConfigError extends Error {}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new ConfigError(`${name}: ожидается целое ${min}…${max}, получено «${raw}»`);
  return n;
}

function bool(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new ConfigError(`${name}: ожидается true или false, получено «${env[name]}»`);
}

function list(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** Origin без пути и слэша на конце: `https://primo.example.ru`. */
function origin(raw: string, name: string): string {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocol');
    return u.origin;
  } catch {
    throw new ConfigError(`${name}: некорректный адрес «${raw}»`);
  }
}

/** Caddy стоит в той же docker-сети: доверяем X-Forwarded-For только от loopback и частных адресов (D-304). */
export const DEFAULT_TRUST_PROXY = 'loopback,uniquelocal';

function trustProxy(raw: string | undefined): string | boolean {
  const v = raw?.trim();
  if (v === undefined || v === '') return DEFAULT_TRUST_PROXY;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const production = nodeEnv === 'production';

  const databaseUrl = env.DATABASE_URL ?? (production ? '' : DEV_DATABASE_URL);
  if (!databaseUrl) throw new ConfigError('DATABASE_URL не задан (обязателен при NODE_ENV=production)');

  const origins = list(env.PUBLIC_ORIGIN).map((o) => origin(o, 'PUBLIC_ORIGIN'));
  if (env.DOMAIN) origins.push(origin(`https://${env.DOMAIN.trim()}`, 'DOMAIN'));
  if (!production) origins.push(...DEV_ORIGINS);
  if (origins.length === 0)
    throw new ConfigError('Нужен PUBLIC_ORIGIN или DOMAIN: без них сервер отклонит любые изменения (CSRF)');

  // import.meta.dirname — src/ при tsx и dist/ после сборки: оба на уровень ниже apps/api
  return {
    port: int(env, 'PORT', 3000, 1, 65535),
    host: env.HOST ?? '0.0.0.0',
    nodeEnv,
    production,
    dataDir: path.resolve(env.DATA_DIR ?? path.join(import.meta.dirname, '../../../data')),
    migrationsDir: path.resolve(env.MIGRATIONS_DIR ?? path.join(import.meta.dirname, '../drizzle')),
    version: env.APP_VERSION ?? '0.0.0',
    databaseUrl,
    sessionTtlDays: int(env, 'SESSION_TTL_DAYS', 30, 1, 365),
    allowedOrigins: [...new Set(origins)],
    adminUsernames: list(env.ADMIN_USERNAMES).map((u) => u.toLowerCase()),
    cookieSecure: bool(env, 'COOKIE_SECURE', production),
    trustProxy: trustProxy(env.TRUST_PROXY),
    logLevel: env.LOG_LEVEL ?? 'info',
    argon2: ARGON2_PARAMS,
    syncPullLimit: 1000,
  };
}
