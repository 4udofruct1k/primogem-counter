// Резервная копия (10.10): все документы этого браузера в JSON и импорт из бэкапа или экспорта аккаунта.
import { COLLECTIONS, parseDoc, type Collection } from '@primo/shared';
import type { DocsState } from './docs';
import type { DocWrite } from './store';

export interface BackupDoc {
  collection: Collection;
  id: string;
  data: unknown;
}

export interface BackupFile {
  app: 'primo';
  kind: 'backup';
  exportedAt: string;
  docs: BackupDoc[];
}

export function makeBackup(docs: DocsState, at: string): BackupFile {
  const out: BackupDoc[] = [];
  for (const collection of COLLECTIONS)
    for (const [id, data] of Object.entries(docs[collection])) out.push({ collection, id, data });
  return { app: 'primo', kind: 'backup', exportedAt: at, docs: out };
}

/**
 * Разбор файла: свой бэкап или «Экспорт всех данных» аккаунта (`{ docs: [{ collection, id, data }] }`).
 * Документ без коллекции, с неверной схемой или удалённый (data = null) пропускается.
 */
export function readBackup(text: string): { writes: DocWrite[]; skipped: number } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: 'Это не JSON' };
  }
  const list = (raw as { docs?: unknown })?.docs;
  if (!Array.isArray(list)) return { error: 'В файле нет списка документов (docs)' };
  const writes: DocWrite[] = [];
  let skipped = 0;
  for (const d of list as Partial<BackupDoc>[]) {
    const collection = d?.collection;
    if (
      !collection ||
      !COLLECTIONS.includes(collection) ||
      typeof d.id !== 'string' ||
      d.data === null ||
      d.data === undefined ||
      !parseDoc(collection, d.data).success
    ) {
      skipped++;
      continue;
    }
    writes.push({ collection, id: d.id, data: d.data });
  }
  return { writes, skipped };
}
