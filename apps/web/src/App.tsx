import { useEffect, type ReactNode } from 'react';
import { EndgameScreen } from './screens/EndgameScreen';
import { ForecastScreen } from './screens/ForecastScreen';
import { MoreScreen } from './screens/MoreScreen';
import { Placeholder } from './screens/Placeholder';
import { RegionsScreen } from './screens/RegionsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TodayScreen } from './screens/TodayScreen';
import { VersionScreen } from './screens/VersionScreen';
import { WalletScreen } from './screens/WalletScreen';
import { useApp, useServices } from './state/context';
import { Button } from './ui/components';
import { href, useRoute } from './ui/router';

const NAV: [string, string, string][] = [
  ['today', 'Сегодня', '◉'],
  ['forecast', 'Прогноз', '↗'],
  ['regions', 'Регионы', '⛰'],
  ['endgame', 'Эндгейм', '✦'],
  ['more', 'Ещё', '☰'],
];

const MORE_ROUTES = new Set([
  'version',
  'timeline',
  'wishes',
  'wallet',
  'sources',
  'settings',
  'admin',
  'more',
]);

export function App() {
  const phase = useApp((s) => s.phase);
  const error = useApp((s) => s.error);
  const route = useRoute();
  const screen = route.path[0] ?? 'today';

  if (phase === 'loading') return <div className="center">Загрузка…</div>;
  if (phase === 'error')
    return (
      <div className="center">
        <h1>Не удалось загрузить данные</h1>
        <p className="muted">{error}</p>
        <Button onClick={() => window.location.reload()}>Повторить</Button>
      </div>
    );

  const navKey = MORE_ROUTES.has(screen) ? 'more' : screen;
  return (
    <div className="app">
      <TopBar />
      <main className="main">{renderScreen(screen)}</main>
      <nav className="bottomnav" aria-label="Разделы">
        {NAV.map(([id, label, ico]) => (
          <a key={id} href={href(id)} className={navKey === id ? 'active' : ''}>
            <span className="ico" aria-hidden>
              {ico}
            </span>
            {label}
          </a>
        ))}
      </nav>
      <Notices />
    </div>
  );
}

function renderScreen(screen: string): ReactNode {
  switch (screen) {
    case 'today':
      return <TodayScreen />;
    case 'wallet':
      return <WalletScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'more':
      return <MoreScreen />;
    case 'forecast':
      return <ForecastScreen />;
    case 'regions':
      return <RegionsScreen />;
    case 'endgame':
      return <EndgameScreen />;
    case 'version':
      return <VersionScreen />;
    case 'timeline':
      return <Placeholder title="Таймлайн" />;
    case 'wishes':
      return <Placeholder title="Молитвы" />;
    case 'sources':
      return <Placeholder title="Источники и оплата" />;
    case 'admin':
      return <Placeholder title="Админка данных" />;
    default:
      return <Placeholder title="Нет такой страницы" />;
  }
}

function TopBar() {
  const account = useApp((s) => s.account);
  const sync = useApp((s) => s.sync);
  const { sync: engine } = useServices();
  const label = !account
    ? 'гость'
    : sync.state === 'syncing'
      ? 'синхронизация…'
      : sync.state === 'offline'
        ? 'нет связи'
        : sync.state === 'error'
          ? 'ошибка синхронизации'
          : sync.pending
            ? `в очереди ${sync.pending}`
            : 'синхронизировано';
  return (
    <header className="topbar">
      <h1>Копилка круток</h1>
      <button
        type="button"
        className="btn btn-ghost btn-small"
        onClick={() => account && engine.syncNow()}
        title="Синхронизировать"
      >
        <span className={`sync-dot ${account ? sync.state : ''}`} /> {label}
      </button>
    </header>
  );
}

function Notices() {
  const notices = useApp((s) => s.notices);
  const dismiss = useApp((s) => s.dismiss);
  useEffect(() => {
    if (notices.length === 0) return;
    const t = setTimeout(() => dismiss(notices[0]!.id), 5000);
    return () => clearTimeout(t);
  }, [notices, dismiss]);
  return (
    <div className="notices" aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} className={`notice ${n.kind === 'error' ? 'notice-error' : ''}`}>
          <span>{n.text}</span>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => dismiss(n.id)}
            style={{ color: 'inherit' }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
