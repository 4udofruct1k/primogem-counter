// PGlite — настоящий PostgreSQL (WASM) в процессе: тесты API и локальный запуск без Docker (D-301).
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Database } from './index';

export interface PgliteDatabase extends Database {
  client: PGlite;
}

/** `dataDir` не задан — база в памяти. */
export async function openPglite(dataDir?: string): Promise<PgliteDatabase> {
  const client = await PGlite.create(dataDir, { extensions: { citext } });
  const db = drizzle({ client });
  return {
    db,
    client,
    migrate: (migrationsFolder) => migrate(db, { migrationsFolder }),
    close: async () => {
      if (!client.closed) await client.close();
    },
  };
}
