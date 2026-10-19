import { describe, expect, it } from 'vitest';
import datapack from '../../../data/datapack-2026-10-19.json';
import seed from '../../../data/primo_seed_regions.json';
import {
  AdminPatchBodySchema,
  COLLECTIONS,
  DatapackPatchSchema,
  DatapackSchema,
  DEFAULT_SETTINGS,
  DOC_MAX_BYTES,
  jsonBytes,
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

describe('shared: размер документов (D-312)', () => {
  it('jsonBytes — байты UTF-8 JSON-записи значения', () => {
    expect(jsonBytes({ a: 1 })).toBe(7);
    expect(jsonBytes('я')).toBe(4); // кавычки + 2 байта
    expect(jsonBytes('😀')).toBe(6); // суррогатная пара — 4 байта
    expect(jsonBytes('€')).toBe(5);
    expect(jsonBytes(undefined)).toBe(0);
    expect(jsonBytes(null)).toBe(4);
    expect(DOC_MAX_BYTES).toBe(256 * 1024);
  });

  it('настоящие документы клиента проходят, раздутые — нет', () => {
    // форма «Молитв» без pity и бюджета (WishesScreen) — около 600 байт
    const preset = {
      mode: 'char_and_weapon',
      consTarget: 2,
      refTarget: 1,
      runs: 100000,
      seed: 4294967295,
      model: {
        softPreset: 'custom',
        char5: { base: 0.006, start: 74, step: 0.06, hard: 90 },
        weapon5: { base: 0.007, start: 63, step: 0.07, hard: 80 },
        char4: { base: 0.051, start: 9, step: 0.51, hard: 10 },
        weapon4: { base: 0.06, start: 8, step: 0.6, hard: 9 },
        fiftyFifty: 'radiance',
        epitomized: '5.0+',
        weaponChosen: 0.375,
        weaponOtherFeatured: 0.375,
      },
      starglitter: { enabled: true, per4: 2, perStd5: 10, perDup5: 10, perWeapon5: 10 },
      luckResult: 'C1 за 120 круток, '.repeat(20),
      luckPulls: 120,
    };
    expect(parseDoc('sim_preset', preset).success).toBe(true);
    expect(parseDoc('sim_preset', { ...preset, junk: 'x'.repeat(17 * 1024) }).success).toBe(false);

    const area = {
      id: 'user_area:x',
      kind: 'area',
      data: { regionId: 'natlan', name: 'Свой остров', chestBracket: 'high' },
    };
    expect(parseDoc('user_entity', area).success).toBe(true);
    const big = { ...area, data: { ...area.data, note: 'я'.repeat(9 * 1024) } };
    expect(parseDoc('user_entity', big).success).toBe(false);

    const rename = {
      entity: 'category',
      id: 'natlan_main:statue',
      field: 'title',
      value: 'Статуя',
      at: '2026-10-19T05:00:00.123Z',
    };
    expect(parseDoc('override', rename).success).toBe(true);
    expect(parseDoc('override', { ...rename, value: 7 }).success).toBe(true);
    expect(parseDoc('override', { ...rename, value: 'x'.repeat(5000) }).success).toBe(false);

    const goal = {
      id: 'g1',
      title: 'Скирк C2',
      target: { kind: 'banner', bannerId: '7.1-p2-char', point: 'end' },
      need: { kind: 'pulls', n: 80 },
    };
    expect(parseDoc('goal', goal).success).toBe(true);
    expect(parseDoc('goal', { ...goal, target: { ...goal.target, bannerId: '' } }).success).toBe(true);
    const longBanner = { ...goal, target: { ...goal.target, bannerId: 'b'.repeat(201) } };
    expect(parseDoc('goal', longBanner).success).toBe(false);

    const progress = {
      categoryId: 'c',
      chestLog: [{ type: 't'.repeat(201), variant: 'low', delta: 1, at: '2026-10-19T05:00:00Z' }],
      updatedAt: '2026-10-19T05:00:00Z',
    };
    expect(parseDoc('cat_progress', progress).success).toBe(false);
    expect(parseDoc('cat_progress', { categoryId: 'c', updatedAt: 'u'.repeat(65) }).success).toBe(false);
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

  it('sync: эпоха данных сервера — необязательное поле запроса и ответа', () => {
    expect(SyncRequestSchema.parse({ cursor: 5, changes: [], epoch: 'a1b2' }).epoch).toBe('a1b2');
    expect(SyncRequestSchema.parse({ cursor: 5, changes: [] }).epoch).toBeUndefined();
    expect(SyncRequestSchema.safeParse({ cursor: 5, changes: [], epoch: 'x'.repeat(65) }).success).toBe(
      false,
    );
    const base = { applied: [], conflicts: [], changes: [], cursor: 0 };
    expect(SyncResponseSchema.parse({ ...base, epoch: 'a1b2' }).epoch).toBe('a1b2');
  });

  it('админка: патч проверяется схемой патча, baseVersion — целое ≥ 0', () => {
    expect(AdminPatchBodySchema.safeParse({ patch: { notes: ['x'] }, baseVersion: 0 }).success).toBe(true);
    expect(
      AdminPatchBodySchema.safeParse({ patch: { events: [{ reward: {} }] }, baseVersion: 0 }).success,
    ).toBe(false);
    expect(AdminPatchBodySchema.safeParse({ patch: {}, baseVersion: -1 }).success).toBe(false);
  });
});
