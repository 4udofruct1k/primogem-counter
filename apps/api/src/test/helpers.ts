// Тестовое окружение API: PGlite в памяти с миграциями, приложение и «браузер» с cookie (D-301).
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp, type BuildOptions } from '../app';
import { loadConfig, type Config } from '../config';
import { openPglite, type PgliteDatabase } from '../db/pglite';

export const TEST_ORIGIN = 'https://primo.test';
export const ADMIN = 'data_admin';
/** Облегчённый argon2id только для тестов; прод — ARGON2_PARAMS (14.2). */
export const FAST_ARGON2 = { memoryCost: 1024, timeCost: 1, parallelism: 1 };

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig({
      NODE_ENV: 'test',
      PUBLIC_ORIGIN: TEST_ORIGIN,
      // устаревшая переменная: прав не даёт (D-316), тесты проверяют, что она не читается
      ADMIN_USERNAMES: `${ADMIN.toUpperCase()}, someone_else`,
      APP_VERSION: 'test',
      COOKIE_SECURE: 'true',
    }),
    argon2: FAST_ARGON2,
    logLevel: 'silent',
    ...overrides,
  };
}

export interface TestContext {
  app: FastifyInstance;
  database: PgliteDatabase;
  config: Config;
  /** Новый «браузер» со своим IP и банкой cookie. */
  client(ip?: string): TestClient;
  close(): Promise<void>;
}

export async function createTestContext(
  overrides: Partial<Config> = {},
  options: Omit<BuildOptions, 'config' | 'db'> = {},
): Promise<TestContext> {
  const config = testConfig(overrides);
  const database = await openPglite();
  await database.migrate(config.migrationsDir);
  const app = await buildApp({ config, db: database.db, ...options });
  return {
    app,
    database,
    config,
    client: (ip) => new TestClient(app, ip ?? nextIp()),
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}

let ipCounter = 0;
/** Уникальный адрес для каждого клиента — лимиты попыток считаются по IP (14.2). */
export function nextIp(): string {
  ipCounter++;
  return `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Клиент поверх `app.inject`: Origin своего сайта, cookie `sid` между запросами. */
export class TestClient {
  sid: string | null = null;

  constructor(
    readonly app: FastifyInstance,
    readonly ip: string,
  ) {}

  async request(
    method: Method,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> {
    const opts: InjectOptions = {
      method,
      url,
      remoteAddress: this.ip,
      headers: { origin: TEST_ORIGIN, ...(this.sid ? { cookie: `sid=${this.sid}` } : {}), ...headers },
    };
    if (body !== undefined) opts.payload = body as InjectOptions['payload'];
    const res = await this.app.inject(opts);
    const set = res.cookies.find((c) => c.name === 'sid');
    if (set) this.sid = set.value === '' ? null : set.value;
    return res;
  }

  get = (url: string) => this.request('GET', url);
  post = (url: string, body: unknown = {}) => this.request('POST', url, body);
  put = (url: string, body: unknown) => this.request('PUT', url, body);
  delete = (url: string, body: unknown = {}) => this.request('DELETE', url, body);

  async register(username: string, password = 'correct horse'): Promise<RegisterResult> {
    const res = await this.post('/api/auth/register', { username, password });
    if (res.statusCode !== 201) throw new Error(`register ${username}: ${res.statusCode} ${res.body}`);
    return res.json<RegisterResult>();
  }

  async login(username: string, password = 'correct horse'): Promise<LightMyRequestResponse> {
    return this.post('/api/auth/login', { username, password });
  }
}

export interface RegisterResult {
  user: { id: string; username: string; createdAt: string };
  recoveryCode: string;
}

/** Ответ-ошибка API: `{ error: { code, message } }`. */
export function errorCode(res: LightMyRequestResponse): string | undefined {
  return res.json<{ error?: { code?: string } }>().error?.code;
}
