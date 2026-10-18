import { describe, expect, it } from 'vitest';
import { datapack, DEVICE_OFFSET } from './test/fixtures';
import { formatInOffset } from './time';
import type { RawVersion } from './versions';
import { resolveVersions } from './versions';

const raw = datapack.versions as RawVersion[];
const until = '2027-12-01T00:00:00Z';

describe('versions (4.3)', () => {
  it('TC-02: проекция 7.2 от 7.1', () => {
    const only71 = raw.filter((v) => v.id === '7.1');
    const [, v72] = resolveVersions(only71, 'europe', { until });
    expect(v72!.id).toBe('7.2');
    expect(v72!.confidence).toBe('projected');
    expect(v72!.start).toBe('2026-11-03T22:00:00Z');
    expect(v72!.phase2Start).toBe('2026-11-24T17:00:00Z');
    expect(formatInOffset(v72!.end, 8)).toBe('2026-12-16 06:00');

    const fromPack = resolveVersions(raw, 'europe', { until }).find((v) => v.id === '7.2')!;
    expect(fromPack.start).toBe(v72!.start);
    expect(fromPack.phase2Start).toBe(v72!.phase2Start);
    expect(fromPack.end).toBe(v72!.end);
  });

  it('7.1: фаза 2 и старт из датапака', () => {
    const v71 = resolveVersions(raw, 'europe', { until })[0]!;
    expect(v71.start).toBe('2026-09-22T22:00:00Z');
    expect(v71.phase2Start).toBe('2026-10-13T17:00:00Z');
    expect(v71.end).toBe('2026-11-03T22:00:00Z');
  });

  it('TC-03: конец БП', () => {
    const versions = resolveVersions(raw, 'europe', { until });
    const v71 = versions.find((v) => v.id === '7.1')!;
    expect(v71.bpEnd).toBe('2026-11-02T02:59:00Z');
    expect(formatInOffset(v71.bpPurchaseEnd, DEVICE_OFFSET)).toBe('2026-11-02 06:59');
    const v72 = versions.find((v) => v.id === '7.2')!;
    expect(formatInOffset(v72.bpEnd, 1)).toBe('2026-12-14 03:59');
  });

  it('«дедлайн конца версии» — накануне старта следующей, 14:59 server', () => {
    const v71 = resolveVersions(raw, 'europe', { until })[0]!;
    expect(formatInOffset(v71.endDeadline, 1)).toBe('2026-11-03 14:59');
  });

  it('проекции покрывают горизонт, шаг 42 дня', () => {
    const versions = resolveVersions(raw, 'europe', { until });
    expect(versions.map((v) => v.id).slice(0, 8)).toEqual([
      '7.1',
      '7.2',
      '7.3',
      '7.4',
      '7.5',
      '7.6',
      '7.7',
      '7.8',
    ]);
    const v76 = versions.find((v) => v.id === '7.6')!;
    expect(formatInOffset(v76.start, 8)).toBe('2027-04-21 06:00');
    expect(v76.generated).toBe(true);
    expect(versions.at(-1)!.end > until).toBe(true);
  });

  it('durationDaysOverride сдвигает последующие projected версии', () => {
    const patched = raw.map((v) => (v.id === '7.2' ? { ...v, durationDaysOverride: 49 } : v));
    const versions = resolveVersions(patched, 'europe', { until });
    expect(formatInOffset(versions.find((v) => v.id === '7.3')!.start, 8)).toBe('2026-12-23 06:00');
    expect(formatInOffset(versions.find((v) => v.id === '7.5')!.start, 8)).toBe('2027-03-17 06:00');
    expect(formatInOffset(versions.find((v) => v.id === '7.2')!.end, 8)).toBe('2026-12-23 06:00');
  });

  it('смена сервера перерезолвит clock: server', () => {
    const asia = resolveVersions(raw, 'asia', { until })[0]!;
    expect(asia.start).toBe('2026-09-22T22:00:00Z');
    expect(asia.phase2Start).toBe('2026-10-13T10:00:00Z');
  });
});
