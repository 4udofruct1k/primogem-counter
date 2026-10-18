import { describe, expect, it } from 'vitest';
import { DEVICE_OFFSET } from './test/fixtures';
import { formatInOffset, resolveTime, serverDateOf, serverDayStart } from './time';

describe('time (4.1–4.2)', () => {
  it('TC-01: начало серверного дня 2026-10-19', () => {
    const europe = serverDayStart('2026-10-19', 'europe');
    expect(europe).toBe('2026-10-19T03:00:00Z');
    expect(formatInOffset(europe, DEVICE_OFFSET)).toBe('2026-10-19 08:00');

    const asia = serverDayStart('2026-10-19', 'asia');
    expect(formatInOffset(asia, DEVICE_OFFSET)).toBe('2026-10-19 01:00');
    expect(serverDayStart('2026-10-19', 'tw_hk_mo')).toBe(asia);
    expect(formatInOffset(serverDayStart('2026-10-19', 'america'), DEVICE_OFFSET)).toBe('2026-10-19 14:00');
  });

  it('резолвит clock: utc8 и clock: server в UTC', () => {
    expect(resolveTime({ at: '2026-11-04T06:00', clock: 'utc8' }, 'europe')).toBe('2026-11-03T22:00:00Z');
    expect(resolveTime({ at: '2026-11-03T14:59', clock: 'server' }, 'europe')).toBe('2026-11-03T13:59:00Z');
    expect(resolveTime({ at: '2026-11-03T14:59', clock: 'server' }, 'america')).toBe('2026-11-03T19:59:00Z');
  });

  it('серверная дата меняется в 04:00 по серверу', () => {
    expect(serverDateOf('2026-10-19T02:59:00Z', 'europe')).toBe('2026-10-18');
    expect(serverDateOf('2026-10-19T03:00:00Z', 'europe')).toBe('2026-10-19');
    expect(serverDateOf('2026-10-19T03:00:00Z', 'asia')).toBe('2026-10-19');
  });
});
