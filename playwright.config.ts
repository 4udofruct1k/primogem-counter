// e2e (раздел 2: вход, синхронизация, симулятор): api на PGlite в памяти + собранный web (vite preview, с PWA).
import { defineConfig, devices } from '@playwright/test';

const API_PORT = 3100;
const WEB_PORT = 4173;
const WEB = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: WEB,
    locale: 'ru-RU',
    timezoneId: 'Asia/Yekaterinburg',
    trace: 'retain-on-failure',
    ...devices['Pixel 7'],
  },
  webServer: [
    {
      command: 'pnpm --filter @primo/api exec tsx src/server.ts',
      url: `http://localhost:${API_PORT}/api/health`,
      env: {
        NODE_ENV: 'development',
        DATABASE_URL: 'pglite:memory',
        PORT: String(API_PORT),
        PUBLIC_ORIGIN: WEB,
        ADMIN_USERNAMES: 'e2e_admin',
        LOG_LEVEL: 'warn',
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @primo/web build && pnpm --filter @primo/web exec vite preview --port ${WEB_PORT} --strictPort`,
      url: WEB,
      env: { PRIMO_API_URL: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
