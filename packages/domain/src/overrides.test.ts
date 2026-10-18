import { describe, expect, it } from 'vitest';
import { applyOverrides, mergeById } from './overrides';
import { normalizeRules, type RawRule } from './datapack';
import { pack } from './test/context';
import type { Override } from './types';

describe('overrides и мердж пака (I6, раздел 16)', () => {
  it('TC-11: Override theater.expected = 800, новый пак с 1000 — остаётся 800', () => {
    const overrides: Override[] = [
      { entity: 'rule', id: 'theater', field: 'expected', value: { primo: 800 }, at: '2026-10-19T05:00:00Z' },
    ];
    const oldRules = normalizeRules(pack.rules);
    const newRaw: RawRule[] = pack.rules.map((r) =>
      r.id === 'theater' ? { ...r, expected: { primo: 1000 } } : r,
    );
    const merged = applyOverrides('rule', mergeById(oldRules, normalizeRules(newRaw)), overrides);
    expect(merged.find((r) => r.id === 'theater')!.expected).toEqual({ primo: 800 });
    expect(merged.find((r) => r.id === 'abyss')!.expected).toEqual({ primo: 800 });
  });

  it('новый пак > старый пак; записи только из старого сохраняются', () => {
    const merged = mergeById(
      [
        { id: 'a', v: 1 },
        { id: 'b', v: 1 },
      ],
      [
        { id: 'b', v: 2 },
        { id: 'c', v: 2 },
      ],
    );
    expect(merged).toEqual([
      { id: 'a', v: 1 },
      { id: 'b', v: 2 },
      { id: 'c', v: 2 },
    ]);
  });

  it('путь поля через точку и чужие сущности не трогаются', () => {
    const overrides: Override[] = [
      { entity: 'chestType', id: 'common', field: 'values.high', value: 3, at: '2026-10-19T05:00:00Z' },
      { entity: 'rule', id: 'common', field: 'values.high', value: 99, at: '2026-10-19T05:00:00Z' },
    ];
    const out = applyOverrides('chestType', [{ id: 'common', values: { low: 0, high: 2 } }], overrides);
    expect(out).toEqual([{ id: 'common', values: { low: 0, high: 3 } }]);
  });

  it('при нескольких Override одного поля побеждает самый поздний', () => {
    const overrides: Override[] = [
      { entity: 'rule', id: 'x', field: 'claimLagHours', value: 10, at: '2026-10-20T00:00:00Z' },
      { entity: 'rule', id: 'x', field: 'claimLagHours', value: 5, at: '2026-10-19T00:00:00Z' },
    ];
    expect(applyOverrides('rule', [{ id: 'x', claimLagHours: 14 }], overrides)[0]!.claimLagHours).toBe(10);
  });
});
