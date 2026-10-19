// Точка входа api: настройки → БД → миграции → HTTP (15.2: миграции применяются при старте).
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { ConfigError, loadConfig } from './config';
import { openDatabase } from './db';

async function main(): Promise<void> {
  const config = loadConfig();
  let app: FastifyInstance | null = null;
  const database = await openDatabase(config.databaseUrl, {
    onError: (err) => (app ? app.log.error({ err }, 'ошибка соединения с БД') : console.error(err)),
  });
  await database.migrate(config.migrationsDir);

  app = await buildApp({ config, db: database.db });
  app.addHook('onClose', () => database.close());
  app.log.info({ migrationsDir: config.migrationsDir, dataDir: config.dataDir }, 'миграции применены');

  const stop = (signal: string) => {
    app?.log.info({ signal }, 'остановка');
    void app?.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err: unknown) => {
  console.error(err instanceof ConfigError ? `Ошибка настройки: ${err.message}` : err);
  process.exit(1);
});
