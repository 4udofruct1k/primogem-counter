// Локальный кэш в IndexedDB (Dexie): документы пользователя, очередь синхронизации, игровые данные (раздел 2, 14.5).
import Dexie, { type Table } from 'dexie';
import type { Collection } from '@primo/shared';

export interface StoredDoc {
  /** `${collection}/${id}` */
  key: string;
  collection: Collection;
  id: string;
  data: unknown;
  /** Версия на сервере; 0 — документ ещё не синхронизирован. */
  version: number;
  deleted: boolean;
  updatedAt: string;
}

export interface QueuedChange {
  key: string;
  collection: Collection;
  id: string;
  /** null — удаление. */
  data: unknown;
  baseVersion: number;
  at: string;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface GameFile {
  key: string;
  sha256: string;
  json: unknown;
  fetchedAt: string;
}

export class PrimoDB extends Dexie {
  docs!: Table<StoredDoc, string>;
  queue!: Table<QueuedChange, string>;
  meta!: Table<MetaRow, string>;
  gamefiles!: Table<GameFile, string>;

  constructor(name = 'primo') {
    super(name);
    this.version(1).stores({ docs: 'key, collection', queue: 'key, at', meta: 'key', gamefiles: 'key' });
  }
}

export const docKey = (collection: Collection, id: string) => `${collection}/${id}`;
