// Аккаунт (14.2): гостевой режим, регистрация («Сохранить в аккаунт»), вход, восстановление, экспорт, удаление.
import { useState } from 'react';
import { ApiFailure } from '../data/api';
import { useApp, useServices, useStoreApi } from '../state/context';
import { Button, Card, Field, Sheet, Tabs } from '../ui/components';
import { dateTime } from '../ui/format';

function errorText(e: unknown): string {
  if (e instanceof ApiFailure) {
    if (e.code === 'BAD_CREDENTIALS') return 'Неверный логин или пароль';
    if (e.code === 'CONFLICT') return 'Такой логин уже занят';
    if (e.code === 'RATE_LIMIT') return 'Слишком много попыток — подождите минуту';
    return e.message;
  }
  return String(e);
}

export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AccountCard() {
  const account = useApp((s) => s.account);
  const sync = useApp((s) => s.sync);
  const store = useStoreApi();
  const { api, sync: engine } = useServices();
  const [code, setCode] = useState<{ username: string; code: string } | null>(null);
  const [sheet, setSheet] = useState<'password' | 'delete' | null>(null);
  // выход при неотправленной очереди — только после подтверждения: локальные данные стираются (D-206)
  const [unsent, setUnsent] = useState<{ all: boolean; count: number } | null>(null);

  const signOut = async (all: boolean, force = false) => {
    await engine.syncNow();
    const count = await store.repo.pendingCount();
    if (count > 0 && !force) {
      setUnsent({ all, count });
      return;
    }
    setUnsent(null);
    await (all ? api.logoutAll() : api.logout()).catch(() => undefined);
    await store.repo.clearUserData();
    await store.getState().setAccount(null);
    await store.getState().reloadDocs();
  };

  if (!account) {
    return (
      <>
        <GuestCard onRegistered={(username, recoveryCode) => setCode({ username, code: recoveryCode })} />
        <RecoveryCodeSheet value={code} onClose={() => setCode(null)} />
      </>
    );
  }

  return (
    <Card title="Аккаунт">
      <p>
        Вы вошли как <b>{account.username}</b>
        {account.isAdmin ? ' · администратор' : ''}.
      </p>
      <p className="muted small">
        Синхронизация:{' '}
        {sync.state === 'syncing'
          ? 'идёт…'
          : sync.state === 'offline'
            ? 'нет связи'
            : sync.state === 'error'
              ? `ошибка — ${sync.message ?? ''}`
              : 'готово'}
        {sync.pending ? ` · в очереди ${sync.pending}` : ''}
        {sync.lastAt ? ` · последняя ${dateTime(sync.lastAt)}` : ''}
      </p>
      <div className="btn-row">
        <Button onClick={() => engine.syncNow()}>Синхронизировать</Button>
        <Button onClick={() => setSheet('password')}>Пароль и код восстановления</Button>
        <Button
          onClick={async () => {
            const data = await api.exportAll();
            downloadText(`primo-export-${account.username}.json`, JSON.stringify(data, null, 2));
          }}
        >
          Экспорт всех данных
        </Button>
      </div>
      <div className="btn-row">
        <Button onClick={() => signOut(false)}>Выйти</Button>
        <Button onClick={() => signOut(true)}>Выйти на всех устройствах</Button>
        <Button variant="danger" onClick={() => setSheet('delete')}>
          Удалить аккаунт
        </Button>
      </div>
      {sheet === 'password' && (
        <PasswordSheet
          username={account.username}
          onClose={() => setSheet(null)}
          onCode={(c) => setCode({ username: account.username, code: c })}
        />
      )}
      {sheet === 'delete' && <DeleteSheet onClose={() => setSheet(null)} />}
      <Sheet open={!!unsent} onClose={() => setUnsent(null)} title="Не всё отправлено">
        <p>
          На сервер не ушло изменений: <b>{unsent?.count}</b> (нет связи или сервер их не принял). После
          выхода они пропадут с этого устройства.
        </p>
        <div className="btn-row">
          <Button variant="primary" onClick={() => setUnsent(null)}>
            Остаться
          </Button>
          <Button variant="danger" onClick={() => unsent && signOut(unsent.all, true)}>
            Выйти всё равно
          </Button>
        </div>
      </Sheet>
      <RecoveryCodeSheet value={code} onClose={() => setCode(null)} />
    </Card>
  );
}

function GuestCard({ onRegistered }: { onRegistered: (username: string, code: string) => void }) {
  const store = useStoreApi();
  const { api, sync } = useServices();
  const [mode, setMode] = useState<'register' | 'login' | 'recover'>('register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [recovery, setRecovery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [askMerge, setAskMerge] = useState(false);

  const afterLogin = async (merge: boolean) => {
    const me = await api.me();
    if (merge) await store.repo.enqueueAll(new Date().toISOString());
    else await store.repo.clearUserData();
    await store.getState().setAccount(me);
    await store.getState().reloadDocs();
    await sync.syncNow();
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'register') {
        const res = await api.register(username, password);
        // «Сохранить в аккаунт»: все локальные документы уходят на сервер
        await afterLogin(true);
        onRegistered(res.user.username, res.recoveryCode);
      } else if (mode === 'login') {
        await api.login(username, password);
        const hasLocal = (await store.repo.loadAll()).length > 0;
        if (hasLocal) setAskMerge(true);
        else await afterLogin(false);
      } else {
        const res = await api.recover(username, recovery, password);
        await api.login(username, password);
        onRegistered(username, res.recoveryCode);
        // данные гостя — тот же вопрос, что и при входе (D-206)
        const hasLocal = (await store.repo.loadAll()).length > 0;
        if (hasLocal) setAskMerge(true);
        else await afterLogin(false);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Гостевой режим">
      <p className="muted small">
        Данные хранятся только в этом браузере. Аккаунт сохранит их на сервере и синхронизирует между
        устройствами.
      </p>
      <Tabs
        value={mode}
        onChange={(m) => {
          setMode(m);
          setError(null);
        }}
        items={[
          { id: 'register', label: 'Сохранить в аккаунт' },
          { id: 'login', label: 'Войти' },
          { id: 'recover', label: 'Забыл пароль' },
        ]}
      />
      <div className="grid2">
        <Field label="Логин" hint="3–32 символа: латиница, цифры, _">
          <input
            className="input"
            aria-label="Логин"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        {mode === 'recover' && (
          <Field label="Код восстановления">
            <input
              className="input"
              aria-label="Код восстановления"
              value={recovery}
              onChange={(e) => setRecovery(e.target.value)}
            />
          </Field>
        )}
        <Field
          label={mode === 'recover' ? 'Новый пароль' : 'Пароль'}
          hint={mode === 'login' ? undefined : 'от 8 символов'}
        >
          <input
            className="input"
            type="password"
            aria-label="Пароль"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
      </div>
      {error && <p className="hot small">{error}</p>}
      <div className="btn-row">
        <Button variant="primary" disabled={busy} onClick={submit}>
          {mode === 'register' ? 'Зарегистрироваться' : mode === 'login' ? 'Войти' : 'Сменить пароль'}
        </Button>
      </div>
      <Sheet open={askMerge} onClose={() => setAskMerge(false)} title="Данные этого браузера">
        <p>В этом браузере есть данные гостевого режима. Перенести их в аккаунт?</p>
        <p className="muted small">Если документ уже есть в аккаунте, останется версия из аккаунта.</p>
        <div className="btn-row">
          <Button variant="primary" onClick={() => afterLogin(true).finally(() => setAskMerge(false))}>
            Перенести в аккаунт
          </Button>
          <Button onClick={() => afterLogin(false).finally(() => setAskMerge(false))}>
            Только данные аккаунта
          </Button>
        </div>
      </Sheet>
    </Card>
  );
}

function RecoveryCodeSheet({
  value,
  onClose,
}: {
  value: { username: string; code: string } | null;
  onClose: () => void;
}) {
  if (!value) return null;
  const pretty = value.code.replace(/(.{4})(?=.)/g, '$1-');
  return (
    <Sheet open onClose={onClose} title="Код восстановления">
      <p>Сохраните код — он показывается один раз. По нему можно сбросить пароль.</p>
      <p
        className="num"
        style={{ fontSize: 22, fontWeight: 700, letterSpacing: 1 }}
        data-testid="recovery-code"
      >
        {pretty}
      </p>
      <div className="btn-row">
        <Button
          variant="primary"
          onClick={() =>
            downloadText(
              `primo-recovery-${value.username}.txt`,
              `Копилка круток\nЛогин: ${value.username}\nКод восстановления: ${pretty}\n`,
            )
          }
        >
          Скачать код
        </Button>
        <Button onClick={onClose}>Я сохранил</Button>
      </div>
    </Sheet>
  );
}

function PasswordSheet({
  username,
  onClose,
  onCode,
}: {
  username: string;
  onClose: () => void;
  onCode: (c: string) => void;
}) {
  const { api } = useServices();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Sheet open onClose={onClose} title={`Пароль — ${username}`}>
      <Field label="Текущий пароль">
        <input
          className="input"
          type="password"
          aria-label="Текущий пароль"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </Field>
      <Field label="Новый пароль" hint="от 8 символов">
        <input
          className="input"
          type="password"
          aria-label="Новый пароль"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </Field>
      {msg && <p className="small">{msg}</p>}
      <div className="btn-row">
        <Button
          variant="primary"
          onClick={() =>
            api.changePassword(current, next).then(
              () => setMsg('Пароль изменён'),
              (e) => setMsg(errorText(e)),
            )
          }
        >
          Сменить пароль
        </Button>
        <Button
          onClick={() =>
            api.newRecoveryCode(current).then(
              (r) => {
                onClose();
                onCode(r.recoveryCode);
              },
              (e) => setMsg(errorText(e)),
            )
          }
        >
          Новый код восстановления
        </Button>
      </div>
    </Sheet>
  );
}

function DeleteSheet({ onClose }: { onClose: () => void }) {
  const store = useStoreApi();
  const { api } = useServices();
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Sheet open onClose={onClose} title="Удалить аккаунт">
      <p>Аккаунт и все данные на сервере будут удалены без возможности восстановления.</p>
      <Field label="Пароль">
        <input
          className="input"
          type="password"
          aria-label="Пароль для удаления"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {msg && <p className="hot small">{msg}</p>}
      <div className="btn-row">
        <Button
          variant="danger"
          onClick={async () => {
            try {
              await api.deleteAccount(password);
              await store.repo.clearUserData();
              await store.getState().setAccount(null);
              await store.getState().reloadDocs();
              onClose();
            } catch (e) {
              setMsg(errorText(e));
            }
          }}
        >
          Удалить навсегда
        </Button>
        <Button onClick={onClose}>Отмена</Button>
      </div>
    </Sheet>
  );
}
