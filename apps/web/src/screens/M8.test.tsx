import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { createActions } from '../state/actions';
import { computeModel } from '../state/model';
import { dataServer, json, makeHarness, renderApp } from '../test/harness';

describe('M8: таймлайн', () => {
  it('все дорожки на месте; линия цели пересчитывает прогноз', async () => {
    const h = await makeHarness();
    window.location.hash = '#/timeline';
    renderApp(h, <App />);
    await screen.findByTestId('timeline');
    for (const lane of ['versions', 'banners', 'events', 'endgame', 'paid', 'content', 'points']) {
      expect(screen.getByTestId(`lane-${lane}`)).toBeTruthy();
    }
    const versions = within(screen.getByTestId('lane-versions'));
    expect(versions.getByTitle('7.1 · фаза 2')).toBeTruthy();
    expect(within(screen.getByTestId('lane-banners')).getByTitle('★ Skirk / Escoffier')).toBeTruthy();
    expect(within(screen.getByTestId('lane-banners')).queryByTitle('★ Danica')).toBeNull();
    expect(within(screen.getByTestId('lane-points')).getAllByTitle('Почта истекает').length).toBeGreaterThan(
      0,
    );

    const handle = screen.getByRole('slider', { name: 'Линия цели' });
    fireEvent.focus(handle);
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByTestId('goal-readout').textContent).toMatch(/круток/));
  });

  it('утечки показываются фильтром', async () => {
    const h = await makeHarness();
    window.location.hash = '#/timeline';
    renderApp(h, <App />);
    const user = userEvent.setup();
    await screen.findByTestId('timeline');
    await user.click(screen.getByRole('tab', { name: 'Версия' }));
    await user.click(screen.getByLabelText('Показывать утечки'));
    expect(within(screen.getByTestId('lane-banners')).getByTitle('★ Danica')).toBeTruthy();
  });

  it('тап по полосе открывает шторку с отметкой', async () => {
    const h = await makeHarness();
    window.location.hash = '#/timeline';
    renderApp(h, <App />);
    const user = userEvent.setup();
    await screen.findByTestId('timeline');
    await user.click(within(screen.getByTestId('lane-events')).getByTitle(/Carefree Snowball Fight/));
    await user.click(await screen.findByRole('button', { name: 'Забрал: Carefree Snowball Fight' }));
    await waitFor(() => expect(h.store.getState().docs.occ_status['7.1-snowball']?.status).toBe('claimed'));
  });
});

describe('M8: источники и оплата', () => {
  it('покупка луны даёт вхождения, БП каждую версию — платную ветку', async () => {
    const h = await makeHarness();
    window.location.hash = '#/sources';
    renderApp(h, <App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Добавить покупку' }));
    await user.selectOptions(screen.getByLabelText('Покупка БП'), 'everyVersion');
    await waitFor(() => {
      const s = h.store.getState();
      const m = computeModel(s.game!, s.docs, s.now, 5);
      expect(m.occurrences.filter((o) => o.ruleId === 'welkin' && o.id.includes(':d'))).toHaveLength(30);
      expect(m.occurrences.some((o) => o.id === 'bp_paid:7.1')).toBe(true);
    });
  });

  it('отключённое правило пропадает из вхождений', async () => {
    const h = await makeHarness();
    window.location.hash = '#/sources';
    renderApp(h, <App />);
    const user = userEvent.setup();
    const row = (await screen.findByText('Отметки HoYoLAB')).closest('li')!;
    await user.click(within(row as HTMLElement).getByLabelText('вкл.'));
    await waitFor(() => {
      const s = h.store.getState();
      expect(computeModel(s.game!, s.docs, s.now, 5).occurrences.some((o) => o.ruleId === 'hoyolab')).toBe(
        false,
      );
    });
  });
});

describe('M8: админка данных', () => {
  it('шаблон: 3 малых ивента в 7.3 → патч на сервер и новые вхождения', async () => {
    let stored: { version: number; patch: unknown } = { version: 0, patch: {} };
    const server = dataServer({
      extra: (path, init) => {
        if (path === '/api/admin/patch' && (init?.method ?? 'GET') === 'GET')
          return json({ ...stored, updatedAt: null });
        if (path === '/api/admin/patch' && init?.method === 'PUT') {
          const body = JSON.parse(String(init.body)) as { patch: unknown; baseVersion: number };
          if (body.baseVersion !== stored.version)
            return json({ error: { code: 'CONFLICT', message: 'stale' } }, 409);
          stored = { version: stored.version + 1, patch: body.patch };
          return json({ version: stored.version });
        }
        if (path === '/data/manifest.json' && stored.version > 0) {
          return undefined;
        }
        return undefined;
      },
    });
    const h = await makeHarness({ server });
    await h.store.getState().setAccount({ id: 'a', username: 'admin', createdAt: '', isAdmin: true });
    window.location.hash = '#/admin';
    renderApp(h, <App />);
    const user = userEvent.setup();
    const count = await screen.findByLabelText('7.3 small: число');
    await user.clear(count);
    await user.type(count, '3');
    await user.click(screen.getByRole('button', { name: 'Сохранить патч' }));
    await waitFor(() => expect(stored.version).toBe(1));
    expect(stored.patch).toMatchObject({ eventTemplate: { versions: { '7.3': { small: { count: 3 } } } } });
  });

  it('проверка патча ловит битый итоговый пак', async () => {
    const { validatePatch } = await import('./AdminScreen');
    const h = await makeHarness();
    const base = h.store.getState().game!.basePack;
    expect(
      validatePatch(base, { eventTemplate: { versions: { '7.3': { small: { count: 3 } } } } }),
    ).toBeNull();
    expect(validatePatch(base, { events: [{ id: 'new-event', title: 'без дат' }] })).toMatch(/Итоговый пак/);
  });

  it('не админ видит заглушку', async () => {
    const h = await makeHarness();
    await createActions(h.store).saveSettings({});
    window.location.hash = '#/admin';
    renderApp(h, <App />);
    expect(await screen.findByText(/Доступно только администраторам/)).toBeTruthy();
  });
});
