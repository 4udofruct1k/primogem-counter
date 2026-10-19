// Синхронизация документов (14.5): оптимистичные версии, глобальный seq, «изменения после курсора».
import { APPEND_ONLY, parseDoc, type Collection, type SyncRequest, type SyncResponse } from '@primo/shared';
import { and, asc, eq, gt, inArray, max, sql } from 'drizzle-orm';
import type { Db } from './db';
import { userDocs, users } from './db/schema';
import { authRequired, formatIssues } from './errors';

interface DocRow {
  collection: string;
  docId: string;
  data: unknown;
  version: number;
  seq: number;
  deleted: boolean;
}

const row = {
  collection: userDocs.collection,
  docId: userDocs.docId,
  data: userDocs.data,
  version: userDocs.version,
  seq: userDocs.seq,
  deleted: userDocs.deleted,
};

const keyOf = (collection: string, id: string) => `${collection}\u0000${id}`;
const nextSeq = sql`nextval('user_docs_seq')`;

/** Серверное состояние для конфликта; документа нет — как удалённый версии 0. */
const serverState = (cur: DocRow | undefined) =>
  cur
    ? { data: cur.deleted ? null : cur.data, version: cur.version, deleted: cur.deleted }
    : { data: null, version: 0, deleted: true };

/**
 * Обмен изменениями одного пользователя в одной транзакции.
 * - Изменение принимается, только если `baseVersion` = версии на сервере (нового документа — 0), иначе конфликт.
 * - `data: null` — мягкое удаление (`deleted = true`, данные стираются).
 * - Каждая принятая запись: version + 1 и новый seq из общей последовательности.
 * - `ledger`, `wallet_snapshot` — только добавление: существующий id возвращается как принятый без изменений.
 * - Документ не по схеме коллекции и удаление из «только добавления» — в `rejected`, остальное применяется (D-305).
 * - Ответ: все документы пользователя с seq > cursor, не больше `pullLimit`, дальше — `more: true`.
 */
export async function syncDocs(
  db: Db,
  userId: string,
  req: SyncRequest,
  pullLimit: number,
): Promise<SyncResponse> {
  return db.transaction(async (tx) => {
    // Записи одного пользователя идут строго по очереди: seq выдаётся под блокировкой, поэтому
    // параллельный sync с другого устройства не может закоммитить меньший seq после того,
    // как курсор клиента ушёл дальше (D-306).
    const locked = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    if (locked.length === 0) throw authRequired();

    const existing = new Map<string, DocRow>();
    const ids = [...new Set(req.changes.map((c) => c.id))];
    if (ids.length > 0) {
      const rows = await tx
        .select(row)
        .from(userDocs)
        .where(and(eq(userDocs.userId, userId), inArray(userDocs.docId, ids)));
      for (const r of rows) existing.set(keyOf(r.collection, r.docId), r);
    }

    const applied: SyncResponse['applied'] = [];
    const conflicts: SyncResponse['conflicts'] = [];
    const rejected: NonNullable<SyncResponse['rejected']> = [];

    for (const ch of req.changes) {
      const { collection, id } = ch;
      const key = keyOf(collection, id);
      const cur = existing.get(key);
      const appendOnly = APPEND_ONLY.includes(collection);

      let data: unknown = null;
      if (ch.data !== null) {
        const parsed = parseDoc(collection as Collection, ch.data);
        if (!parsed.success) {
          rejected.push({ collection, id, message: formatIssues(parsed.error) });
          continue;
        }
        data = parsed.data;
      } else if (appendOnly) {
        rejected.push({
          collection,
          id,
          message: 'Записи этой коллекции только добавляются, удалять их нельзя',
        });
        continue;
      }

      if (appendOnly && cur) {
        applied.push({ collection, id, version: cur.version, seq: cur.seq });
        continue;
      }
      if (!appendOnly && ch.baseVersion !== (cur?.version ?? 0)) {
        conflicts.push({ collection, id, server: serverState(cur) });
        continue;
      }

      const deleted = data === null;
      const [written] = cur
        ? await tx
            .update(userDocs)
            .set({ data, deleted, version: cur.version + 1, seq: nextSeq, updatedAt: new Date() })
            .where(
              and(eq(userDocs.userId, userId), eq(userDocs.collection, collection), eq(userDocs.docId, id)),
            )
            .returning(row)
        : await tx
            .insert(userDocs)
            .values({ userId, collection, docId: id, data, deleted, version: 1, seq: nextSeq })
            .returning(row);
      if (!written) throw new Error(`sync: запись ${collection}/${id} не вернулась`);
      existing.set(key, written);
      applied.push({ collection, id, version: written.version, seq: written.seq });
    }

    const [{ maxSeq } = { maxSeq: null }] = await tx
      .select({ maxSeq: max(userDocs.seq) })
      .from(userDocs)
      .where(eq(userDocs.userId, userId));
    const last = Number(maxSeq ?? 0);
    // Курсор впереди сервера — БД восстановлена из бэкапа: отдаём всё заново.
    const from = req.cursor > last ? 0 : req.cursor;
    const rows = await tx
      .select(row)
      .from(userDocs)
      .where(and(eq(userDocs.userId, userId), gt(userDocs.seq, from)))
      .orderBy(asc(userDocs.seq))
      .limit(pullLimit + 1);
    const more = rows.length > pullLimit;
    const page = more ? rows.slice(0, pullLimit) : rows;

    const res: SyncResponse = {
      applied,
      conflicts,
      changes: page.map((r) => ({
        collection: r.collection as Collection,
        id: r.docId,
        data: r.deleted ? null : r.data,
        version: r.version,
        deleted: r.deleted,
      })),
      cursor: more ? page[page.length - 1]!.seq : last,
      more,
    };
    if (rejected.length > 0) res.rejected = rejected;
    return res;
  });
}
