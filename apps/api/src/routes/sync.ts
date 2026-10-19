// Данные пользователя (14.4, 14.5): синхронизация, один документ, экспорт. Только документы своей сессии.
import { CollectionSchema, DocIdSchema, SyncRequestSchema, type Collection } from '@primo/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { userOf } from '../auth/sessions';
import { userDocs } from '../db/schema';
import type { Deps } from '../deps';
import { notFound, parse } from '../errors';
import { syncDocs } from '../sync';

export async function syncRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, sessions, config } = deps;
  const authed = { preHandler: sessions.authenticate };

  app.post('/api/sync', authed, async (req) => {
    const body = parse(SyncRequestSchema, req.body);
    return syncDocs(db, userOf(req).id, body, config.syncPullLimit);
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

  // «Экспорт всех данных» (14.2): все неудалённые документы одним JSON.
  app.get('/api/export', authed, async (req) => {
    const user = userOf(req);
    const docs = await db
      .select()
      .from(userDocs)
      .where(and(eq(userDocs.userId, user.id), eq(userDocs.deleted, false)))
      .orderBy(asc(userDocs.collection), asc(userDocs.docId));
    return {
      exportedAt: new Date().toISOString(),
      user: { id: user.id, username: user.username, createdAt: user.createdAt.toISOString() },
      docs: docs.map((d) => ({
        collection: d.collection as Collection,
        id: d.docId,
        data: d.data,
        version: d.version,
        updatedAt: d.updatedAt.toISOString(),
      })),
    };
  });
}
