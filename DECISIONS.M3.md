# DECISIONS.M3.md

Фрагмент для DECISIONS.md — решения этапа M3 (api). Формат тот же: номер · этап · решение · почему.

## M3 — api

**D-301 · M3 · Postgres в тестах API — PGlite.**
Docker-демона в окружении нет, поэтому `testcontainers` (15.7) недоступен; `pg-mem` — эмулятор без `citext` и
`SELECT … FOR UPDATE`. PGlite 0.5 — настоящий PostgreSQL (WASM) в процессе, с `contrib/citext`; тесты гоняют те же
SQL-миграции, что и прод. Приложение не зависит от драйвера: `buildApp({ config, db })`, где `db` — drizzle
`PgDatabase`; прод и `pnpm dev` — node-postgres по `DATABASE_URL`, тесты — `drizzle-orm/pglite`.
`DATABASE_URL=pglite:memory` или `pglite:<папка>` — запуск без Docker для разработки (PGlite — dev-зависимость,
грузится лениво). PGlite собран из PG 18 — миграции используют только возможности PG 16.

**D-302 · M3 · Миграции.** drizzle-kit в `apps/api/drizzle/`: `0000_citext` — ручная
(`CREATE EXTENSION IF NOT EXISTS citext`; расширение доверенное, суперпользователь не нужен), `0001_init` — из
`src/db/schema.ts`. Применяются при старте сервера (drizzle migrator). Папка — `../drizzle` от `src/` или `dist/`,
либо `MIGRATIONS_DIR`. Новые миграции: `pnpm --filter @primo/api db:generate`.

**D-303 · M3 · Сессии.** Cookie `sid` — 256-битный токен (base64url); в `sessions.id` хранится его SHA-256, чтобы
утечка таблицы не давала войти. Срок `SESSION_TTL_DAYS` (30); когда осталось меньше половины — продление на полный
срок и новая cookie. Истёкшая сессия удаляется при обращении и при следующем входе пользователя. `Secure` по
умолчанию только в production (`COOKIE_SECURE` переопределяет), `Path=/`.

**D-304 · M3 · Лимиты и CSRF.** `@fastify/rate-limit`, счётчики в памяти (api — одна копия). Вход, восстановление и
всё, что проверяет пароль (смена пароля, новый код, удаление аккаунта): 5 в минуту на IP и 10 в час на логин, счётчики
общие; считаются все попытки. Регистрация — 10 в час на IP (argon2id на 64 MiB дорог). Готовые хуки плагина на один
маршрут ставят только один лимит (общий флаг «уже проверено»), поэтому — `createRateLimit` и своя цепочка в preHandler.
IP клиента — `trustProxy`: верим X-Forwarded-For только от loopback и частных адресов (Caddy в docker-сети,
`TRUST_PROXY`). Origin: `PUBLIC_ORIGIN` (список) и `https://$DOMAIN`, вне production ещё Vite `:5173`; нет Origin или
чужой → 403 FORBIDDEN (браузеры шлют Origin на любой POST/PUT/DELETE).

**D-305 · M3 · Sync: отклонения по документу.** Запрос не по `SyncRequestSchema` (коллекция, > 500 изменений) →
400 VALIDATION целиком. Документ не по схеме своей коллекции (`parseDoc`) и удаление из `ledger` / `wallet_snapshot`
не сохраняются и возвращаются в новом поле ответа `rejected: [{ collection, id, message }]`; остальные изменения
запроса применяются — один битый документ не блокирует очередь. Хранится документ после zod (лишние поля отброшены).

**D-306 · M3 · Sync: версии и курсор.** Одна транзакция на запрос; первым — `SELECT … FOR UPDATE` строки `users`:
записи одного пользователя идут по очереди, и клиент не проскочит курсором чужую незакоммиченную запись с меньшим seq.
Нет документа на сервере = `{ data: null, version: 0, deleted: true }`: правка с `baseVersion > 0` — конфликт;
удаление документа, которого не было (создан и удалён офлайн), — запись-надгробие version 1. Append-only: существующий
id → в `applied` с текущими version и seq без изменений, `baseVersion` не проверяется. Ответ — до 1000 изменений по
seq, дальше `more: true` и курсор = последний отданный seq, иначе курсор = max seq пользователя. Курсор больше max seq
(БД восстановлена из бэкапа) → отдаём всё с нуля.

**D-307 · M3 · Аккаунт.** Код восстановления — 16 символов из A–Z и 2–9 без 0/O/1/I/L (~79 бит), argon2id-хэш.
`recover` выдаёт новый код и закрывает все сессии (клиент затем сам вызывает `login`). Смена пароля закрывает
остальные сессии, текущая остаётся. Новый код — `POST /api/auth/recovery-code { password }`. Неверный текущий пароль —
401 BAD_CREDENTIALS. Неизвестный логин сверяется с фиктивным хэшем — время ответа не выдаёт, есть ли логин.
Регистрация отвечает 201. argon2id в проде — m 64 MiB, t 3, p 1, через env не меняется; облегчённые параметры только
в объекте `Config` тестов. Одновременно считается не больше `UV_THREADPOOL_SIZE` (4) хэшей — до 256 МБ памяти.

**D-308 · M3 · Игровые данные и админка.** Манифест собирается на лету: датапак — самый новый
`data/datapack-*.json` по имени; SHA-256 файлов кэшируется по mtime и размеру (правка файла видна без перезапуска);
`Cache-Control: no-cache`. Статика `data/*.json` (только `.json`) — `public, max-age=300`: файлы с датой в имени
тоже правятся на месте (D-125). Патчи админки — таблица `admin_patches` (version pk, jsonb, `created_by` → users,
on delete set null); каждое сохранение — новая версия, старые не меняются. `/data/patch-<n>.json` отдаётся из БД с
`immutable`, хэш в манифесте — от той же JSON-строки. PUT: схема патча → `applyDatapackPatch` → `DatapackSchema`
итога → `baseVersion` = последней версии, иначе 409 (гонку двух сохранений ловит первичный ключ → тоже 409).
Админы — `ADMIN_USERNAMES`. Для M10: Caddyfile из 15.3 раздаёт `/data/*` сам с диска, а манифест и патчи теперь
живут в api — `/data/*` нужно проксировать в api (или хотя бы `manifest.json` и `patch-*.json`).

**D-309 · M3 · Прод-сборка.** tsup → ESM `dist/server.js`; `@primo/domain`, `@primo/shared` (и luxon) внутри бандла,
npm-зависимости api — снаружи (образу нужен `node_modules` с prod-зависимостями api; argon2 — готовый нативный
бинарник), PGlite — отдельный ленивый чанк. `start` = `node dist/server.js`; пути по умолчанию считаются от
`import.meta.dirname` (`src/` и `dist/` на одном уровне). SIGTERM/SIGINT — корректная остановка с закрытием пула.
`@node-rs/argon2` ставится готовым бинарником платформы без postinstall — `onlyBuiltDependencies` (D-007) не меняется.

**D-310 · M3 · Ошибки и логи.** Ошибки Fastify (413 — тело больше 1 МБ, 415, битый JSON) → код VALIDATION с исходным
статусом; любой неизвестный путь → 404 NOT_FOUND; прочее → 500 INTERNAL с записью в лог. Логи — JSON (pino), redact:
cookie, set-cookie, тела запросов, поля `password`, `newPassword`, `currentPassword`, `recoveryCode`.

**D-311 · M3 · Дополнения к API 14.4.** `GET /api/docs/:collection/:id` — свой неудалённый документ или 404;
`POST /api/auth/recovery-code`; `GET` / `PUT /api/admin/patch`; `/api/me` отдаёт `isAdmin`. `/api/health` при
недоступной БД — 503 `{ ok: false, db: "down" }` (закрывает D-008).
