// Общие зависимости маршрутов: собираются один раз в buildApp.
import type { SessionStore } from './auth/sessions';
import type { Secrets } from './auth/secrets';
import type { Config } from './config';
import type { Db } from './db';
import type { GameFiles } from './gamedata';
import type { Limiters } from './security';

export interface Deps {
  config: Config;
  db: Db;
  sessions: SessionStore;
  secrets: Secrets;
  limiters: Limiters;
  files: GameFiles;
}
