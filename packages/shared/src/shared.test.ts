import { describe, expect, it } from 'vitest';
import datapack from '../../../data/datapack-2026-10-19.json';
import seed from '../../../data/primo_seed_regions.json';
import {
  AdminPatchBodySchema,
  COLLECTIONS,
  DatapackPatchSchema,
  DatapackSchema,
  DEFAULT_SETTINGS,
  LoginBodySchema,
  parseDoc,
  RecoveryCodeSchema,
  RegisterBodySchema,
  SeedSchema,
  ServerIdSchema,
  SettingsSchema,
  SyncRequestSchema,
  SyncResponseSchema,
} from './index';

describe('shared: игровые данные', () => {
  it('датапак и seed проходят схемы', () => {
    expect(DatapackSchema.safeParse(datapack).success).toBe(true);
    expect(SeedSchema.safeParse(seed).success).toBe(true);
  });

  it('патч админки: частичные записи и удаление по id', () => {
    const ok = DatapackPatchSchema.safeParse({
      events: [
        { id: '7.1-overflowing-favor', reward: { primo: 0 } },
        { id: 'x', _delete: true },
      ],
      eventTemplate: { versions: { '7.3': { small: { count: 3 } } } },
    });
    expect(ok.success).toBe(true);
    expect(DatapackPatchSchema.safeParse({ events: [{ reward: {} }] }).success).toBe(false);
  });
});

describe('shared: документы (14.3)', () => {
  it('серверы 4.1', () => {
    for (const id of ['asia', 'tw_hk_mo', 'europe', 'america']) expect(ServerIdSchema.parse(id)).toBe(id);
    expect(ServerIdSchema.safeParse('moon').success).toBe(false);
  });

  it('у каждой коллекции есть схема', () => {
    expect(COLLECTIONS).toHaveLength(16);
    expect(SettingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('проверка документов по коллекции', () => {
    expect(parseDoc('occ_status', { id: 'daily_commissions:2026-10-19', status: 'claimed' }).success).toBe(
      true,
    );
    expect(parseDoc('occ_status', { id: 'x', status: 'lost' }).success).toBe(false);
    expect(
      parseDoc('abyss', {
        id: 'abyss:2026-10',
        stars: [
          [3, 3, 3],
          [3, 3, 3],
          [3, 3, 3],
          [3, 3, 4],
        ],
        claimed: false,
      }).success,
    ).toBe(false);
    expect(
      parseDoc('cat_progress', {
        categoryId: 'mondstadt_main:chests',
        chestCounts: { luxurious: { '10': 1, '40': 2 } },
        chestLog: [{ type: 'luxurious', variant: 40, delta: 1, at: '2026-10-19T05:00:00Z' }],
        updatedAt: '2026-10-19T05:00:00Z',
      }).success,
    ).toBe(true);
    expect(
      parseDoc('goal', {
        id: 'g1',
        title: 'Скирк C2',
        target: { kind: 'banner', bannerId: '7.1-p2-char', point: 'end' },
        need: {
          kind: 'sum',
          parts: [
            { kind: 'char5', copies: 3 },
            { kind: 'weapon5', copies: 1 },
          ],
        },
      }).success,
    ).toBe(true);
  });
});

describe('shared: API (14.2, 14.5)', () => {
  it('логин без учёта регистра, 3–32 символа [a-z0-9_]', () => {
    expect(RegisterBodySchema.parse({ username: 'Paimon_42', password: '12345678' }).username).toBe(
      'paimon_42',
    );
    expect(RegisterBodySchema.safeParse({ username: 'ab', password: '12345678' }).success).toBe(false);
    expect(RegisterBodySchema.safeParse({ username: 'кириллица', password: '12345678' }).success).toBe(false);
    expect(RegisterBodySchema.safeParse({ username: 'paimon', password: '1234567' }).success).toBe(false);
    expect(LoginBodySchema.parse({ username: 'PAIMON', password: 'x' }).username).toBe('paimon');
  });

  it('код восстановления: 16 символов, пробелы и дефисы игнорируются', () => {
    expect(RecoveryCodeSchema.parse('abcd-efgh-2345-6789')).toBe('ABCDEFGH23456789');
    expect(RecoveryCodeSchema.safeParse('short').success).toBe(false);
  });

  it('sync: не больше 500 изменений за запрос', () => {
    const change = { collection: 'occ_status', id: 'x', data: null, baseVersion: 1 };
    expect(SyncRequestSchema.safeParse({ cursor: 0, changes: Array(500).fill(change) }).success).toBe(true);
    expect(SyncRequestSchema.safeParse({ cursor: 0, changes: Array(501).fill(change) }).success).toBe(false);
    expect(
      SyncRequestSchema.safeParse({ cursor: 0, changes: [{ ...change, collection: 'users' }] }).success,
    ).toBe(false);
  });

  it('sync: отклонённые изменения — необязательное поле ответа', () => {
    const base = { applied: [], conflicts: [], changes: [], cursor: 0 };
    expect(SyncResponseSchema.safeParse(base).success).toBe(true);
    const rejected = [{ collection: 'ledger', id: 'x', message: 'только добавление' }];
    expect(SyncResponseSchema.parse({ ...base, more: false, rejected }).rejected).toEqual(rejected);
  });

  it('админка: патч проверяется схемой патча, baseVersion — целое ≥ 0', () => {
    expect(AdminPatchBodySchema.safeParse({ patch: { notes: ['x'] }, baseVersion: 0 }).success).toBe(true);
    expect(
      AdminPatchBodySchema.safeParse({ patch: { events: [{ reward: {} }] }, baseVersion: 0 }).success,
    ).toBe(false);
    expect(AdminPatchBodySchema.safeParse({ patch: {}, baseVersion: -1 }).success).toBe(false);
  });
});
