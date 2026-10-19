import { COLLECTIONS, type Collection, type DocOf } from '@primo/shared';
import type { StoredDoc } from '../data/db';

/** Документы пользователя в памяти: коллекция → id → данные (удалённые не хранятся). */
export type DocsState = { [C in Collection]: Record<string, DocOf<C>> };

export function emptyDocs(): DocsState {
  return Object.fromEntries(COLLECTIONS.map((c) => [c, {}])) as DocsState;
}

export function docsFromStored(stored: StoredDoc[]): DocsState {
  const docs = emptyDocs();
  for (const d of stored) {
    if (!d.deleted && d.data !== null && d.collection in docs)
      (docs[d.collection] as Record<string, unknown>)[d.id] = d.data;
  }
  return docs;
}

export function withDoc(docs: DocsState, collection: Collection, id: string, data: unknown): DocsState {
  const next: Record<string, unknown> = { ...docs[collection] };
  if (data === null) delete next[id];
  else next[id] = data;
  return { ...docs, [collection]: next };
}
