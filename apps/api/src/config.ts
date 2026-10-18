import path from 'node:path';

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  version: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    dataDir: env.DATA_DIR ?? path.resolve(import.meta.dirname, '../../../data'),
    version: env.APP_VERSION ?? '0.0.0',
  };
}
