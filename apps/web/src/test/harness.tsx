// Тестовое окружение клиента: IndexedDB в памяти, игровые данные из data/, фиксированные часы.
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import datapack from '../../../../data/datapack-2026-10-19.json';
import seed from '../../../../data/primo_seed_regions.json';
import { createApi, type Api } from '../data/api';
import { PrimoDB } from '../data/db';
import { createSync } from '../data/sync';
import { AppProvider } from '../state/context';
import { createAppStore, type AppStore } from '../state/store';

/** 2026-10-19 10:00 UTC+5 — «сейчас» в тест-кейсах раздела 18. */
export const NOW = new Date('2026-10-19T05:00:00Z');

let dbSeq = 0;

export interface Harness {
  store: AppStore;
  api: Api;
  dbName: string;
  calls: string[];
}

export type Handler = (
  path: string,
  init?: RequestInit,
) => Response | undefined | Promise<Response | undefined>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Сервер игровых данных: манифест + файлы; `extra` — обработчик API. */
export function dataServer(opts: { offline?: () => boolean; extra?: Handler; patch?: unknown } = {}) {
  const calls: string[] = [];
  const fetchImpl = async (path: string, init?: RequestInit): Promise<Response> => {
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (opts.offline?.()) throw new TypeError('Failed to fetch');
    const extra = await opts.extra?.(path, init);
    if (extra) return extra;
    if (path === '/data/manifest.json')
      return json({
        generatedAt: '2026-10-19T00:00:00Z',
        packVersion: datapack.packVersion,
        seedSchemaVersion: seed.schemaVersion,
        files: {
          datapack: { path: '/data/datapack-2026-10-19.json', sha256: 'pack-sha' },
          seed: { path: '/data/primo_seed_regions.json', sha256: 'seed-sha' },
        },
        patch: opts.patch
          ? { version: 1, sha256: 'patch-sha', path: '/data/patch-1.json', updatedAt: '2026-10-19T00:00:00Z' }
          : null,
      });
    if (path === '/data/datapack-2026-10-19.json') return json(datapack);
    if (path === '/data/primo_seed_regions.json') return json(seed);
    if (path === '/data/patch-1.json' && opts.patch) return json(opts.patch);
    return json({ error: { code: 'NOT_FOUND', message: path } }, 404);
  };
  return { fetchImpl, calls };
}

export async function makeHarness(
  opts: { dbName?: string; clock?: () => Date; server?: ReturnType<typeof dataServer> } = {},
): Promise<Harness> {
  const dbName = opts.dbName ?? `primo-test-${++dbSeq}-${Math.random().toString(36).slice(2)}`;
  const server = opts.server ?? dataServer();
  let tickMs = 0;
  // часы идут: каждое обращение +1 мс от NOW (как у живого пользователя, действия не совпадают по времени)
  const clock = opts.clock ?? (() => new Date(NOW.getTime() + tickMs++));
  const store = createAppStore({ db: new PrimoDB(dbName), fetch: server.fetchImpl, clock });
  const api = createApi(server.fetchImpl);
  await store.getState().init();
  return { store, api, dbName, calls: server.calls };
}

export function renderApp(h: Harness, ui: ReactNode) {
  const sync = createSync(h.store, h.api);
  return render(
    <AppProvider store={h.store} services={{ api: h.api, sync }}>
      {ui}
    </AppProvider>,
  );
}
