import { runBatch, addResults, createTotals, finishTotals, makeModel, type SimInput } from '@primo/domain';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { createApi } from '../data/api';
import { createSync } from '../data/sync';
import { createActions } from '../state/actions';
import { goalPullStats } from '../state/goals';
import { computeModel } from '../state/model';
import { fakeSyncServer } from '../test/fakeServer';
import { dataServer, makeHarness, renderApp } from '../test/harness';
import { inlinePorts, runSimulation } from '../workers/pool';
import { WishesScreen } from './WishesScreen';

const pity = {
  char: 20,
  charGuaranteed: false,
  radiance: 0 as const,
  weapon: 0,
  weaponGuaranteed: false,
  weaponFatePoint: 0,
};

const model = (h: Awaited<ReturnType<typeof makeHarness>>) => {
  const s = h.store.getState();
  return computeModel(s.game!, s.docs, s.now, -new Date().getTimezoneOffset() / 60);
};

/** Пример 13.5: бюджет 160, pity 20, без гаранта, цель C2 + R1. */
const example: SimInput = {
  budget: 160,
  pity,
  mode: 'char_and_weapon',
  consTarget: 2,
  refTarget: 1,
  runs: 1000,
  seed: 7,
  starglitter: { enabled: false, per4: 2, perStd5: 10, perDup5: 10, perWeapon5: 10 },
  model: makeModel('community'),
};

describe('M9: «Молитвы»', () => {
  it('TC-40: в режиме полёта 10 000 прогонов считаются без единого сетевого запроса', async () => {
    let offline = false;
    const ds = dataServer({ offline: () => offline });
    const h = await makeHarness({ server: ds });
    await createActions(h.store).reconcile(
      { primo: 160 * 160, crystal: 0, if: 0, af: 0, starglitter: 0, stardust: 0 },
      pity,
    );
    window.location.hash = '#/wishes';
    renderApp(h, <App />);
    const user = userEvent.setup();
    const budget = await screen.findByLabelText('Бюджет круток');
    await user.clear(budget);
    await user.type(budget, '160');
    await user.selectOptions(screen.getByLabelText('Цель созвездие'), '2');
    expect((screen.getByLabelText('Персонаж pity') as HTMLInputElement).value).toBe('20');

    offline = true;
    const before = ds.calls.length;
    await user.click(screen.getByRole('button', { name: /Прокрутить 10\s000 раз/ }));
    const table = await screen.findByTestId('sim-results', {}, { timeout: 20_000 });
    await waitFor(() => expect(screen.getByText('Результаты')).toBeTruthy(), { timeout: 20_000 });
    expect(ds.calls.length).toBe(before);

    const rows = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent ?? ''));
    expect(rows.map((r) => r[0])).toEqual(['C0', 'C1', 'C2', 'C2 + R1']);
    expect(rows[0]![1]).toMatch(/^100\s%$/);
    // сочетания в сумме 100% (TC-36), seed и модель видны под таблицами (13.5)
    expect(screen.getByTestId('sim-combos').querySelectorAll('li').length).toBeGreaterThan(1);
    expect(screen.getByText(/seed \d+/)).toBeTruthy();
    expect(h.store.getState().docs.sim_preset.last).toMatchObject({ consTarget: 2, runs: 10000 });
  }, 30_000);

  it('TC-35: итог не зависит от числа воркеров и совпадает с одним пакетом', async () => {
    const single = finishTotals(
      addResults(createTotals(example), runBatch(example, 0, example.runs)),
      example,
    );
    for (const workers of [1, 3, 8]) {
      const job = runSimulation(example, { factory: inlinePorts(), workers });
      expect(await job.promise).toEqual(single);
    }
  });

  it('прогресс приходит промежуточными итогами, отмена останавливает счёт', async () => {
    const seen: number[] = [];
    const job = runSimulation(
      { ...example, runs: 10000 },
      { factory: inlinePorts(), workers: 2, onProgress: (p) => seen.push(p.done) },
    );
    const s = await job.promise;
    expect(s.meta.runs).toBe(10000);
    expect(seen.length).toBeGreaterThanOrEqual(5);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));

    const cancelled = runSimulation({ ...example, runs: 100000 }, { factory: inlinePorts(), workers: 2 });
    cancelled.cancel();
    await expect(cancelled.promise).rejects.toThrow('cancelled');
  });

  it('«Записать реальные крутки» (13.6): списание по 160 и новый Pity', async () => {
    const h = await makeHarness();
    await createActions(h.store).reconcile(
      { primo: 1000, crystal: 0, if: 3, af: 0, starglitter: 0, stardust: 0 },
      pity,
    );
    renderApp(h, <WishesScreen portFactory={inlinePorts()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Записать реальные крутки' }));
    const pulls = screen.getByLabelText('Сделано круток');
    await user.clear(pulls);
    await user.type(pulls, '5');
    const charPity = screen.getByLabelText('Новый pity персонажа');
    await user.clear(charPity);
    await user.type(charPity, '25');
    const sheet = within(screen.getByRole('dialog'));
    await user.click(sheet.getByLabelText('Гарант на персонажа'));
    await user.click(sheet.getByRole('button', { name: 'Записать' }));
    await waitFor(() => expect(model(h).pity.char).toBe(25));
    const m = model(h);
    // 3 IF + 2 × 160 = 320 примогемов
    expect(m.balance.if).toBe(0);
    expect(m.balance.primo).toBe(680);
    expect(m.pity.charGuaranteed).toBe(true);
    expect(Object.values(h.store.getState().docs.ledger).map((e) => e.reason)).toEqual(['spend_pulls']);
  });

  it('медиана и p90 цели (13.6) — между нулём и худшим случаем', async () => {
    const h = await makeHarness();
    await createActions(h.store).reconcile(
      { primo: 0, crystal: 0, if: 0, af: 0, starglitter: 0, stardust: 0 },
      { ...pity, char: 0 },
    );
    const m = model(h);
    const c0 = goalPullStats(m, { kind: 'char5', copies: 1 })!;
    expect(c0.median).toBeGreaterThan(0);
    expect(c0.median).toBeLessThan(c0.p90);
    expect(c0.p90).toBeLessThanOrEqual(180);
    const both = goalPullStats(m, {
      kind: 'sum',
      parts: [
        { kind: 'char5', copies: 1 },
        { kind: 'weapon5', copies: 1 },
      ],
    })!;
    expect(both.median).toBeGreaterThan(c0.median);
    expect(both.p90).toBeLessThanOrEqual(180 + 160);
    const shifted = goalPullStats(m, {
      kind: 'sum',
      parts: [
        { kind: 'char5', copies: 1 },
        { kind: 'pulls', n: 10 },
      ],
    })!;
    expect(shifted).toEqual({ median: c0.median + 10, p90: c0.p90 + 10 });
    expect(goalPullStats(m, { kind: 'pulls', n: 90 })).toBeNull();
  });
});

describe('M9: отклонённые сервером изменения', () => {
  it('удаление из «только добавление» снимается из очереди и не уходит повторно', async () => {
    const server = fakeSyncServer();
    const bodies: { changes: unknown[] }[] = [];
    const ds = dataServer({
      extra: (path, init) => {
        if (path === '/api/sync') bodies.push(JSON.parse(String(init!.body)) as { changes: unknown[] });
        return server.handler(path, init);
      },
    });
    const h = await makeHarness({ server: ds });
    await h.store
      .getState()
      .setAccount({ id: 'u1', username: 'paimon', createdAt: '2026-10-19T00:00:00Z', isAdmin: false });
    const sync = createSync(h.store, createApi(ds.fetchImpl));
    await h.store.getState().put('ledger', 'manual:x', {
      id: 'manual:x',
      at: '2026-10-19T05:00:00.000Z',
      delta: { primo: 10 },
      reason: 'manual',
    });
    await sync.syncNow();
    await h.store.getState().put('ledger', 'manual:x', null);
    await sync.syncNow();
    expect(bodies.at(-1)!.changes).toHaveLength(1);
    expect(h.store.getState().sync.pending).toBe(0);
    expect(h.store.getState().notices.some((n) => n.kind === 'error' && n.text.includes('не принял'))).toBe(
      true,
    );
    await sync.syncNow();
    expect(bodies.at(-1)!.changes).toEqual([]);
  });
});
