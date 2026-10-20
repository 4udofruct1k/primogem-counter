// Раздача игровых данных (14.6): манифест, патчи админки из БД, статические data/*.json.
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../deps';
import { notFound } from '../errors';
import { buildManifest, contentVersion, patchBody, patchByVersion, sha256 } from '../gamedata';

/** data/*.json могут меняться на месте (D-125), поэтому без версии кэш короткий, как в Caddyfile (15.3). */
const STATIC_MAX_AGE_MS = 300_000;
const SHORT_CACHE = 'public, max-age=300';
/** Ссылка из манифеста `?v=<версия содержимого>` (D-317), если версия совпала с тем, что отдаём. */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

/** `?v=` запроса: одна строка, иначе версии нет (повтор параметра `v` даёт массив). */
const queryVersion = (query: unknown): string | null => {
  const v = (query as { v?: unknown } | null)?.v;
  return typeof v === 'string' ? v : null;
};

export async function dataRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, files, config } = deps;

  app.get('/data/manifest.json', async (_req, reply) => {
    reply.header('cache-control', 'no-cache');
    return buildManifest(files, db);
  });

  // Сохранённый патч не меняется, но после восстановления БД из бэкапа (15.5) его номер может достаться другому
  // патчу — навсегда кэшируется только ссылка с хэшем содержимого (D-317).
  app.get<{ Params: { version: string } }>('/data/patch-:version.json', async (req, reply) => {
    const version = /^[1-9]\d{0,8}$/.test(req.params.version) ? Number(req.params.version) : null;
    const patch = version === null ? null : await patchByVersion(db, version);
    if (!patch) throw notFound(`Патча данных версии ${req.params.version} нет`);
    const body = patchBody(patch);
    const current = queryVersion(req.query) === contentVersion(sha256(body));
    reply
      .header('cache-control', current ? IMMUTABLE_CACHE : SHORT_CACHE)
      .type('application/json; charset=utf-8');
    return body;
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
    // immutable — только если `?v=` совпала с хэшем именно этого файла (stat того, что сейчас уходит клиенту)
    setHeaders: (reply, filePath, stat) => {
      const v = queryVersion(reply.request.query);
      if (v !== null && files.isVersion(filePath, stat, v)) reply.header('cache-control', IMMUTABLE_CACHE);
    },
  });
}
