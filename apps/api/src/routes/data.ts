// Раздача игровых данных (14.6): манифест, патчи админки из БД, статические data/*.json.
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../deps';
import { notFound } from '../errors';
import { buildManifest, patchBody, patchByVersion } from '../gamedata';

/** data/*.json могут меняться на месте (D-125), поэтому кэш короткий, как в Caddyfile (15.3). */
const STATIC_MAX_AGE_MS = 300_000;

export async function dataRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, files, config } = deps;

  app.get('/data/manifest.json', async (_req, reply) => {
    reply.header('cache-control', 'no-cache');
    return buildManifest(files, db);
  });

  // Версия патча не меняется после сохранения — файл можно кэшировать навсегда.
  app.get<{ Params: { version: string } }>('/data/patch-:version.json', async (req, reply) => {
    const version = /^[1-9]\d{0,8}$/.test(req.params.version) ? Number(req.params.version) : null;
    const patch = version === null ? null : await patchByVersion(db, version);
    if (!patch) throw notFound(`Патча данных версии ${req.params.version} нет`);
    reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .type('application/json; charset=utf-8');
    return patchBody(patch);
  });

  await app.register(fastifyStatic, {
    root: config.dataDir,
    prefix: '/data/',
    decorateReply: false,
    index: false,
    list: false,
    dotfiles: 'deny',
    allowedPath: (pathName) => pathName.endsWith('.json'),
    maxAge: STATIC_MAX_AGE_MS,
  });
}
