// Прод-сборка api (D-308): ESM-бандлы dist/server.js и dist/cli.js (команды оператора, D-316); @primo/* — из исходников
// внутрь бандла, npm-зависимости (в т.ч. нативный argon2) — снаружи, из node_modules.
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/cli.ts'],
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
