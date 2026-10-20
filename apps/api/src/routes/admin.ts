// Админка данных (D-123, 16): патч поверх датапака — шаблон ивентов, ивенты, баннеры, версии.
import { applyDatapackPatch, type DatapackPatchLike, type RawDatapack } from '@primo/domain';
import { AdminPatchBodySchema, DatapackSchema } from '@primo/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { userOf } from '../auth/sessions';
import { adminPatches } from '../db/schema';
import type { Deps } from '../deps';
import { conflict, forbidden, formatIssues, parse, validation } from '../errors';
import { latestPatch } from '../gamedata';

export async function adminRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { db, sessions, files } = deps;

  // права — флаг аккаунта от оператора (D-316), а не логин: занятый заранее или заново логин прав не даёт
  const requireAdmin = async (req: FastifyRequest) => {
    if (!userOf(req).isAdmin) throw forbidden('Только для админов данных');
  };
  const admin = { preHandler: [sessions.authenticate, requireAdmin] };

  app.get('/api/admin/patch', admin, async () => {
    const p = await latestPatch(db);
    return p
      ? { version: p.version, patch: p.patch, updatedAt: p.createdAt.toISOString() }
      : { version: 0, patch: {}, updatedAt: null };
  });

  // Новая версия патча: схема патча → наложение на базовый датапак → схема итогового датапака →
  // оптимистичная блокировка по baseVersion (устаревшая — 409 CONFLICT).
  app.put('/api/admin/patch', admin, async (req) => {
    const body = parse(AdminPatchBodySchema, req.body);
    const base = (await files.datapack()).json as RawDatapack;
    const merged = DatapackSchema.safeParse(applyDatapackPatch(base, body.patch as DatapackPatchLike));
    if (!merged.success)
      throw validation(`Датапак с этим патчем не проходит проверку: ${formatIssues(merged.error)}`);

    const current = (await latestPatch(db))?.version ?? 0;
    if (body.baseVersion !== current) {
      throw conflict(
        `Патч уже изменён (версия ${current}, правка шла от ${body.baseVersion}) — обновите страницу`,
      );
    }
    // одновременное сохранение от той же версии: вторая вставка упрётся в первичный ключ
    const [row] = await db
      .insert(adminPatches)
      .values({ version: current + 1, patch: body.patch, createdBy: userOf(req).id })
      .onConflictDoNothing()
      .returning({ version: adminPatches.version });
    if (!row) throw conflict('Патч уже изменён — обновите страницу');
    req.log.info({ version: row.version, admin: userOf(req).username }, 'патч данных сохранён');
    return { version: row.version };
  });
}
