// Синхронизация (14.5): гость → «Сохранить в аккаунт» → второе устройство видит данные; отметки ходят в обе стороны.
import { expect, test } from '@playwright/test';
import { login, newUsername, openApp, register, syncNow } from './helpers';

test('два устройства одного аккаунта видят отметки друг друга', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const username = newUsername('e2e_sync');

  // гость отмечает дейлики, затем сохраняет данные в аккаунт (TC-47)
  await openApp(a);
  await a.getByRole('button', { name: 'Забрал: Ежедневные поручения' }).click();
  await expect(a.getByRole('button', { name: 'Вернуть: Ежедневные поручения' })).toBeVisible();
  await register(a, username);
  await syncNow(a);

  // второе устройство: вход — отметка уже там
  await login(b, username);
  await openApp(b);
  await expect(b.getByRole('button', { name: 'Вернуть: Ежедневные поручения' })).toBeVisible();

  // обратно: B снимает отметку → A после синхронизации видит снятую
  await b.getByRole('button', { name: 'Вернуть: Ежедневные поручения' }).click();
  await expect(b.getByRole('button', { name: 'Забрал: Ежедневные поручения' })).toBeVisible();
  await syncNow(b);
  await syncNow(a);
  await openApp(a);
  await expect(a.getByRole('button', { name: 'Забрал: Ежедневные поручения' })).toBeVisible();

  // экспорт содержит документы аккаунта (TC-47)
  const exported = await a.evaluate(async () =>
    (await fetch('/api/export', { credentials: 'include' })).json(),
  );
  expect(JSON.stringify(exported)).toContain('daily_commissions:');
});
