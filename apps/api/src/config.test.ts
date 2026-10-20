import { DOC_MAX_BYTES } from '@primo/shared';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARGON2_PARAMS, ConfigError, configWarnings, DEV_DATABASE_URL, loadConfig } from './config';

const PROD = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://primo:secret@db:5432/primo',
  DOMAIN: 'primo.example.ru',
};

describe('config', () => {
  it('production: argon2id по спеке, Secure-cookie, Origin только свой домен, 30 дней', () => {
    const c = loadConfig(PROD);
    expect(c.production).toBe(true);
    expect(c.argon2).toEqual({ memoryCost: 65536, timeCost: 3, parallelism: 1 });
    expect(ARGON2_PARAMS.memoryCost * 1024).toBe(64 * 1024 * 1024);
    expect(c.cookieSecure).toBe(true);
    expect(c.allowedOrigins).toEqual(['https://primo.example.ru']);
    expect(c.sessionTtlDays).toBe(30);
    expect(c.databaseUrl).toBe(PROD.DATABASE_URL);
    expect(c.migrationsDir).toBe(path.resolve(import.meta.dirname, '../drizzle'));
    expect(c.dataDir).toBe(path.resolve(import.meta.dirname, '../../../data'));
    expect(c.syncPullLimit).toBe(1000);
    expect(c.trustProxy).toBe('loopback,uniquelocal');
  });

  it('лимиты синхронизации и квоты аккаунта (D-312–D-314)', () => {
    const c = loadConfig(PROD);
    expect(c.docMaxBytes).toBe(DOC_MAX_BYTES);
    expect(c.syncPullMaxBytes).toBe(1024 * 1024);
    expect(c.userMaxDocs).toBe(200_000);
    expect(c.userMaxBytes).toBe(32 * 1024 * 1024);
    expect(c.syncWritesPerMinute).toBe(60);
    expect(c.syncLockTimeoutMs).toBe(5000);
    expect(c.syncStatementTimeoutMs).toBe(15_000);

    const custom = loadConfig({ ...PROD, USER_MAX_DOCS: '500000', USER_MAX_MB: '128' });
    expect(custom.userMaxDocs).toBe(500_000);
    expect(custom.userMaxBytes).toBe(128 * 1024 * 1024);
    expect(() => loadConfig({ ...PROD, USER_MAX_DOCS: '0' })).toThrow(/USER_MAX_DOCS/);
    expect(() => loadConfig({ ...PROD, USER_MAX_MB: '1.5' })).toThrow(/USER_MAX_MB/);
  });

  it('production без DATABASE_URL или без домена — ошибка при старте', () => {
    expect(() => loadConfig({ ...PROD, DATABASE_URL: undefined })).toThrow(ConfigError);
    expect(() => loadConfig({ ...PROD, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...PROD, DOMAIN: undefined })).toThrow(/PUBLIC_ORIGIN или DOMAIN/);
  });

  it('разработка: локальный Postgres из compose.dev.yml, Origin Vite, cookie без Secure', () => {
    const c = loadConfig({});
    expect(c.production).toBe(false);
    expect(c.databaseUrl).toBe(DEV_DATABASE_URL);
    expect(c.allowedOrigins).toContain('http://localhost:5173');
    expect(c.cookieSecure).toBe(false);
  });

  it('переменные окружения', () => {
    const c = loadConfig({
      ...PROD,
      PUBLIC_ORIGIN: 'https://primo.example.ru/, https://alt.example.ru',
      ADMIN_USERNAMES: ' Paimon , ,DATA_admin',
      SESSION_TTL_DAYS: '7',
      COOKIE_SECURE: 'false',
      PORT: '8080',
      TRUST_PROXY: 'false',
      DATA_DIR: '/srv/data',
      MIGRATIONS_DIR: '/app/drizzle',
      APP_VERSION: '1.2.3',
    });
    expect(c.allowedOrigins).toEqual(['https://primo.example.ru', 'https://alt.example.ru']);
    // ADMIN_USERNAMES больше не даёт прав (D-316): в настройках её нет, при старте — предупреждение
    expect(c).not.toHaveProperty('adminUsernames');
    expect(configWarnings({ ADMIN_USERNAMES: ' Paimon , ,DATA_admin' })).toEqual([
      expect.stringMatching(/ADMIN_USERNAMES.*admin grant/),
    ]);
    expect(configWarnings({ ADMIN_USERNAMES: ' ' })).toEqual([]);
    expect(configWarnings({})).toEqual([]);
    expect(c.sessionTtlDays).toBe(7);
    expect(c.cookieSecure).toBe(false);
    expect(c.port).toBe(8080);
    expect(c.trustProxy).toBe(false);
    expect(c.dataDir).toBe('/srv/data');
    expect(c.migrationsDir).toBe('/app/drizzle');
    expect(c.version).toBe('1.2.3');
    expect(() => loadConfig({ SESSION_TTL_DAYS: '0' })).toThrow(/SESSION_TTL_DAYS/);
    expect(() => loadConfig({ COOKIE_SECURE: 'maybe' })).toThrow(/COOKIE_SECURE/);
    expect(() => loadConfig({ PUBLIC_ORIGIN: 'ftp://x' })).toThrow(/PUBLIC_ORIGIN/);
  });
});
