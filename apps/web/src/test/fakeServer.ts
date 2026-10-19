// Упрощённый сервер синхронизации в памяти — по правилам 14.5 — для тестов клиента.
import { APPEND_ONLY, type SyncRequest, type SyncResponse } from '@primo/shared';
import { json, type Handler } from './harness';

interface Row {
  collection: string;
  id: string;
  data: unknown;
  version: number;
  seq: number;
  deleted: boolean;
}

export function fakeSyncServer() {
  const rows = new Map<string, Row>();
  let seq = 0;
  // эпоха данных (D-315): restore() имитирует восстановление из бэкапа
  const state = { epoch: 'e1' };
  const handler: Handler = async (path, init) => {
    if (path === '/api/me')
      return json({ id: 'u1', username: 'paimon', createdAt: '2026-10-19T00:00:00Z', isAdmin: false });
    if (path !== '/api/sync') return undefined;
    const req = JSON.parse(String(init!.body)) as SyncRequest;
    const res: SyncResponse = { applied: [], conflicts: [], changes: [], cursor: 0, epoch: state.epoch };
    const cursor = req.epoch && req.epoch !== state.epoch ? 0 : req.cursor;
    for (const c of req.changes) {
      const key = `${c.collection}/${c.id}`;
      const cur = rows.get(key);
      const current = cur?.version ?? 0;
      if (APPEND_ONLY.includes(c.collection) && c.data === null) {
        res.rejected = [
          ...(res.rejected ?? []),
          { collection: c.collection, id: c.id, message: 'append-only collection: delete is not allowed' },
        ];
        continue;
      }
      if (APPEND_ONLY.includes(c.collection) && cur) {
        res.applied.push({ collection: c.collection, id: c.id, version: cur.version, seq: cur.seq });
        continue;
      }
      if (c.baseVersion !== current) {
        res.conflicts.push({
          collection: c.collection,
          id: c.id,
          server: { data: cur?.data ?? null, version: current, deleted: cur?.deleted ?? true },
        });
        continue;
      }
      const row: Row = {
        collection: c.collection,
        id: c.id,
        data: c.data,
        version: current + 1,
        seq: ++seq,
        deleted: c.data === null,
      };
      rows.set(key, row);
      res.applied.push({ collection: c.collection, id: c.id, version: row.version, seq: row.seq });
    }
    res.changes = [...rows.values()]
      .filter((r) => r.seq > cursor)
      .sort((a, b) => a.seq - b.seq)
      .map((r) => ({
        collection: r.collection as SyncResponse['changes'][number]['collection'],
        id: r.id,
        data: r.data,
        version: r.version,
        deleted: r.deleted,
      }));
    res.cursor = seq;
    return json(res);
  };
  /** Восстановление из бэкапа: строки после `keepSeq` пропали, счётчик откатился, эпоха новая. */
  const restore = (keepSeq: number) => {
    for (const [k, r] of rows) if (r.seq > keepSeq) rows.delete(k);
    seq = keepSeq;
    state.epoch = `e${Number(state.epoch.slice(1)) + 1}`;
  };
  return { handler, rows, restore };
}
