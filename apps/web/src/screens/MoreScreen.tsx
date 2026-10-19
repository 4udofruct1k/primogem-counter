import { useApp } from '../state/context';
import { Card } from '../ui/components';
import { href } from '../ui/router';

const LINKS: [string, string, string][] = [
  ['version', 'Версия', 'все награды текущей версии'],
  ['timeline', 'Таймлайн', 'версии, баннеры, ивенты, дедлайны'],
  ['wishes', 'Молитвы', 'симулятор шансов'],
  ['wallet', 'Кошелёк', 'снимки, леджер, траты, pity'],
  ['sources', 'Источники и оплата', 'луна, БП, пополнения, правила'],
  ['settings', 'Настройки и аккаунт', 'сервер, учёт, синхронизация'],
];

export function MoreScreen() {
  const isAdmin = useApp((s) => s.account?.isAdmin ?? false);
  const links = isAdmin
    ? [...LINKS, ['admin', 'Админка данных', 'шаблон ивентов и патчи датапака'] as [string, string, string]]
    : LINKS;
  return (
    <Card title="Ещё">
      <ul className="list">
        {links.map(([id, title, sub]) => (
          <li key={id} className="row">
            <a className="row-main" href={href(id)} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="row-title">{title}</div>
              <div className="row-sub">{sub}</div>
            </a>
            <span className="muted">›</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
