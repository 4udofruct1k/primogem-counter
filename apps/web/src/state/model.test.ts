import { limitedPulls, standardPulls } from '@primo/domain';
import { describe, expect, it } from 'vitest';
import { makeHarness } from '../test/harness';
import { createActions } from './actions';
import { computeModel, runForecast } from './model';

const pity = {
  char: 0,
  charGuaranteed: false,
  radiance: 0 as const,
  weapon: 0,
  weaponGuaranteed: false,
  weaponFatePoint: 0,
};

async function setup() {
  const h = await makeHarness();
  const actions = createActions(h.store);
  const model = () => {
    const s = h.store.getState();
    return computeModel(s.game!, s.docs, s.now, 5);
  };
  return { h, actions, model };
}

describe('модель клиента', () => {
  it('TC-08 через сверку: 5000 / 300 / 12 IF / 20 AF → 45 и 20', async () => {
    const { actions, model } = await setup();
    await actions.reconcile({ primo: 5000, crystal: 300, if: 12, af: 20, starglitter: 0, stardust: 0 }, pity);
    const m = model();
    expect(limitedPulls(m.balance, m.settings)).toBe(45);
    expect(standardPulls(m.balance)).toBe(20);
  });

  it('TC-09: «забрал» с autoApply — баланс +60, вхождение не в прогнозе', async () => {
    const { actions, model } = await setup();
    await actions.reconcile({ primo: 1000, crystal: 0, if: 0, af: 0, starglitter: 0, stardust: 0 }, pity);
    const before = model();
    const daily = before.occurrences.find((o) => o.id === 'daily_commissions:2026-10-19')!;
    const f0 = runForecast(before, '2026-10-20T00:00:00Z');
    await actions.claim(before, daily);
    const after = model();
    expect(after.balance.primo).toBe(1060);
    expect(after.occurrences.find((o) => o.id === daily.id)!.status).toBe('claimed');
    const f1 = runForecast(after, '2026-10-20T00:00:00Z');
    expect(f1.primo).toBe(f0.primo);
    expect(f1.contributions.some((c) => c.id === daily.id)).toBe(false);
  });

  it('снятие отметки возвращает баланс', async () => {
    const { actions, model } = await setup();
    const m = model();
    const daily = m.occurrences.find((o) => o.id === 'daily_commissions:2026-10-19')!;
    await actions.claim(m, daily);
    const claimed = model().occurrences.find((o) => o.id === daily.id)!;
    await actions.setStatus(model(), claimed, 'planned');
    expect(model().balance.primo).toBe(0);
  });

  it('смена сервера перерезолвит время, отметки сохраняются (TC-14)', async () => {
    const { actions, model } = await setup();
    const m = model();
    await actions.claim(
      m,
      m.occurrences.find((o) => o.id === 'abyss:2026-10')!,
    );
    await actions.saveSettings({ server: 'asia' });
    const asia = model();
    expect(asia.settings.server).toBe('asia');
    expect(asia.occurrences.find((o) => o.id === 'abyss:2026-10')!.status).toBe('claimed');
    expect(asia.occurrences.find((o) => o.id === 'daily_commissions:2026-10-19')!.from).toBe(
      '2026-10-18T20:00:00Z',
    );
  });

  it('трекер: прогресс пишет разницу в леджер и вычитается из прогноза', async () => {
    const { actions, model } = await setup();
    const m = model();
    const stars: [number, number, number][] = [
      [3, 3, 3],
      [3, 3, 3],
      [0, 0, 0],
      [0, 0, 0],
    ];
    await actions.saveTracker(m, 'abyss', { id: 'abyss:2026-10', stars, claimed: false }, (d) =>
      d ? 400 : 0,
    );
    const after = model();
    expect(after.balance.primo).toBe(400);
    expect(after.trackerSums['abyss:2026-10']).toBe(400);
    const f = runForecast(after, '2026-10-20T00:00:00Z');
    expect(f.contributions.find((c) => c.id === 'abyss:2026-10')!.reward).toEqual({ primo: 400 });
  });
});
