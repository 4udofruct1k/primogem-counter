import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config';

export async function buildApp(config: Pick<Config, 'dataDir' | 'version'>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Раздача игровых данных (14.6). Манифест и кэш-заголовки — этап M3.
  await app.register(fastifyStatic, { root: config.dataDir, prefix: '/data/' });

  // БД подключается на этапе M3; до этого db = 'unconfigured'.
  app.get('/api/health', async () => ({ ok: true, db: 'unconfigured', version: config.version }));

  return app;
}
