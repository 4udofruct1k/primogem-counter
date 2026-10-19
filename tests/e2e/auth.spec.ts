// Вход (14.2, TC-45): регистрация → код восстановления один раз → выход → вход → «Забыл пароль».
import { expect, test } from '@playwright/test';
import { login, newUsername, openApp, PASSWORD, register } from './helpers';

test('регистрация, выход, вход и восстановление пароля по коду', async ({ page }) => {
  const username = newUsername('e2e_auth');
  const code = await register(page, username);
  expect(code).toMatch(/^[\w]{4}(-[\w]{1,4})+$/);
  // код больше не показывается
  await expect(page.getByTestId('recovery-code')).toHaveCount(0);

  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByText('Гостевой режим')).toBeVisible();

  // неверный пароль — понятная ошибка
  await page.getByRole('tab', { name: 'Войти' }).click();
  await page.getByLabel('Логин').fill(username);
  await page.getByLabel('Пароль').fill('не-тот-пароль');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByText('Неверный логин или пароль')).toBeVisible();

  await login(page, username);
  // сессия переживает перезагрузку
  await page.reload();
  await expect(page.getByText(`Вы вошли как ${username}`)).toBeVisible();

  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await page.getByRole('tab', { name: 'Забыл пароль' }).click();
  await page.getByLabel('Логин').fill(username.toUpperCase());
  await page.getByLabel('Код восстановления').fill(code);
  await page.getByLabel('Пароль').fill(`${PASSWORD}-new`);
  await page.getByRole('button', { name: 'Сменить пароль' }).click();
  const second = (await page.getByTestId('recovery-code').textContent()) ?? '';
  expect(second).not.toBe(code);
  await page.getByRole('button', { name: 'Я сохранил' }).click();
  await expect(page.getByText(/Вы вошли как/)).toBeVisible();
});

test('повторная регистрация того же логина в другом регистре → «логин занят»', async ({ page }) => {
  const username = newUsername('e2e_dup');
  await register(page, username);
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await openApp(page, '#/settings');
  await page.getByRole('tab', { name: 'Сохранить в аккаунт' }).click();
  await page.getByLabel('Логин').fill(username.toUpperCase());
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page.getByText('Такой логин уже занят')).toBeVisible();
});
