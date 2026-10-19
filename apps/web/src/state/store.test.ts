import { describe, expect, it } from 'vitest';
import { dataServer, makeHarness } from '../test/harness';

describe('гостевой режим (M2)', () => {
  it('загружает игровые данные по манифесту и работает без аккаунта', async () => {
    const h = await makeHarness();
    const s = h.store.getState();
    expect(s.phase).toBe('ready');
    expect(s.account).toBeNull();
    expect(s.sync.state).toBe('guest');
    expect(s.game!.datapack.gameVersion).toBe('7.1');
    expect(s.game!.source).toBe('network');
  });

  it('документы пишутся в IndexedDB и переживают перезапуск; очередь копится', async () => {
    const h = await makeHarness();
    await h.store
      .getState()
      .put('occ_status', 'daily_commissions:2026-10-19', {
        id: 'daily_commissions:2026-10-19',
        status: 'claimed',
      });
    expect(h.store.getState().sync.pending).toBe(1);

    const again = await makeHarness({ dbName: h.dbName });
    expect(again.store.getState().docs.occ_status['daily_commissions:2026-10-19']).toEqual({
      id: 'daily_commissions:2026-10-19',
      status: 'claimed',
    });
    expect(again.store.getState().sync.pending).toBe(1);
  });

  it('без сети — игровые данные из кэша IndexedDB', async () => {
    const first = await makeHarness();
    let offline = true;
    const server = dataServer({ offline: () => offline });
    const h = await makeHarness({ dbName: first.dbName, server });
    expect(h.store.getState().phase).toBe('ready');
    expect(h.store.getState().game!.source).toBe('cache');
    offline = false;
  });

  it('первый запуск без сети — понятная ошибка', async () => {
    const h = await makeHarness({ server: dataServer({ offline: () => true }) });
    expect(h.store.getState().phase).toBe('error');
    expect(h.store.getState().error).toMatch(/Нет связи/);
  });

  it('файлы с тем же хэшем не скачиваются повторно', async () => {
    const first = await makeHarness();
    const server = dataServer();
    await makeHarness({ dbName: first.dbName, server });
    expect(server.calls).toEqual(['GET /data/manifest.json']);
  });

  it('патч админки накладывается на датапак', async () => {
    const server = dataServer({ patch: { eventTemplate: { versions: { '7.3': { small: { count: 3 } } } } } });
    const h = await makeHarness({ server });
    const game = h.store.getState().game!;
    expect(game.patchVersion).toBe(1);
    expect(game.datapack.eventTemplate!.versions!['7.3']!.small!.count).toBe(3);
    expect(game.basePack.eventTemplate!.versions!['7.3']).toBeUndefined();
  });
});
