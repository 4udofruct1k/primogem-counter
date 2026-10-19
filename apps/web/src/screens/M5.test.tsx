import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { makeHarness, renderApp, type Harness } from '../test/harness';

const text = (id: string) => (screen.getByTestId(id).textContent ?? '').replace(/\s+/g, ' ').trim();
const card = (catId: string) => within(screen.getByTestId(`cat-${catId}`));

async function open(route: string): Promise<{ h: Harness; user: ReturnType<typeof userEvent.setup> }> {
  const h = await makeHarness();
  window.location.hash = route;
  renderApp(h, <App />);
  await screen.findByText('Копилка круток');
  return { h, user: userEvent.setup() };
}

async function clickTimes(user: ReturnType<typeof userEvent.setup>, el: HTMLElement, n: number) {
  for (let i = 0; i < n; i++) await user.click(el);
}

const ledgerSum = (h: Harness) => Object.values(h.store.getState().docs.ledger).map((e) => e.delta);

describe('M5: регионы через интерфейс', () => {
  it('TC-15: «Богатый low +2» × 3 и «Драгоценный high +10» → 16, остаток 771', async () => {
    const { user } = await open('#/regions/mondstadt?area=mondstadt_main');
    const c = card('mondstadt_main:chests');
    await clickTimes(user, c.getByRole('button', { name: 'Богатый low +2' }), 3);
    await user.click(c.getByRole('button', { name: 'Драгоценный high +10' }));
    await waitFor(() => expect(text('remaining-mondstadt_main:chests')).toBe('771'));
    expect(text('collected-mondstadt_main:chests')).toMatch(/^16 /);
  });

  it('TC-16: «Сундуки 100%» → 787, снять → снова 16, счётчики целы', async () => {
    const { h, user } = await open('#/regions/mondstadt?area=mondstadt_main');
    const c = card('mondstadt_main:chests');
    await clickTimes(user, c.getByRole('button', { name: 'Богатый low +2' }), 3);
    await user.click(c.getByRole('button', { name: 'Драгоценный high +10' }));
    await user.click(screen.getByLabelText('Сундуки 100%'));
    await waitFor(() => expect(text('collected-mondstadt_main:chests')).toMatch(/^787 /));
    await user.click(screen.getByLabelText('Сундуки 100%'));
    await waitFor(() => expect(text('collected-mondstadt_main:chests')).toMatch(/^16 /));
    expect(h.store.getState().docs.cat_progress['mondstadt_main:chests']!.chestCounts).toEqual({
      exquisite: { low: 3 },
      precious: { high: 1 },
    });
  });

  it('TC-16a: роскошный «+10» × 1 и «+40» × 2 → +90; «отменить последнее» снимает одно «+40»', async () => {
    const { h, user } = await open('#/regions/mondstadt?area=mondstadt_main');
    const c = card('mondstadt_main:chests');
    await user.click(c.getByRole('button', { name: 'Роскошный +10' }));
    await clickTimes(user, c.getByRole('button', { name: 'Роскошный +40' }), 2);
    await waitFor(() => expect(text('collected-mondstadt_main:chests')).toMatch(/^90 /));
    await user.click(c.getByRole('button', { name: 'Отменить последнее' }));
    await waitFor(() => expect(text('collected-mondstadt_main:chests')).toMatch(/^50 /));
    expect(h.store.getState().docs.cat_progress['mondstadt_main:chests']!.chestCounts).toEqual({
      luxurious: { '10': 1, '40': 1 },
    });
  });

  it('TC-17: статуя Натлана ур. 7 → 600 + 3 AF', async () => {
    const { user } = await open('#/regions/natlan');
    await clickTimes(user, card('natlan_main:statue').getByRole('button', { name: 'Статуя (уровни) +' }), 7);
    await waitFor(() => expect(text('collected-natlan_main:statue')).toMatch(/^600 · 3 AF/));
  });

  it('TC-18: Пламя Тоны ур. 9 → 450 + 4 AF', async () => {
    const { user } = await open('#/regions/natlan');
    const input = card('natlan_main:offering').getByLabelText('Пламя Тоны: уровень');
    await user.clear(input);
    await user.type(input, '9');
    await waitFor(() => expect(text('collected-natlan_main:offering')).toMatch(/^450 · 4 AF/));
  });

  it('TC-19: места встреч × 6, уровни [5, 5, 3, 0, 0, 0] → 650 + 5 AF', async () => {
    const { user } = await open('#/regions/nodkrai');
    const c = card('nodkrai_main:offering');
    await clickTimes(user, c.getByRole('button', { name: 'Места встреч 1 +' }), 5);
    await clickTimes(user, c.getByRole('button', { name: 'Места встреч 2 +' }), 5);
    await clickTimes(user, c.getByRole('button', { name: 'Места встреч 3 +' }), 3);
    await waitFor(() => expect(text('collected-nodkrai_main:offering')).toMatch(/^650 · 5 AF/));
    expect(c.getByRole('button', { name: 'Места встреч 1 +' })).toHaveProperty('disabled', true);
  });

  it('TC-23: сайд-квесты 200 при итоге 160 — предупреждение, остаток 0', async () => {
    const { user } = await open('#/regions/mondstadt?area=mondstadt_main');
    const c = card('mondstadt_main:side_quests');
    const input = c.getByLabelText('Сайд-квесты (мировые задания): всего');
    await user.clear(input);
    await user.type(input, '200');
    await waitFor(() => expect(text('remaining-mondstadt_main:side_quests')).toBe('0'));
    expect(c.getByText(/Больше итога из данных/)).toBeTruthy();
    expect(text('collected-mondstadt_main:side_quests')).toMatch(/^200 /);
  });

  it('TC-25: Сумеру — бейджа нет; без категории статуи — «сумма строк ≠ итог видео»', async () => {
    const { user } = await open('#/regions/sumeru');
    expect(screen.queryByText('сумма строк ≠ итог видео')).toBeNull();
    await user.click(card('sumeru_main:statue').getByRole('button', { name: 'Убрать категорию' }));
    expect(await screen.findByText('сумма строк ≠ итог видео')).toBeTruthy();
  });

  it('TC-26: «Область закрыта» на Драконьем хребте, затем снять', async () => {
    const { user } = await open('#/regions/mondstadt?area=dragonspine');
    const tree = card('dragonspine:offering');
    await clickTimes(user, tree.getByRole('button', { name: 'Древо мерзлоты +' }), 3);
    await clickTimes(
      user,
      card('dragonspine:waypoints').getByRole('button', { name: 'Точки телепортации +' }),
      5,
    );
    const quests = card('dragonspine:side_quests').getByLabelText('Сайд-квесты (мировые задания): всего');
    await user.clear(quests);
    await user.type(quests, '100');

    await user.click(screen.getByLabelText('Область закрыта'));
    await waitFor(() => expect(text('stepper-Древо мерзлоты')).toMatch(/^12/));
    expect(text('stepper-Точки телепортации')).toMatch(/^13/);
    expect(
      (
        card('dragonspine:side_quests').getByLabelText(
          'Сайд-квесты (мировые задания): всего',
        ) as HTMLInputElement
      ).value,
    ).toBe('270');
    expect(text('area-remaining')).toBe('0');

    await user.click(screen.getByLabelText('Область закрыта'));
    await waitFor(() => expect(text('stepper-Древо мерзлоты')).toMatch(/^3/));
    expect(text('stepper-Точки телепортации')).toMatch(/^5/);
    expect(
      (
        card('dragonspine:side_quests').getByLabelText(
          'Сайд-квесты (мировые задания): всего',
        ) as HTMLInputElement
      ).value,
    ).toBe('100');
  });

  it('TC-27: autoApply — статуя Натлана 0 → 4: +300 primo +1 AF; 4 → 3: −100', async () => {
    const { h, user } = await open('#/regions/natlan');
    const c = card('natlan_main:statue');
    const sum = () =>
      ledgerSum(h).reduce((a, d) => ({ primo: a.primo + (d.primo ?? 0), af: a.af + (d.af ?? 0) }), {
        primo: 0,
        af: 0,
      });
    await clickTimes(user, c.getByRole('button', { name: 'Статуя (уровни) +' }), 4);
    await waitFor(() => expect(sum()).toEqual({ primo: 300, af: 1 }));
    const before = ledgerSum(h).length;
    await user.click(c.getByRole('button', { name: 'Статуя (уровни) −' }));
    await waitFor(() => expect(ledgerSum(h)).toHaveLength(before + 1));
    const last = Object.values(h.store.getState().docs.ledger)
      .sort((a, b) => a.at.localeCompare(b.at))
      .at(-1)!;
    expect(last.delta).toEqual({ primo: -100 });
    expect(last.reason).toBe('progress');
  });

  it('список регионов: остаток и переход в регион', async () => {
    const { user } = await open('#/regions');
    expect(screen.getByTestId('region-mondstadt').textContent).toMatch(/осталось/);
    await user.click(screen.getByTestId('region-liyue'));
    expect(await screen.findByRole('heading', { name: 'Ли Юэ' })).toBeTruthy();
  });

  it('своя категория и переименование', async () => {
    const { user } = await open('#/regions/contested');
    await user.click(screen.getByRole('button', { name: '+ область' }));
    await user.type(screen.getByLabelText('Название области'), 'Моя область');
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    await user.click(await screen.findByRole('button', { name: '+ категория' }));
    await user.type(screen.getByLabelText('Название категории'), 'Мой квест');
    await user.clear(screen.getByLabelText('Итог категории'));
    await user.type(screen.getByLabelText('Итог категории'), '60');
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    expect(await screen.findByText('Мой квест')).toBeTruthy();
  });
});
