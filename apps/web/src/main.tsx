import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { createApi } from './data/api';
import { PrimoDB } from './data/db';
import { createSync } from './data/sync';
import { setPwaUpdate } from './pwa';
import { AppProvider } from './state/context';
import { createAppStore } from './state/store';
import './styles.css';

const store = createAppStore({
  db: new PrimoDB(),
  fetch: (input, init) => fetch(input, init),
  clock: () => new Date(),
});
const api = createApi((input, init) => fetch(input, init));
const sync = createSync(store, api);

void store
  .getState()
  .init()
  .then(() => sync.start());
setInterval(() => store.getState().tick(), 15_000);

// сервис-воркер: оболочка работает без сети, новая версия — по кнопке «Обновить» (D-1002)
const updateSW = registerSW({
  onNeedRefresh: () => setPwaUpdate(() => void updateSW(true)),
  onOfflineReady: () => store.getState().notify('Приложение готово работать без сети'),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider store={store} services={{ api, sync }}>
      <App />
    </AppProvider>
  </StrictMode>,
);
