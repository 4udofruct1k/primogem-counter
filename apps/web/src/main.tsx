import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createApi } from './data/api';
import { PrimoDB } from './data/db';
import { createSync } from './data/sync';
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider store={store} services={{ api, sync }}>
      <App />
    </AppProvider>
  </StrictMode>,
);
