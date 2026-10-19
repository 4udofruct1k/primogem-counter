import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { createActions } from '../state/actions';
import { computeModel, runForecast } from '../state/model';
import { makeHarness, renderApp } from '../test/harness';

const pity = {
  char: 23,
  charGuaranteed: false,
  radiance: 0 as const,
  weapon: 10,
  weaponGuaranteed: false,
  weaponFatePoint: 0,
};

async function setup(hash: string) {
  const h = await makeHarness();
  await createActions(h.store).reconcile(
    { primo: 5000, crystal: 300, if: 12, af: 20, starglitter: 0, stardust: 0 },
    pity,
  );
  window.location.hash = hash;
  renderApp(h, <App />);
  // экран прогноза грузится лениво (отдельный чанк) — под нагрузкой дольше секунды
  await screen.findByTestId('pulls-expected', {}, { timeout: 10_000 });
  return { h, user: userEvent.setup() };
}

const model = (h: Awaited<ReturnType<typeof setup>>['h']) => {
  const s = h.store.getState();
  return computeModel(s.game!, s.docs, s.now, -new Date().getTimezoneOffset() / 60);
};

describe('M7: прогноз через интерфейс совпадает с доменом', () => {
  it('три сценария к концу версии = runForecast', async () => {
    const { h } = await setup('#/forecast');
    const m = model(h);
    const T = m.currentVersion!.endDeadline;
    for (const s of ['min', 'expected', 'max'] as const) {
      const expected = runForecast(m, T, s).limitedPulls;
      expect(screen.getByTestId(`pulls-${s}`).textContent!.replace(/\s/g, '')).toBe(String(expected));
    }
    expect(screen.getByTestId('unknown-list').textContent).toMatch(/Бонус за архонт-квест/);
  });

  it('TC-04 через экран: дейлики к 2026-11-04 03:00 UTC+5 — 960 в «Ежедневном»', async () => {
    const { h } = await setup(`#/forecast?t=${encodeURIComponent('2026-11-03T22:00:00Z')}`);
    const m = model(h);
    const f = runForecast(m, '2026-11-03T22:00:00Z', 'expected');
    expect(f.byCategory.find((c) => c.category === 'daily')!.reward).toEqual({ primo: 960 });
    expect(screen.getByTestId('by-category').textContent).toMatch(/Ежедневное960/);
  });

  it('цель «персонаж C0» с pity 23 без гаранта → 157 (TC-07), разрыв и дата достижения', async () => {
    const { h, user } = await setup('#/forecast');
    await user.click(screen.getByRole('button', { name: '+ цель' }));
    await user.selectOptions(screen.getByLabelText('Что нужно'), 'char');
    await user.type(screen.getByLabelText('Название цели'), 'Скирк');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.getByTestId('goal-gap')).toBeTruthy());
    const goal = Object.values(h.store.getState().docs.goal)[0]!;
    expect(goal.need).toEqual({ kind: 'char5', copies: 1 });
    const m = model(h);
    const banner = m.banners.find(
      (b) => b.id === (goal.target.kind === 'banner' ? goal.target.bannerId : ''),
    )!;
    const f = runForecast(m, banner.end, m.settings.scenario);
    expect(screen.getByText('157')).toBeTruthy();
    expect(screen.getByTestId('goal-gap').textContent!.replace(/\s/g, '')).toBe(
      String(Math.abs(157 - f.limitedPulls)),
    );
  });
});
