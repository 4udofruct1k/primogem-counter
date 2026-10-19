// Подключение к PostgreSQL. Прод и `pnpm dev` — node-postgres по DATABASE_URL;
// тесты и запуск без Docker — PGlite в процессе (`DATABASE_URL=pglite:memory`, D-301).
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';

/** Drizzle-база без привязки к драйверу; транзакция `db.transaction(tx => …)` — тоже `Db`. */
export type Db = PgDatabase<PgQueryResultHKT>;

export interface Database {
  db: Db;
  /** Применяет SQL-миграции drizzle-kit из папки (при старте сервера, 15.2). */
  migrate(migrationsFolder: string): Promise<void>;
  close(): Promise<void>;
}

/** Префикс DATABASE_URL для PGlite: `pglite:memory` — в памяти, `pglite:<папка>` — на диске. */
export const PGLITE_PREFIX = 'pglite:';

export interface OpenOptions {
  /** Ошибки простаивающих соединений пула (обрыв связи с БД) — в лог, а не падение процесса. */
  onError?: (err: Error) => void;
}

export async function openDatabase(url: string, options: OpenOptions = {}): Promise<Database> {
  if (url.startsWith(PGLITE_PREFIX)) {
    // PGlite — dev-зависимость: грузится только по явному запросу, в прод-сборку не входит
    const { openPglite } = await import('./pglite');
    const dir = url.slice(PGLITE_PREFIX.length);
    return openPglite(dir === '' || dir === 'memory' ? undefined : dir);
  }
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  pool.on('error', (err) => options.onError?.(err));
  const db = drizzle({ client: pool });
  return {
    db,
    migrate: (migrationsFolder) => migrate(db, { migrationsFolder }),
    close: () => pool.end(),
  };
}

/** Проверка связи с БД для /api/health. */
export async function pingDb(db: Db): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
