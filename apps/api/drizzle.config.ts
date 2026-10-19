// drizzle-kit: генерация SQL-миграций из src/db/schema.ts (pnpm --filter @primo/api db:generate).
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://primo:primo@localhost:5432/primo' },
});
