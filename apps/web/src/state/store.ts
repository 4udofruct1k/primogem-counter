// Состояние приложения (Zustand): игровые данные, документы пользователя, аккаунт, синхронизация.
import { normalizeIso, type ISO } from '@primo/domain';
import type { Collection } from '@primo/shared';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { PrimoDB } from '../data/db';
import { loadGameData, type GameData } from '../data/gamedata';
import { LocalRepo } from '../data/repo';
import { docsFromStored, emptyDocs, withDoc, type DocsState } from './docs';

export interface Account {
  id: string;
  username: string;
  createdAt: string;
  isAdmin: boolean;
}

export interface SyncStatus {
  state: 'guest' | 'idle' | 'syncing' | 'offline' | 'error';
  pending: number;
  lastAt: string | null;
  message: string | null;
}

export interface Notice {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export interface DocWrite {
  collection: Collection;
  id: string;
  data: unknown;
}

export interface AppState {
  phase: 'loading' | 'ready' | 'error';
  error: string | null;
  game: GameData | null;
  docs: DocsState;
  /** Текущий момент с точностью до минуты (обновляется таймером). */
  now: ISO;
  account: Account | null;
  sync: SyncStatus;
  notices: Notice[];
  init(): Promise<void>;
  write(changes: DocWrite[]): Promise<void>;
  put(collection: Collection, id: string, data: unknown): Promise<void>;
  remove(collection: Collection, id: string): Promise<void>;
  tick(): void;
  notify(text: string, kind?: Notice['kind']): void;
  dismiss(id: number): void;
  setAccount(account: Account | null): Promise<void>;
  setSync(patch: Partial<SyncStatus>): void;
  reloadDocs(): Promise<void>;
  setGame(game: GameData): void;
}

export interface StoreDeps {
  db: PrimoDB;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  clock: () => Date;
}

export type AppStore = StoreApi<AppState> & { deps: StoreDeps; repo: LocalRepo };

export function minuteIso(d: Date): ISO {
  const copy = new Date(d);
  copy.setUTCSeconds(0, 0);
  return normalizeIso(copy.toISOString());
}

let noticeSeq = 0;

export function createAppStore(deps: StoreDeps): AppStore {
  const repo = new LocalRepo(deps.db);
  const store = createStore<AppState>()((set, get) => ({
    phase: 'loading',
    error: null,
    game: null,
    docs: emptyDocs(),
    now: minuteIso(deps.clock()),
    account: null,
    sync: { state: 'guest', pending: 0, lastAt: null, message: null },
    notices: [],

    async init() {
      try {
        const [stored, accountRow, pending] = await Promise.all([
          repo.loadAll(),
          deps.db.meta.get('account'),
          repo.pendingCount(),
        ]);
        const account = (accountRow?.value as Account | undefined) ?? null;
        set({
          docs: docsFromStored(stored),
          account,
          sync: { ...get().sync, state: account ? 'idle' : 'guest', pending },
        });
        const game = await loadGameData(deps.db, deps.fetch);
        set({ game, phase: 'ready', error: null, now: minuteIso(deps.clock()) });
        if (game.source === 'cache') get().notify('Нет связи: игровые данные из кэша');
      } catch (e) {
        set({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    },

    async write(changes) {
      if (changes.length === 0) return;
      const at = new Date(deps.clock()).toISOString();
      let docs = get().docs;
      for (const c of changes) docs = withDoc(docs, c.collection, c.id, c.data);
      set({ docs });
      for (const c of changes) {
        if (c.data === null) await repo.remove(c.collection, c.id, at);
        else await repo.put(c.collection, c.id, c.data, at);
      }
      set({ sync: { ...get().sync, pending: await repo.pendingCount() } });
    },

    put(collection, id, data) {
      return get().write([{ collection, id, data }]);
    },

    remove(collection, id) {
      return get().write([{ collection, id, data: null }]);
    },

    tick() {
      const now = minuteIso(deps.clock());
      if (now !== get().now) set({ now });
    },

    notify(text, kind = 'info') {
      const id = ++noticeSeq;
      set({ notices: [...get().notices, { id, text, kind }] });
    },

    dismiss(id) {
      set({ notices: get().notices.filter((n) => n.id !== id) });
    },

    async setAccount(account) {
      if (account) await deps.db.meta.put({ key: 'account', value: account });
      else await deps.db.meta.delete('account');
      set({ account, sync: { ...get().sync, state: account ? 'idle' : 'guest' } });
    },

    setSync(patch) {
      set({ sync: { ...get().sync, ...patch } });
    },

    async reloadDocs() {
      set({
        docs: docsFromStored(await repo.loadAll()),
        sync: { ...get().sync, pending: await repo.pendingCount() },
      });
    },

    setGame(game) {
      set({ game });
    },
  }));
  return Object.assign(store, { deps, repo });
}
