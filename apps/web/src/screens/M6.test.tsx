import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { makeHarness, renderApp } from '../test/harness';

async function open() {
  const h = await makeHarness();
  window.location.hash = '#/endgame';
  renderApp(h, <App />);
  await screen.findByTestId('abyss-sum');
  return { h, user: userEvent.setup() };
}

const val = (id: string) => (screen.getByTestId(id).textContent ?? '').replace(/\s/g, '');

describe('M6: эндгейм через интерфейс', () => {
  it('TC-20: бездна, звёзды этажей [9, 9, 9, 7] → 700', async () => {
    const { h, user } = await open();
    await user.click(screen.getByRole('button', { name: 'Все 36★' }));
    await waitFor(() => expect(val('abyss-sum')).toBe('800'));
    // зал 3 этажа 12: 3★ → 0★ → 1★ (два тапа): этаж 12 = 7★
    await user.click(screen.getByRole('button', { name: 'Этаж 12, зал 3' }));
    await user.click(screen.getByRole('button', { name: 'Этаж 12, зал 3' }));
    await waitFor(() => expect(val('abyss-sum')).toBe('700'));
    expect(h.store.getState().docs.abyss['abyss:2026-10']!.stars[3]).toEqual([3, 3, 1]);
  });

  it('TC-21: театр — сложная, 8 актов → 620; лунный, 10 актов + 2 арканы → 1000', async () => {
    const { user } = await open();
    await user.selectOptions(screen.getByLabelText('Сложность театра'), 'hard');
    await user.click(await screen.findByRole('button', { name: 'Акт 8' }));
    await waitFor(() => expect(val('theater-sum')).toBe('620'));
    await user.selectOptions(screen.getByLabelText('Сложность театра'), 'lunar');
    await user.click(await screen.findByRole('button', { name: 'Акт 10' }));
    await user.click(screen.getByRole('button', { name: 'Аркана 2' }));
    await waitFor(() => expect(val('theater-sum')).toBe('1000'));
  });

  it('TC-22: натиск maxDifficulty 2 → 300, 5 → 450', async () => {
    const { user } = await open();
    await user.selectOptions(screen.getByLabelText('Сложность натиска'), '2');
    await waitFor(() => expect(val('stygian-sum')).toBe('300'));
    await user.selectOptions(screen.getByLabelText('Сложность натиска'), '5');
    await waitFor(() => expect(val('stygian-sum')).toBe('450'));
  });

  it('прогресс трекера пишется в леджер разницей; «забрал» не задваивает', async () => {
    const { h, user } = await open();
    await user.click(screen.getByRole('button', { name: 'Все 36★' }));
    await waitFor(() => expect(val('abyss-sum')).toBe('800'));
    await user.click(screen.getByRole('button', { name: /^Забрал 800/ }));
    await waitFor(() => expect(h.store.getState().docs.occ_status['abyss:2026-10']?.status).toBe('claimed'));
    const primo = Object.values(h.store.getState().docs.ledger).reduce((s, e) => s + (e.delta.primo ?? 0), 0);
    expect(primo).toBe(800);
  });

  it('ожидание «Своё число» меняет прогноз бездны', async () => {
    const { h, user } = await open();
    await user.selectOptions(screen.getByLabelText('Ожидание: Витая бездна'), 'manual');
    const input = await screen.findByLabelText('Ожидание вручную: Витая бездна');
    await user.clear(input);
    await user.type(input, '650');
    await waitFor(() =>
      expect(h.store.getState().docs.settings.main!.expectations.abyss).toMatchObject({
        mode: 'manual',
        primo: 650,
      }),
    );
  });
});
