import { describe, expect, it } from 'vitest';
import { applyDatapackPatch } from './patch';
import { pack } from './test/context';

describe('патч админки поверх датапака (16)', () => {
  it('записи мержатся по id, новые добавляются, _delete удаляет', () => {
    const merged = applyDatapackPatch(pack, {
      events: [
        { id: '7.1-overflowing-favor', reward: { primo: 0 } },
        { id: '7.1-miliastra', _delete: true },
        {
          id: '7.2-new',
          versionId: '7.2',
          title: 'Новый ивент',
          start: { at: '2026-11-05T10:00', clock: 'server' },
          end: null,
          reward: { primo: 420 },
          slot: 'small',
          confidence: 'official',
        },
      ],
    });
    const fav = merged.events.find((e) => e.id === '7.1-overflowing-favor')!;
    expect(fav.reward).toEqual({ primo: 0 });
    expect(fav.title).toBe('Overflowing Favor');
    expect(merged.events.find((e) => e.id === '7.1-miliastra')).toBeUndefined();
    expect(merged.events.at(-1)!.id).toBe('7.2-new');
    expect(pack.events.find((e) => e.id === '7.1-overflowing-favor')!.reward).toEqual({ primo: null });
  });

  it('шаблон ивентов: слоты по id, переопределения версий глубоко', () => {
    const merged = applyDatapackPatch(pack, {
      eventTemplate: {
        slots: [{ id: 'big', title: 'Большой ивент версии', count: 1, reward: { primo: 1000 } }],
        versions: { '7.3': { small: { count: 3 } } },
      },
    });
    const t = merged.eventTemplate!;
    expect(t.slots.map((s) => [s.id, s.reward.primo])).toEqual([
      ['small', 420],
      ['big', 1000],
    ]);
    expect(t.versions!['7.1']!.big!.count).toBe(0);
    expect(t.versions!['7.3']!.small!.count).toBe(3);
    expect(t.trialsPerPhase).toEqual({ primo: 40 });
  });

  it('пустой патч не меняет пак', () => {
    expect(applyDatapackPatch(pack, {})).toEqual(pack);
  });
});
