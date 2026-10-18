# Копилка круток

Genshin pull planner: сколько круток есть, сколько будет к дате или баннеру и что ещё не забрано.
Спецификация — [PRIMO_SPEC.md](PRIMO_SPEC.md), технические решения — [DECISIONS.md](DECISIONS.md).

## Структура

```
apps/web         React + Vite, PWA (клиент; все игровые расчёты — здесь)
apps/api         Fastify: аккаунты, синхронизация, раздача /data
packages/domain  чистое ядро расчётов (без React и сети)
packages/shared  zod-схемы и общие типы клиента и сервера
data/            игровые данные: датапак и seed регионов
deploy/          docker compose, Caddy, бэкапы
```

## Разработка

Нужны Node 22.12+ и pnpm 10.

```bash
pnpm install
docker compose -f deploy/compose.dev.yml up -d db   # Postgres на localhost:5432 (понадобится с M3)
pnpm dev        # web http://localhost:5173 (прокси /api и /data), api http://localhost:3000
pnpm test       # Vitest по всем пакетам
pnpm lint       # ESLint
pnpm typecheck  # tsc во всех пакетах
```
