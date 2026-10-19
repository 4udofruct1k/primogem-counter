import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'e2e-пароль-123';

/** Уникальный логин: латиница, цифры, _ (14.2). */
export function newUsername(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.slice(0, 32);
}

/** Приложение загрузилось: игровые данные на месте, «Сегодня» на экране. */
export async function openApp(page: Page, hash = '#/today'): Promise<void> {
  await page.goto(`/${hash}`);
  await expect(page.getByText('Загрузка…')).toHaveCount(0, { timeout: 30_000 });
}

export async function register(page: Page, username: string): Promise<string> {
  await openApp(page, '#/settings');
  await page.getByRole('tab', { name: 'Сохранить в аккаунт' }).click();
  await page.getByLabel('Логин').fill(username);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  const code = (await page.getByTestId('recovery-code').textContent()) ?? '';
  await page.getByRole('button', { name: 'Я сохранил' }).click();
  await expect(page.getByText(`Вы вошли как ${username}`)).toBeVisible();
  return code;
}

export async function login(page: Page, username: string, password = PASSWORD): Promise<void> {
  await openApp(page, '#/settings');
  await page.getByRole('tab', { name: 'Войти' }).click();
  await page.getByLabel('Логин').fill(username);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByText(`Вы вошли как ${username}`)).toBeVisible();
}

/** Синхронизация вручную и ожидание «готово» без очереди. */
export async function syncNow(page: Page): Promise<void> {
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Синхронизировать' }).click();
  await expect(page.getByText(/Синхронизация: готово/)).toBeVisible();
  await expect(page.getByText(/в очереди/)).toHaveCount(0);
}
