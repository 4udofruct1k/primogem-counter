// Синхронизация документов (14.5): оптимистичные версии, глобальный seq, «изменения после курсора».
import {
  APPEND_ONLY,
  jsonBytes,
  parseDoc,
  type Collection,
  type SyncRequest,
  type SyncResponse,
} from '@primo/shared';
import { and, asc, eq, gt, inArray, max, sql } from 'drizzle-orm';
import type { Config } from './config';
import type { Db } from './db';
import { userDocs, users } from './db/schema';
import { authRequired, formatIssues } from './errors';

/** Пределы синхронизации из настроек (D-312–D-314). */
export type SyncLimits = Pick<
  Config,
  | 'syncPullLimit'
  | 'syncPullMaxBytes'
  | 'docMaxBytes'
  | 'userMaxDocs'
  | 'userMaxBytes'
  | 'syncLockTimeoutMs'
  | 'syncStatementTimeoutMs'
>;

/** Строка без `data`: для проверок хватает версии, seq и размера, сами данные читаются только для ответа. */
interface DocMeta {
  collection: string;
  docId: string;
  version: number;
  seq: number;
  deleted: boolean;
  size: number;
}

const meta = {
  collection: userDocs.collection,
  docId: userDocs.docId,
  version: userDocs.version,
  seq: userDocs.seq,
  deleted: userDocs.deleted,
  size: userDocs.size,
};

const keyOf = (collection: string, id: string) => `${collection}\u0000${id}`;
const nextSeq = sql`nextval('user_docs_seq')`;

/** 300 КБ, 32 МБ — для сообщений о пределах. */
function formatSize(bytes: number): string {
  const mb = 1024 * 1024;
  return bytes >= mb && bytes % mb === 0 ? `${bytes / mb} МБ` : `${Math.ceil(bytes / 1024)} КБ`;
}

/**
 * Эпоха данных сервера (D-315): идентификатор кластера Postgres и OID последовательности `user_docs_seq`.
 * `pg_restore --clean` пересоздаёт последовательность — у неё новый OID; восстановление в новый кластер меняет
 * идентификатор. Обычная работа и перезапуски эпоху не меняют. В бэкапе её нет — пропустить нечего.
 */
async function dataEpoch(db: Db): Promise<string> {
  const [row] = await db
    .select({
      epoch: sql<string>`left(md5(system_identifier::text || ':' || 'user_docs_seq'::regclass::oid::text), 16)`,
    })
    .from(sql`pg_control_system()`);
  if (!row) throw new Error('sync: нет эпохи данных');
  return row.epoch;
}

/**
 * Страница «изменения после курсора» по seq: не больше `syncPullLimit` строк, и строка входит, только если данных
 * до неё меньше `syncPullMaxBytes` (первая — всегда, поэтому курсор движется даже при документе больше бюджета).
 */
async function pullPage(tx: Db, userId: string, from: number, limits: SyncLimits) {
  const page = tx
    .select({
      collection: userDocs.collection,
      docId: userDocs.docId,
      data: userDocs.data,
      version: userDocs.version,
      seq: userDocs.seq,
      deleted: userDocs.deleted,
      before: sql<number>`sum(${userDocs.size}) over (order by ${userDocs.seq}) - ${userDocs.size}`.as(
        'before',
      ),
    })
    .from(userDocs)
    .where(and(eq(userDocs.userId, userId), gt(userDocs.seq, from)))
    .orderBy(asc(userDocs.seq))
    .limit(limits.syncPullLimit)
    .as('page');
  return tx
    .select({
      collection: page.collection,
      docId: page.docId,
      data: page.data,
      version: page.version,
      seq: page.seq,
      deleted: page.deleted,
    })
    .from(page)
    .where(sql`${page.before} < ${limits.syncPullMaxBytes}`)
    .orderBy(asc(page.seq));
}

/** Строк в одной странице чтения экспорта (D-313). */
const EXPORT_PAGE_ROWS = 500;

/**
 * Страница экспорта: неудалённые документы по (collection, doc_id) после `after`, не больше `EXPORT_PAGE_ROWS`
 * строк и `maxBytes` данных (первая — всегда). Пустая — документы кончились.
 */
export async function exportPage(
  db: Db,
  userId: string,
  after: { collection: string; docId: string } | null,
  maxBytes: number,
) {
  const page = db
    .select({
      collection: userDocs.collection,
      docId: userDocs.docId,
      data: userDocs.data,
      version: userDocs.version,
      updatedAt: userDocs.updatedAt,
      before:
        sql<number>`sum(${userDocs.size}) over (order by ${userDocs.collection}, ${userDocs.docId}) - ${userDocs.size}`.as(
          'before',
        ),
    })
    .from(userDocs)
    .where(
      and(
        eq(userDocs.userId, userId),
        eq(userDocs.deleted, false),
        after
          ? sql`(${userDocs.collection}, ${userDocs.docId}) > (${after.collection}, ${after.docId})`
          : undefined,
      ),
    )
    .orderBy(asc(userDocs.collection), asc(userDocs.docId))
    .limit(EXPORT_PAGE_ROWS)
    .as('page');
  return db
    .select({
      collection: page.collection,
      docId: page.docId,
      data: page.data,
      version: page.version,
      updatedAt: page.updatedAt,
    })
    .from(page)
    .where(sql`${page.before} < ${maxBytes}`)
    .orderBy(asc(page.collection), asc(page.docId));
}

/**
 * Обмен изменениями одного пользователя в одной транзакции.
 * - Изменение принимается, только если `baseVersion` = версии на сервере (нового документа — 0), иначе конфликт.
 * - `data: null` — мягкое удаление (`deleted = true`, данные стираются).
 * - Каждая принятая запись: version + 1 и новый seq из общей последовательности.
 * - `ledger`, `wallet_snapshot` — только добавление: существующий id возвращается как принятый без изменений.
 * - Документ не по схеме коллекции, больше `docMaxBytes`, сверх квоты аккаунта и удаление из «только добавления» —
 *   в `rejected`, остальное применяется (D-305, D-312).
 * - Данные конфликтов — в пределах `syncPullMaxBytes`: дальше изменения не обрабатываются, `more: true` (D-313).
 * - Эпоха запроса не совпала с эпохой сервера — курсор и `baseVersion > 0` не принимаются (D-315).
 * - Ответ: документы пользователя с seq > cursor, не больше `syncPullLimit` строк и `syncPullMaxBytes` байт,
 *   дальше — `more: true`.
 */
export async function syncDocs(
  db: Db,
  userId: string,
  req: SyncRequest,
  limits: SyncLimits,
): Promise<SyncResponse> {
  return db.transaction(async (tx) => {
    // Предохранители (D-314): транзакция держит соединение пула — не ждём блокировку и запрос бесконечно.
    await tx.execute(
      sql`select set_config('lock_timeout', ${`${limits.syncLockTimeoutMs}ms`}, true),
        set_config('statement_timeout', ${`${limits.syncStatementTimeoutMs}ms`}, true)`,
    );
    // Записи одного пользователя идут строго по очереди: seq выдаётся под блокировкой, поэтому
    // параллельный sync с другого устройства не может закоммитить меньший seq после того,
    // как курсор клиента ушёл дальше (D-306). Под той же блокировкой — счётчики квоты (D-312).
    const [user] = await tx
      .select({ docCount: users.docCount, docBytes: users.docBytes })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    if (!user) throw authRequired();
    const epoch = await dataEpoch(tx);
    // Эпоха другая — база восстановлена из бэкапа: курсор и версии клиента — из другой истории seq (D-315).
    const restored = req.epoch !== undefined && req.epoch !== epoch;

    const existing = new Map<string, DocMeta>();
    const ids = [...new Set(req.changes.map((c) => c.id))];
    if (ids.length > 0) {
      const rows = await tx
        .select(meta)
        .from(userDocs)
        .where(and(eq(userDocs.userId, userId), inArray(userDocs.docId, ids)));
      for (const r of rows) existing.set(keyOf(r.collection, r.docId), r);
    }

    const applied: SyncResponse['applied'] = [];
    const conflicted: { collection: Collection; id: string }[] = [];
    const rejected: NonNullable<SyncResponse['rejected']> = [];
    let { docCount, docBytes } = user;
    let conflictBytes = 0;
    let deferred = false;

    for (const ch of req.changes) {
      const { collection, id } = ch;
      const key = keyOf(collection, id);
      const cur = existing.get(key);
      const appendOnly = APPEND_ONLY.includes(collection);

      let data: unknown = null;
      let size = 0;
      if (ch.data !== null) {
        const parsed = parseDoc(collection as Collection, ch.data);
        if (!parsed.success) {
          rejected.push({ collection, id, message: formatIssues(parsed.error) });
          continue;
        }
        data = parsed.data;
        size = jsonBytes(data);
        if (size > limits.docMaxBytes) {
          rejected.push({
            collection,
            id,
            message: `Документ ${formatSize(size)} — больше предела ${formatSize(limits.docMaxBytes)}, сервер его не сохранил`,
          });
          continue;
        }
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
      if (!appendOnly && (ch.baseVersion !== (cur?.version ?? 0) || (restored && ch.baseVersion > 0))) {
        // данные конфликта уходят в ответ: не больше бюджета страницы, остальное — следующим запросом
        const bytes = cur?.size ?? 0;
        if (conflicted.length > 0 && conflictBytes + bytes > limits.syncPullMaxBytes) {
          deferred = true;
          break;
        }
        conflictBytes += bytes;
        conflicted.push({ collection, id });
        continue;
      }

      const addDocs = cur ? 0 : 1;
      const addBytes = size - (cur?.size ?? 0);
      if (addDocs > 0 && docCount + addDocs > limits.userMaxDocs) {
        rejected.push({
          collection,
          id,
          message: `Лимит аккаунта — не больше ${limits.userMaxDocs} документов: изменение не сохранено`,
        });
        continue;
      }
      if (addBytes > 0 && docBytes + addBytes > limits.userMaxBytes) {
        rejected.push({
          collection,
          id,
          message: `Лимит аккаунта — не больше ${formatSize(limits.userMaxBytes)} данных: изменение не сохранено`,
        });
        continue;
      }

      const deleted = data === null;
      const [written] = cur
        ? await tx
            .update(userDocs)
            .set({ data, deleted, size, version: cur.version + 1, seq: nextSeq, updatedAt: new Date() })
            .where(
              and(eq(userDocs.userId, userId), eq(userDocs.collection, collection), eq(userDocs.docId, id)),
            )
            .returning(meta)
        : await tx
            .insert(userDocs)
            .values({ userId, collection, docId: id, data, deleted, size, version: 1, seq: nextSeq })
            .returning(meta);
      if (!written) throw new Error(`sync: запись ${collection}/${id} не вернулась`);
      existing.set(key, written);
      docCount += addDocs;
      docBytes += addBytes;
      applied.push({ collection, id, version: written.version, seq: written.seq });
    }

    if (docCount !== user.docCount || docBytes !== user.docBytes)
      await tx.update(users).set({ docCount, docBytes }).where(eq(users.id, userId));

    // Серверное состояние конфликтов — одним запросом; документа нет — как удалённый версии 0.
    const server = new Map<string, { data: unknown; version: number; deleted: boolean }>();
    if (conflicted.length > 0) {
      const pairs = sql.join(
        conflicted.map((c) => sql`(${c.collection}, ${c.id})`),
        sql`, `,
      );
      const rows = await tx
        .select({
          collection: userDocs.collection,
          docId: userDocs.docId,
          data: userDocs.data,
          version: userDocs.version,
          deleted: userDocs.deleted,
        })
        .from(userDocs)
        .where(
          and(eq(userDocs.userId, userId), sql`(${userDocs.collection}, ${userDocs.docId}) in (${pairs})`),
        );
      for (const r of rows)
        server.set(keyOf(r.collection, r.docId), {
          data: r.deleted ? null : r.data,
          version: r.version,
          deleted: r.deleted,
        });
    }
    const conflicts = conflicted.map((c) => ({
      ...c,
      server: server.get(keyOf(c.collection, c.id)) ?? { data: null, version: 0, deleted: true },
    }));

    const [{ maxSeq } = { maxSeq: null }] = await tx
      .select({ maxSeq: max(userDocs.seq) })
      .from(userDocs)
      .where(eq(userDocs.userId, userId));
    const last = Number(maxSeq ?? 0);
    // Курсор впереди сервера или другая эпоха — БД восстановлена из бэкапа: отдаём всё заново (D-306, D-315).
    const from = restored || req.cursor > last ? 0 : req.cursor;
    const page = await pullPage(tx, userId, from, limits);
    const tail = page.at(-1)?.seq ?? last;
    const more = tail < last;

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
      cursor: more ? tail : last,
      more: more || deferred,
      epoch,
    };
    if (rejected.length > 0) res.rejected = rejected;
    return res;
  });
}
