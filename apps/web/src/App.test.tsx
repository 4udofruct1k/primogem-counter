import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { makeHarness, renderApp } from './test/harness';

describe('приложение без аккаунта (M2)', () => {
  it('открывает «Сегодня» и показывает крутки', async () => {
    const h = await makeHarness();
    renderApp(h, <App />);
    expect(await screen.findByText('Копилка круток')).toBeTruthy();
    expect(screen.getByTestId('limited-pulls').textContent).toBe('0');
    expect(screen.getByText('гость')).toBeTruthy();
  });

  it('сверка через интерфейс: 5000 / 300 / 12 / 20 → 45 лимитированных и 20 стандартных (TC-08)', async () => {
    const h = await makeHarness();
    renderApp(h, <App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Сверка' }));
    const set = async (label: string, value: string) => {
      const input = screen.getByLabelText(label);
      await user.clear(input);
      await user.type(input, value);
    };
    await set('Камни Истока (примогемы)', '5000');
    await set('Кристаллы Сотворения', '300');
    await set('Переплетающиеся судьбы (IF)', '12');
    await set('Судьбоносные встречи (AF)', '20');
    await user.click(screen.getByRole('button', { name: 'Сохранить снимок' }));
    await waitFor(() => expect(screen.getByTestId('limited-pulls').textContent).toBe('45'));
    expect(screen.getByTestId('standard-pulls').textContent).toBe('20');
  });
});
