// Локальное хранилище документов и очередь изменений (14.5). Работает и без аккаунта (гостевой режим).
import type { Collection, SyncResponse } from '@primo/shared';
import { docKey, type PrimoDB, type QueuedChange, type StoredDoc } from './db';

export class LocalRepo {
  constructor(readonly db: PrimoDB) {}

  async loadAll(): Promise<StoredDoc[]> {
    return this.db.docs.toArray();
  }

  /** Запись документа: в кэш и в очередь (одна запись очереди на документ — последнее состояние). */
  async put(collection: Collection, id: string, data: unknown, at: string): Promise<void> {
    await this.write(collection, id, data, at);
  }

  async remove(collection: Collection, id: string, at: string): Promise<void> {
    await this.write(collection, id, null, at);
  }

  private async write(collection: Collection, id: string, data: unknown, at: string) {
    const key = docKey(collection, id);
    await this.db.transaction('rw', this.db.docs, this.db.queue, async () => {
      const existing = await this.db.docs.get(key);
      const version = existing?.version ?? 0;
      await this.db.docs.put({ key, collection, id, data, version, deleted: data === null, updatedAt: at });
      await this.db.queue.put({ key, collection, id, data, baseVersion: version, at });
    });
  }

  async pending(limit: number): Promise<QueuedChange[]> {
    return this.db.queue.orderBy('at').limit(limit).toArray();
  }

  async pendingCount(): Promise<number> {
    return this.db.queue.count();
  }

  async cursor(): Promise<number> {
    return ((await this.db.meta.get('cursor'))?.value as number | undefined) ?? 0;
  }

  /** «Сохранить в аккаунт»: все локальные документы — в очередь как новые (baseVersion 0). */
  async enqueueAll(at: string): Promise<number> {
    const docs = await this.db.docs.toArray();
    await this.db.transaction('rw', this.db.queue, async () => {
      for (const d of docs) {
        if (d.deleted) continue;
        await this.db.queue.put({
          key: d.key,
          collection: d.collection,
          id: d.id,
          data: d.data,
          baseVersion: 0,
          at,
        });
      }
    });
    return docs.length;
  }

  /**
   * Применяет ответ /api/sync к кэшу.
   * - applied: версия документа обновляется, запись очереди снимается, если её не перезаписали после отправки;
   * - conflicts: берётся серверная версия (14.5), локальное изменение отбрасывается;
   * - changes: изменения с других устройств; документ с неотправленной правкой не трогается —
   *   на следующем круге она даст конфликт и победит сервер.
   * Возвращает id документов, обновлённых «с другого устройства».
   */
  async applySync(
    sent: QueuedChange[],
    res: SyncResponse,
  ): Promise<{ conflicts: string[]; updated: string[] }> {
    const sentByKey = new Map(sent.map((c) => [c.key, c]));
    const conflicts: string[] = [];
    const updated: string[] = [];
    await this.db.transaction('rw', this.db.docs, this.db.queue, this.db.meta, async () => {
      for (const a of res.applied) {
        const key = docKey(a.collection, a.id);
        const doc = await this.db.docs.get(key);
        if (doc) await this.db.docs.put({ ...doc, version: a.version });
        const queued = await this.db.queue.get(key);
        const s = sentByKey.get(key);
        if (queued && s && queued.at === s.at) await this.db.queue.delete(key);
        else if (queued) await this.db.queue.put({ ...queued, baseVersion: a.version });
      }
      for (const c of res.conflicts) {
        const key = docKey(c.collection, c.id);
        await this.db.queue.delete(key);
        await this.db.docs.put({
          key,
          collection: c.collection,
          id: c.id,
          data: c.server.deleted ? null : c.server.data,
          version: c.server.version,
          deleted: c.server.deleted,
          updatedAt: new Date().toISOString(),
        });
        conflicts.push(key);
      }
      for (const ch of res.changes) {
        const key = docKey(ch.collection, ch.id);
        if (await this.db.queue.get(key)) continue;
        const doc = await this.db.docs.get(key);
        if (doc && doc.version >= ch.version) continue;
        await this.db.docs.put({
          key,
          collection: ch.collection,
          id: ch.id,
          data: ch.deleted ? null : ch.data,
          version: ch.version,
          deleted: ch.deleted,
          updatedAt: new Date().toISOString(),
        });
        updated.push(key);
      }
      await this.db.meta.put({ key: 'cursor', value: res.cursor });
    });
    return { conflicts, updated };
  }

  /** Выход из аккаунта: локальные данные очищаются, игровые данные остаются. */
  async clearUserData(): Promise<void> {
    await this.db.transaction('rw', this.db.docs, this.db.queue, this.db.meta, async () => {
      await this.db.docs.clear();
      await this.db.queue.clear();
      await this.db.meta.delete('cursor');
      await this.db.meta.delete('account');
    });
  }
}
