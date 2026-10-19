import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';
import type { Api } from '../data/api';
import type { Sync } from '../data/sync';
import { createActions, type Actions } from './actions';
import { computeModel, deviceOffsetHours, type Model } from './model';
import type { AppState, AppStore } from './store';

export interface Services {
  api: Api;
  sync: Sync;
}

const StoreContext = createContext<AppStore | null>(null);
const ActionsContext = createContext<Actions | null>(null);
const ServicesContext = createContext<Services | null>(null);

export function AppProvider({
  store,
  services,
  children,
}: {
  store: AppStore;
  services: Services;
  children: ReactNode;
}) {
  const actions = useMemo(() => createActions(store), [store]);
  return (
    <StoreContext.Provider value={store}>
      <ServicesContext.Provider value={services}>
        <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
      </ServicesContext.Provider>
    </StoreContext.Provider>
  );
}

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('AppProvider не найден');
  return s;
}

export function useStoreApi(): AppStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('AppProvider не найден');
  return store;
}

export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(useStoreApi(), selector);
}

export function useActions(): Actions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error('AppProvider не найден');
  return actions;
}

/** Модель пересчитывается при изменении данных и раз в минуту. */
export function useModel(): Model | null {
  const game = useApp((s) => s.game);
  const docs = useApp((s) => s.docs);
  const now = useApp((s) => s.now);
  return useMemo(() => (game ? computeModel(game, docs, now, deviceOffsetHours()) : null), [game, docs, now]);
}
