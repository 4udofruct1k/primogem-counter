// Данные пользователя (14.4, 14.5): синхронизация, один документ, экспорт. Только документы своей сессии.
import { CollectionSchema, DocIdSchema, SyncRequestSchema, type Collection } from '@primo/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { Readable } from 'node:stream';
import { userOf, type AuthUser } from '../auth/sessions';
import type { Db } from '../db';
import { userDocs } from '../db/schema';
import type { Deps } from '../deps';
import { ApiError, notFound, parse, pgCode } from '../errors';
import { createSyncWriteLimit } from '../security';
import { exportPage, syncDocs } from '../sync';

/**
 * Не больше одного запроса пользователя за раз (api — одна копия, D-304): второй получает 429 сразу и не занимает
 * соединение пула, пока первый ждёт блокировку строки пользователя (D-314).
 */
class PerUserGate {
  private readonly busy = new Set<string>();

  /** Занять; null — уже занято. Освобождение можно вызывать повторно. */
  enter(userId: string): (() => void) | null {
    if (this.busy.has(userId)) return null;
    this.busy.add(userId);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.busy.delete(userId);
    };
  }
}

function busy(reply: FastifyReply, what: string): ApiError {
  reply.header('retry-after', 1);
  return new ApiError(429, 'RATE_LIMIT', `${what} — повторите через 1 с`);
}

export async function syncRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, sessions, config } = deps;
  const authed = { preHandler: sessions.authenticate };
  const syncGate = new PerUserGate();
  const exportGate = new PerUserGate();
  const writeLimit = createSyncWriteLimit(app, config.syncWritesPerMinute);

  app.post('/api/sync', authed, async (req, reply) => {
    const body = parse(SyncRequestSchema, req.body);
    const userId = userOf(req).id;
    const release = syncGate.enter(userId);
    if (!release) throw busy(reply, 'Синхронизация этого аккаунта уже идёт с другой вкладки или устройства');
    try {
      if (body.changes.length > 0) await writeLimit(req, reply);
      return await syncDocs(db, userId, body, config);
    } catch (err) {
      // lock_timeout: строку пользователя держит другая операция с аккаунтом
      if (pgCode(err) === '55P03') throw busy(reply, 'Данные аккаунта заняты другой операцией');
      throw err;
    } finally {
      release();
    }
  });

  // Один документ своей коллекции; чужой или удалённый — 404 (TC-48).
  app.get<{ Params: { collection: string; id: string } }>(
    '/api/docs/:collection/:id',
    authed,
    async (req) => {
      const collection = parse(CollectionSchema, req.params.collection);
      const id = parse(DocIdSchema, req.params.id);
      const [doc] = await db
        .select()
        .from(userDocs)
        .where(
          and(
            eq(userDocs.userId, userOf(req).id),
            eq(userDocs.collection, collection),
            eq(userDocs.docId, id),
            eq(userDocs.deleted, false),
          ),
        )
        .limit(1);
      if (!doc) throw notFound('Документ не найден');
      return {
        collection,
        id: doc.docId,
        data: doc.data,
        version: doc.version,
        updatedAt: doc.updatedAt.toISOString(),
      };
    },
  );

  // «Экспорт всех данных» (14.2): все неудалённые документы одним JSON — потоком по страницам (D-313).
  app.get('/api/export', authed, async (req, reply) => {
    const user = userOf(req);
    const release = exportGate.enter(user.id);
    if (!release) throw busy(reply, 'Экспорт этого аккаунта уже идёт');
    let first: ExportRow[];
    try {
      // первая страница до начала ответа: ошибка БД здесь — обычный ответ-ошибка, а не оборванный JSON
      first = await exportPage(db, user.id, null, config.syncPullMaxBytes);
    } catch (err) {
      release();
      throw err;
    }
    const stream = Readable.from(exportJson(db, user, first, config.syncPullMaxBytes), { objectMode: false });
    stream.once('close', release);
    reply.raw.once('close', release);
    return reply.type('application/json; charset=utf-8').send(stream);
  });
}

type ExportRow = Awaited<ReturnType<typeof exportPage>>[number];

/** JSON экспорта по частям: в памяти — одна страница документов, а не весь ответ. */
async function* exportJson(
  db: Db,
  user: AuthUser,
  first: ExportRow[],
  maxBytes: number,
): AsyncGenerator<string> {
  const head = {
    exportedAt: new Date().toISOString(),
    user: { id: user.id, username: user.username, createdAt: user.createdAt.toISOString() },
  };
  yield `${JSON.stringify(head).slice(0, -1)},"docs":[`;
  let page = first;
  let comma = '';
  while (page.length > 0) {
    let chunk = '';
    for (const d of page) {
      const doc = {
        collection: d.collection as Collection,
        id: d.docId,
        data: d.data,
        version: d.version,
        updatedAt: d.updatedAt.toISOString(),
      };
      chunk += comma + JSON.stringify(doc);
      comma = ',';
    }
    yield chunk;
    const tail = page[page.length - 1]!;
    page = await exportPage(db, user.id, { collection: tail.collection, docId: tail.docId }, maxBytes);
  }
  yield ']}';
}
