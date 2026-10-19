import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'api',
    environment: 'node',
    // PGlite (Postgres в WASM) стартует несколько секунд, под нагрузкой дольше (D-301)
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
