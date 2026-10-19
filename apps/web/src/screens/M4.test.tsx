import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { createApi } from '../data/api';
import { createSync } from '../data/sync';
import { fakeSyncServer } from '../test/fakeServer';
import { dataServer, makeHarness, renderApp } from '../test/harness';

describe('M4: «Сегодня»', () => {
  it('отметка дейликов: строка становится забранной, документ и запись леджера сохранены', async () => {
    const h = await makeHarness();
    window.location.hash = '#/today';
    renderApp(h, <App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Забрал: Ежедневные поручения' }));
    await waitFor(() =>
      expect(h.store.getState().docs.occ_status['daily_commissions:2026-10-19']?.status).toBe('claimed'),
    );
    const ledger = Object.values(h.store.getState().docs.ledger);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.delta).toEqual({ primo: 60 });
    expect(screen.getByTestId('occ-daily_commissions:2026-10-19').className).toContain('done');
    await user.click(screen.getByRole('button', { name: 'Вернуть: Ежедневные поручения' }));
    await waitFor(() =>
      expect(h.store.getState().docs.occ_status['daily_commissions:2026-10-19']?.status).toBe('planned'),
    );
  });

  it('HoYoLAB +1: на 4-й отметке +20 примогемов (12.4)', async () => {
    const h = await makeHarness();
    window.location.hash = '#/today';
    renderApp(h, <App />);
    const user = userEvent.setup();
    const plus = await screen.findByRole('button', { name: 'HoYoLAB +1' });
    for (let i = 0; i < 4; i++) await user.click(plus);
    await waitFor(() => expect(screen.getByTestId('hoyolab-count').textContent).toBe('4'));
    expect(h.store.getState().docs.hoyolab['hoyolab:2026-10']).toEqual({
      id: 'hoyolab:2026-10',
      checkIns: 4,
    });
    const primo = Object.values(h.store.getState().docs.ledger).reduce((s, e) => s + (e.delta.primo ?? 0), 0);
    expect(primo).toBe(20);
  });

  it('«Горит» — компенсация 7.1 (почта до 23.10) в списке', async () => {
    const h = await makeHarness();
    window.location.hash = '#/today';
    renderApp(h, <App />);
    const hot = await screen.findByTestId('hot-list');
    expect(within(hot).getByText(/Компенсация за обслуживание 7.1/)).toBeTruthy();
  });
});

describe('M4: «Версия»', () => {
  it('группы вхождений текущей версии и счётчик «забрано X из Y»', async () => {
    const h = await makeHarness();
    window.location.hash = '#/version';
    renderApp(h, <App />);
    const user = userEvent.setup();
    expect(await screen.findByText(/Версия 7\.1/)).toBeTruthy();
    expect(screen.getByTestId('version-claimed').textContent).toBe('0');
    await user.click(
      screen.getByRole('button', {
        name: 'Забрал: Missive of Grace: 4 письма по 400 — Письмо 28.09 (истекает ~28.10)',
      }),
    );
    await waitFor(() => expect(screen.getByTestId('version-claimed').textContent).toBe('1'));
  });

  it('ивент с неизвестной суммой спрашивает фактическую при отметке', async () => {
    const h = await makeHarness();
    window.location.hash = '#/version';
    renderApp(h, <App />);
    const user = userEvent.setup();
    const eventsCard = (await screen.findByRole('heading', { name: /^Ивенты/ })).closest('section')!;
    await user.click(within(eventsCard as HTMLElement).getByRole('button', { name: /^Все \d+$/ }));
    await user.click(await screen.findByRole('button', { name: 'Забрал: Бонус за архонт-квест гл. VII' }));
    await user.clear(screen.getByLabelText('Получено примогемов'));
    await user.type(screen.getByLabelText('Получено примогемов'), '560');
    await user.click(screen.getByRole('button', { name: 'Забрал' }));
    await waitFor(() =>
      expect(h.store.getState().docs.occ_status['7.1-archon-bonus']).toMatchObject({
        status: 'claimed',
        actual: { primo: 560, if: 0 },
      }),
    );
  });
});

describe('M4: отметки синхронизируются', () => {
  it('устройство A отмечает → синхронизация → устройство B видит отметку и баланс', async () => {
    const server = fakeSyncServer();
    const mk = async () => {
      const ds = dataServer({ extra: server.handler });
      const h = await makeHarness({ server: ds });
      await h.store
        .getState()
        .setAccount({ id: 'u1', username: 'paimon', createdAt: '2026-10-19T00:00:00Z', isAdmin: false });
      return { h, sync: createSync(h.store, createApi(ds.fetchImpl)) };
    };
    const a = await mk();
    const b = await mk();
    await a.h.store.getState().put('occ_status', 'abyss:2026-10', { id: 'abyss:2026-10', status: 'claimed' });
    await a.h.store
      .getState()
      .put('ledger', 'claim:abyss:2026-10:x', {
        id: 'claim:abyss:2026-10:x',
        at: '2026-10-19T05:00:00.000Z',
        delta: { primo: 800 },
        reason: 'claim',
        refId: 'abyss:2026-10',
      });
    await a.sync.syncNow();
    expect(a.h.store.getState().sync.pending).toBe(0);
    await b.sync.syncNow();
    expect(b.h.store.getState().docs.occ_status['abyss:2026-10']).toEqual({
      id: 'abyss:2026-10',
      status: 'claimed',
    });
    expect(Object.keys(b.h.store.getState().docs.ledger)).toEqual(['claim:abyss:2026-10:x']);
  });

  it('конфликт: правка с устаревшей версией уступает серверу (14.5)', async () => {
    const server = fakeSyncServer();
    const mk = async () => {
      const ds = dataServer({ extra: server.handler });
      const h = await makeHarness({ server: ds });
      await h.store
        .getState()
        .setAccount({ id: 'u1', username: 'paimon', createdAt: '2026-10-19T00:00:00Z', isAdmin: false });
      return { h, sync: createSync(h.store, createApi(ds.fetchImpl)) };
    };
    const a = await mk();
    const b = await mk();
    const cat = 'mondstadt_main:waypoints';
    await a.h.store.getState().put('cat_progress', cat, { categoryId: cat, count: 1, updatedAt: 'x' });
    await a.sync.syncNow();
    await b.sync.syncNow();
    await a.h.store.getState().put('cat_progress', cat, { categoryId: cat, count: 5, updatedAt: 'a' });
    await b.h.store.getState().put('cat_progress', cat, { categoryId: cat, count: 9, updatedAt: 'b' });
    await a.sync.syncNow();
    await b.sync.syncNow();
    expect(b.h.store.getState().docs.cat_progress[cat]!.count).toBe(5);
    expect(b.h.store.getState().notices.some((n) => n.text.includes('другого устройства'))).toBe(true);
    expect(server.rows.get(`cat_progress/${cat}`)!.version).toBe(2);
  });
});
