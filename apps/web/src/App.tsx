import { useEffect, useState } from 'react';

type Health = { ok: boolean; db: string; version: string };

export function App() {
  const [health, setHealth] = useState<Health | 'offline' | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setHealth('offline'));
  }, []);

  return (
    <main>
      <h1>Копилка круток</h1>
      <p>
        Сервер:{' '}
        {health === null
          ? '…'
          : health === 'offline'
            ? 'нет связи'
            : `ok, v${health.version}, БД ${health.db}`}
      </p>
    </main>
  );
}
