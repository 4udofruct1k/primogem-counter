// Синхронизация с сервером (14.5): при старте, при возврате на вкладку, каждые 30 с при непустой очереди, вручную.
import { SYNC_BATCH_LIMIT } from '@primo/shared';
import type { AppStore } from '../state/store';
import { ApiFailure, type Api } from './api';

export const SYNC_INTERVAL_MS = 30_000;
/** Сколько раз за круг переждать 429 до того, как отложить синхронизацию до таймера. */
const RATE_LIMIT_RETRIES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createSync(store: AppStore, api: Api) {
  let running: Promise<void> | null = null;

  async function once(): Promise<void> {
    const { repo } = store;
    const s = store.getState();
    if (!s.account) return;
    s.setSync({ state: 'syncing', message: null });
    try {
      let conflicts = 0;
      let updated = 0;
      let limited = 0;
      const rejected: string[] = [];
      for (let round = 0; round < 100; round++) {
        const sent = await repo.pending(SYNC_BATCH_LIMIT);
        const cursor = await repo.cursor();
        const epoch = await repo.epoch();
        let res;
        try {
          res = await api.sync({
            cursor,
            ...(epoch ? { epoch } : {}),
            changes: sent.map((c) => ({
              collection: c.collection,
              id: c.id,
              data: c.data,
              baseVersion: c.baseVersion,
            })),
          });
        } catch (e) {
          // 429 (D-314): синхронизация с другой вкладки, лимит частоты, занятая строка — переждать и повторить
          if (e instanceof ApiFailure && e.code === 'RATE_LIMIT' && limited++ < RATE_LIMIT_RETRIES) {
            await sleep((e.retryAfter ?? 1) * 1000);
            continue;
          }
          throw e;
        }
        const r = await repo.applySync(sent, res);
        conflicts += r.conflicts.length;
        updated += r.updated.length;
        rejected.push(...r.rejected.map((x) => `${x.key}: ${x.message}`));
        if (!res.more && (await repo.pendingCount()) === 0) break;
        if (!res.more && sent.length === 0) break;
      }
      await store.getState().reloadDocs();
      store.getState().setSync({ state: 'idle', lastAt: new Date().toISOString(), message: null });
      if (rejected.length > 0) {
        console.warn('sync rejected', rejected);
        store
          .getState()
          .notify(
            `Сервер не принял изменений: ${rejected.length} — они остались только на этом устройстве`,
            'error',
          );
      }
      if (conflicts > 0) store.getState().notify('Данные обновлены с другого устройства');
      else if (updated > 0) store.getState().notify(`Получены изменения с другого устройства: ${updated}`);
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'RATE_LIMIT') {
        // сервер занят этим аккаунтом — не ошибка: очередь цела, повтор по таймеру
        store.getState().setSync({ state: 'idle', message: null });
        return;
      }
      if (e instanceof ApiFailure && e.code === 'AUTH_REQUIRED') {
        await store.getState().setAccount(null);
        store.getState().notify('Сессия истекла — войдите снова', 'error');
        return;
      }
      const offline = e instanceof ApiFailure && e.code === 'NETWORK';
      store.getState().setSync({
        state: offline ? 'offline' : 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  function syncNow(): Promise<void> {
    running ??= once().finally(() => {
      running = null;
    });
    return running;
  }

  /** Подписки: возврат на вкладку и таймер при непустой очереди. Возвращает отписку. */
  function start(): () => void {
    void syncNow();
    const onVisible = () => document.visibilityState === 'visible' && void syncNow();
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => {
      if (store.getState().sync.pending > 0) void syncNow();
    }, SYNC_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }

  return { syncNow, start };
}

export type Sync = ReturnType<typeof createSync>;
