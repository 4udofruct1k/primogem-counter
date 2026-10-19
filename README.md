# Копилка круток

Genshin pull planner: сколько круток есть, сколько будет к дате или баннеру и что ещё не забрано.
Сайт (PWA) с простой регистрацией: данные пользователя хранятся на сервере, все игровые расчёты — в браузере.

Спецификация — [PRIMO_SPEC.md](PRIMO_SPEC.md), технические решения — [DECISIONS.md](DECISIONS.md).

## Структура

```
apps/web         React + Vite, PWA (клиент; прогноз, регионы, эндгейм, симулятор — здесь)
apps/api         Fastify: аккаунты, синхронизация, экспорт, раздача /data, патч админки
packages/domain  чистое ядро расчётов (без React и сети), в т.ч. симулятор молитв gacha/
packages/shared  zod-схемы и общие типы клиента и сервера
data/            игровые данные: датапак и seed регионов
deploy/          docker compose, Caddy, бэкапы
tests/           e2e (Playwright)
```

## Разработка

Нужны Node 22.12+ и pnpm 10.

```bash
pnpm install
docker compose -f deploy/compose.dev.yml up -d db   # Postgres на localhost:5432
pnpm dev        # web http://localhost:5173 (прокси /api и /data на :3000), api http://localhost:3000
pnpm test       # Vitest: domain, shared, api, web
pnpm lint       # ESLint
pnpm typecheck  # tsc во всех пакетах
pnpm e2e        # Playwright (поднимает api на PGlite и web сам)
```

Без Docker api можно запустить на Postgres в WASM: `DATABASE_URL=pglite:memory pnpm dev`.

## Деплой (раздел 15)

VPS с Ubuntu 24.04, Docker Engine + compose-плагин, git; A-запись `primo.<домен>` → IP сервера; открыты 80 и 443.

```bash
# первый запуск
git clone <repo> primo && cd primo/deploy
cp .env.example .env && nano .env              # домен и пароль БД
docker compose -f compose.prod.yml up -d --build
curl https://$DOMAIN/api/health                # {"ok":true,"db":"up",...}

# обновление кода или игровых данных
git pull
docker compose -f compose.prod.yml up -d --build   # миграции применятся при старте api
```

`$DOMAIN` в `curl` — переменная вашей оболочки: `export DOMAIN=primo.example.ru` или подставьте домен.
Пароль БД удобно сгенерировать так: `openssl rand -hex 24`. Администраторы данных — логины в `ADMIN_USERNAMES`.

Сервисы: `db` (Postgres 16, том `pgdata`), `api` (Node 22, миграции при старте), `web` (одноразовая сборка статики в том
`webdist`), `caddy` (HTTPS, статика, `/api/*`), `backup` (ежедневный `pg_dump` в 04:30 по UTC+5, хранится 14 дней в
`deploy/backups/`).

Если на сервере уже работает Caddy другого проекта, второй Caddy поднимать нельзя: добавьте блок сайта из
`deploy/Caddyfile` в существующий Caddyfile и подключите сервисы `api` и `db` к той же docker-сети.

### Бэкапы и восстановление

```bash
docker compose -f compose.prod.yml exec backup backup.sh          # дамп вручную
docker compose -f compose.prod.yml exec -T db pg_restore -U primo -d primo --clean < backups/primo-YYYY-MM-DD.dump
```

Рекомендуется раз в сутки копировать `deploy/backups/` на внешнее хранилище (rclone или `scp`) и раз в месяц проверять
восстановление в отдельную БД `primo_check`.

### Наблюдение

- `GET /api/health` — для внешнего пинга (UptimeRobot или аналог) раз в 5 минут;
- `docker compose -f compose.prod.yml logs -f api caddy` — JSON-логи без паролей и кодов восстановления;
- раз в месяц: `apt upgrade`, `docker compose -f compose.prod.yml pull`.
