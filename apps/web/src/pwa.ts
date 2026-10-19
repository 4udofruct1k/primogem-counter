// Состояние PWA (D-1002): есть ли новая версия приложения и как её применить. Регистрация — в main.tsx.
import { useSyncExternalStore } from 'react';

interface PwaState {
  /** Новая версия скачана и ждёт перезапуска. */
  needRefresh: boolean;
  update: () => void;
}

let state: PwaState = { needRefresh: false, update: () => undefined };
const listeners = new Set<() => void>();

export function setPwaUpdate(update: () => void): void {
  state = { needRefresh: true, update };
  listeners.forEach((l) => l());
}

export function usePwa(): PwaState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
