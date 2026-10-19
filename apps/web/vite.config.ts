/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

declare const process: { env: Record<string, string | undefined> };

/** Куда проксировать /api и /data в dev и preview; e2e поднимают api на своём порту. */
const api = process.env.PRIMO_API_URL ?? 'http://localhost:3000';
const proxy = { '/api': api, '/data': api };

export default defineConfig({
  plugins: [
    react(),
    // PWA (раздел 2): оболочка приложения в precache; /api и /data — всегда сеть (игровые данные кэшируются
    // в IndexedDB по хэшу, D-205), новая версия — по кнопке «Обновить» (D-1002).
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.ico', 'favicon-64.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Копилка круток',
        short_name: 'Копилка',
        description: 'Сколько круток есть, сколько будет к дате или баннеру и что ещё не забрано',
        lang: 'ru',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#1f2340',
        background_color: '#14121f',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,ico,svg,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/data\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
