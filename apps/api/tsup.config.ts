// Прод-сборка api (D-308): один ESM-бандл dist/server.js; @primo/* — из исходников внутрь бандла,
// npm-зависимости (в т.ч. нативный argon2) — снаружи, из node_modules.
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // PGlite грузится динамически и только при DATABASE_URL=pglite:… — отдельным чанком
  splitting: true,
  noExternal: ['@primo/domain', '@primo/shared'],
  external: ['@electric-sql/pglite'],
});
