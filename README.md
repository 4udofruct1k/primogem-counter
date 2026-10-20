# Копилка круток

Genshin pull planner: сколько круток есть, сколько будет к дате или баннеру и что ещё не забрано.
Сайт (PWA) с простой регистрацией: данные пользователя хранятся на сервере, все игровые расчёты — в браузере.
Ставится на телефон («Добавить на главный экран»), без сети открывается из кэша; симулятор молитв работает в режиме
полёта.

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
pnpm e2e        # Playwright: api на PGlite (:3100) + собранный web через vite preview (:4173), эмуляция телефона
```

e2e проверяют вход, выход и восстановление по коду, синхронизацию двух устройств, симулятор без сети (10 000
прогонов C6 + R1 быстрее 3 с) и открытие приложения без сети из кэша сервис-воркера.

Без Docker api можно запустить на Postgres в WASM: `DATABASE_URL=pglite:memory pnpm dev`.

Права админа данных в разработке — та же команда оператора, что и в проде (D-316), по `DATABASE_URL` запущенного api:
`pnpm --filter @primo/api exec tsx src/cli.ts admin grant <логин>`. С `pglite:memory` она недоступна — база живёт
внутри процесса api; используйте Postgres из `compose.dev.yml` или `pglite:<папка>` при остановленном api.

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
Пароль БД удобно сгенерировать так: `openssl rand -hex 24`. Администраторов данных назначает оператор командой — см.
«Администраторы данных» ниже.
Квоты аккаунта — `USER_MAX_DOCS` (200 000 документов) и `USER_MAX_MB` (32 МБ данных), обе с запасом на годы
обычной игры (D-312).

Сервисы: `db` (Postgres 16, том `pgdata`), `api` (Node 22, миграции при старте), `web` (одноразовая сборка статики в том
`webdist`), `caddy` (HTTPS, статика, `/api/*`), `backup` (ежедневный `pg_dump` в 04:30 по UTC+5, хранится 14 дней в
`deploy/backups/`).

Если на сервере уже работает Caddy другого проекта, второй Caddy поднимать нельзя: добавьте блок сайта из
`deploy/Caddyfile` в существующий Caddyfile и подключите сервисы `api` и `db` к той же docker-сети.

### Администраторы данных

Админка данных (шаблон ивентов и патч датапака — его получают все пользователи) доступна только аккаунтам, которым
права выдал оператор сервера (D-316). Логин сам по себе прав не даёт: занять свободный логин может кто угодно.

1. Зарегистрируйтесь на сайте и сохраните код восстановления.
2. Выдайте права своему аккаунту и сверьте в ответе дату регистрации — это должен быть именно ваш аккаунт.

```bash
docker compose -f compose.prod.yml exec api node dist/cli.js admin grant <логин>
docker compose -f compose.prod.yml exec api node dist/cli.js admin list             # кто сейчас админ
docker compose -f compose.prod.yml exec api node dist/cli.js admin revoke <логин>   # снять права
```

Права действуют сразу, без повторного входа, и принадлежат аккаунту, а не логину: после удаления аккаунта тот, кто
займёт его логин, админом не станет. Переменная `ADMIN_USERNAMES` больше не читается: если она осталась в
`deploy/.env`, api пишет предупреждение при старте — выдайте права командой выше и удалите строку.

### Бэкапы и восстановление

Дампы лежат в `deploy/backups/` с правами `600`, владелец — тот же, что у папки (пользователь, клонировавший
репозиторий): в них хэши паролей.

```bash
docker compose -f compose.prod.yml exec backup backup.sh          # дамп вручную
docker compose -f compose.prod.yml exec -T db pg_restore -U primo -d primo --clean < backups/primo-YYYY-MM-DD.dump
```

Восстановление меняет эпоху данных (D-315): клиент, который присылает свою эпоху в `/api/sync`, получает все свои
данные заново, даже если его курсор ушёл дальше восстановленной последовательности, — других шагов не нужно.
Если дамп снят до последней миграции, после восстановления перезапустите api, чтобы миграции применились снова:
`docker compose -f compose.prod.yml restart api`. В дампе старше миграции `0003_admin_flag` админов нет — после
перезапуска выдайте права заново (`admin grant`).

Рекомендуется раз в сутки копировать `deploy/backups/` на внешнее хранилище (rclone или `scp`) и раз в месяц проверять
восстановление в отдельную БД `primo_check`:

```bash
docker compose -f compose.prod.yml exec -T db createdb -U primo primo_check
docker compose -f compose.prod.yml exec -T db pg_restore -U primo -d primo_check < backups/primo-YYYY-MM-DD.dump
docker compose -f compose.prod.yml exec -T db psql -U primo -d primo_check -tAc 'select count(*) from users'
docker compose -f compose.prod.yml exec -T db dropdb -U primo primo_check
```

### Наблюдение

- `GET /api/health` — для внешнего пинга (UptimeRobot или аналог) раз в 5 минут;
- `docker compose -f compose.prod.yml logs -f api caddy` — JSON-логи без паролей и кодов восстановления;
- раз в месяц: `apt upgrade`, `docker compose -f compose.prod.yml pull`.
