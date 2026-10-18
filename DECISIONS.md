# DECISIONS.md

Мелкие технические решения, которые спека оставляет на усмотрение разработчика (правило 6).
Формат: номер · этап · решение · почему.

## M0 — монорепо

**D-001 · M0 · TypeScript 6.0, а не 7.0.**
`typescript-eslint` 8.x поддерживает `typescript < 6.1`. TS 7 (нативный компилятор) пока несовместим с линтером.
В TS 6 `types` по умолчанию пустой — каждый пакет перечисляет нужные типы явно (`node`, `vite/client`).

**D-002 · M0 · Версии инструментов.**
Vite 8, `@vitejs/plugin-react` 6, Vitest 5, React 19, Fastify 5, ESLint 10 (flat config), Prettier 3, zod 4, Node ≥ 22.12
(минимум для Vite 8). Версии закреплены точно в `package.json`, lockfile в git.

**D-003 · M0 · Внутренние пакеты подключаются исходниками.**
`@primo/domain` и `@primo/shared` экспортируют `./src/index.ts` без отдельной сборки. Vite и tsx понимают TS напрямую;
прод-сборка `api` будет бандлить их (решение о бандлере — на этапе M3/M10).

**D-004 · M0 · Один запуск тестов на весь репозиторий.**
Корневой `vitest.config.ts` с `test.projects` (`packages/*`, `apps/*`); `pnpm test` = `vitest run` по всем проектам.
У каждого пакета свой конфиг с `name`, тесты лежат рядом с кодом (`*.test.ts`).

**D-005 · M0 · `pnpm dev`.**
`pnpm --parallel --filter @primo/api --filter @primo/web dev`: api — `tsx watch` на :3000, web — Vite на :5173 с прокси
`/api` и `/data` на :3000 (15.7). Отдельный `concurrently` не нужен.

**D-006 · M0 · Линтер следит за чистотой `domain`.**
В `packages/domain` ESLint запрещает импорты React / Fastify / Dexie / Zustand и глобалы `fetch`, `window`, `document`,
`localStorage`, `indexedDB` — ядро остаётся чистыми функциями (раздел 2, правило 3).

**D-007 · M0 · Сборочные скрипты зависимостей.**
pnpm 10 по умолчанию не запускает postinstall; разрешённые пакеты перечислены в `onlyBuiltDependencies`
(`pnpm-workspace.yaml`). Сейчас там `esbuild`; нативные модули (argon2) добавятся на M3.

**D-008 · M0 · `/api/health` до подключения БД.**
До M3 отвечает `{ ok: true, db: "unconfigured", version }`. На M3 поле `db` станет реальной проверкой (`up` / `down`).

**D-009 · M0 · Postgres для разработки слушает только 127.0.0.1.**
`deploy/compose.dev.yml` публикует порт как `127.0.0.1:5432`, чтобы dev-БД с паролем `primo` не была видна в сети.
