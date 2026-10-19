// PWA и режим полёта: симулятор считает без сети (TC-40), приложение открывается без сети из кэша.
import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test('симулятор: 10 000 прогонов C6 + R1 без сети', async ({ page, context }) => {
  await openApp(page, '#/wishes');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await context.setOffline(true);

  await page.getByLabel('Цель созвездие').selectOption('6');
  await page.getByLabel('Цель сигна').selectOption('1');
  await page.getByLabel('Бюджет круток').fill('300');
  // время — от нажатия (click ждёт, пока кнопку не перестанут закрывать уведомления) до итоговой таблицы
  await page.getByRole('button', { name: /Прокрутить 10\s000 раз/ }).click();
  const started = Date.now();
  await expect(page.getByText('Результаты', { exact: true })).toBeVisible({ timeout: 30_000 });
  const elapsed = Date.now() - started;
  console.log(`10 000 прогонов C6 + R1: ${elapsed} мс`);
  expect(elapsed).toBeLessThan(3000); // M9: до 3 с на среднем телефоне

  const rows = page.getByTestId('sim-results').locator('tbody tr');
  await expect(rows).toHaveCount(8); // C0…C6 и C6 + R1
  await expect(rows.first()).toContainText('C0');
  await expect(page.getByTestId('sim-combos').locator('li').first()).toBeVisible();
  // ни одного обращения к api и data, пока сети нет
  expect(requests.filter((u) => /\/(api|data)\//.test(new URL(u).pathname))).toEqual([]);
});

test('без сети приложение открывается из кэша: оболочка — сервис-воркер, данные — IndexedDB', async ({
  page,
  context,
}) => {
  await openApp(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // страница под управлением сервис-воркера после перезагрузки
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.getByText('Загрузка…')).toHaveCount(0);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Загрузка…')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Забрал: Ежедневные поручения' })).toBeVisible();
  await page.goto('/#/forecast');
  await expect(page.getByTestId('pulls-expected')).toBeVisible();
});

test('PWA: манифест с иконками', async ({ page }) => {
  await openApp(page);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = await page.evaluate(async (h) => (await fetch(h!)).json(), href);
  expect(manifest.name).toBe('Копилка круток');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512', '512x512']);
});
