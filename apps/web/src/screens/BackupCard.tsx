// «Бэкап» и «Импорт» в настройках (10.10): работают и в гостевом режиме, без сервера.
import { useState } from 'react';
import { makeBackup, readBackup } from '../state/backup';
import { useApp, useStoreApi } from '../state/context';
import type { DocWrite } from '../state/store';
import { Button, Card, Sheet } from '../ui/components';
import { downloadText } from './AccountCard';

export function BackupCard() {
  const store = useStoreApi();
  const docs = useApp((s) => s.docs);
  const [pending, setPending] = useState<{ writes: DocWrite[]; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = () => {
    const at = store.deps.clock().toISOString();
    downloadText(`primo-backup-${at.slice(0, 10)}.json`, JSON.stringify(makeBackup(docs, at), null, 2));
  };

  const pick = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    const res = readBackup(await file.text());
    if ('error' in res) setError(res.error);
    else if (res.writes.length === 0)
      setError(`В файле нет подходящих документов (пропущено ${res.skipped})`);
    else setPending(res);
  };

  return (
    <Card title="Резервная копия">
      <p className="muted small">
        Бэкап — все данные этого браузера одним файлом JSON. Импорт принимает бэкап или «Экспорт всех данных»
        аккаунта; в аккаунте импортированное уйдёт на сервер при синхронизации.
      </p>
      <div className="btn-row">
        <Button onClick={download}>Скачать бэкап</Button>
        <label className="btn">
          Импорт из файла
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Файл бэкапа"
            style={{ display: 'none' }}
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {error && <p className="hot small">{error}</p>}
      <Sheet open={!!pending} onClose={() => setPending(null)} title="Импорт данных">
        <p>
          Документов: <b>{pending?.writes.length}</b>
          {pending?.skipped ? ` (пропущено неподходящих: ${pending.skipped})` : ''}. Документы с теми же id
          заменятся, остальные данные останутся.
        </p>
        <div className="btn-row">
          <Button
            variant="primary"
            onClick={async () => {
              const n = pending!.writes.length;
              await store.getState().write(pending!.writes);
              setPending(null);
              store.getState().notify(`Импортировано документов: ${n}`);
            }}
          >
            Импортировать
          </Button>
          <Button onClick={() => setPending(null)}>Отмена</Button>
        </div>
      </Sheet>
    </Card>
  );
}
