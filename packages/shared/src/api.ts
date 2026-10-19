// Контракты API (14.4, 14.5).
import { z } from 'zod';
import { DatapackPatchSchema } from './data';
import { CollectionSchema } from './docs';
import { DocIdSchema } from './primitives';

/** Логин: 3–32 символа `[a-z0-9_]`, без учёта регистра (14.2). */
export const UsernameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_]{3,32}$/, 'логин: 3–32 символа, латиница, цифры и _')
  .transform((s) => s.toLowerCase());
export const PasswordSchema = z.string().min(8, 'пароль — от 8 символов').max(256);
/** Код восстановления: 16 символов (14.2); пробелы и дефисы при вводе игнорируются. */
export const RecoveryCodeSchema = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, '').toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{16}$/, 'код восстановления — 16 символов'));

export const RegisterBodySchema = z.object({ username: UsernameSchema, password: PasswordSchema });
export const LoginBodySchema = z.object({ username: UsernameSchema, password: z.string().min(1).max(256) });
export const RecoverBodySchema = z.object({
  username: UsernameSchema,
  recoveryCode: RecoveryCodeSchema,
  newPassword: PasswordSchema,
});
export const ChangePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: PasswordSchema,
});
export const DeleteAccountBodySchema = z.object({ password: z.string().min(1).max(256) });
/** Новый код восстановления из настроек аккаунта — нужен текущий пароль (14.2). */
export const NewRecoveryCodeBodySchema = z.object({ password: z.string().min(1).max(256) });

export const RegisterResponseSchema = z.object({
  user: z.object({ id: z.string(), username: z.string(), createdAt: z.string() }),
  recoveryCode: z.string(),
});
export const MeResponseSchema = z.object({
  id: z.string(),
  username: z.string(),
  createdAt: z.string(),
  isAdmin: z.boolean(),
});
export const RecoverResponseSchema = z.object({ recoveryCode: z.string() });
export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  db: z.enum(['up', 'down']),
  version: z.string(),
});

/** Пакет синхронизации — до 500 изменений (14.5). */
export const SYNC_BATCH_LIMIT = 500;
/**
 * Предел одного документа — 256 КБ JSON (`jsonBytes`). Больший сервер не сохраняет и возвращает в `rejected`
 * (D-312). Настоящие документы — единицы КБ.
 */
export const DOC_MAX_BYTES = 256 * 1024;

export const SyncChangeSchema = z.object({
  collection: CollectionSchema,
  id: DocIdSchema,
  data: z.unknown().nullable(),
  baseVersion: z.number().int().min(0),
});
export const SyncRequestSchema = z.object({
  cursor: z.number().int().min(0),
  changes: z.array(SyncChangeSchema).max(SYNC_BATCH_LIMIT),
  /**
   * Эпоха данных сервера из последнего применённого ответа (D-315). Не совпала с текущей — база восстановлена
   * из бэкапа: сервер не верит курсору и `baseVersion > 0`, отдаёт всё с нуля. Нет поля — как раньше.
   */
  epoch: z.string().max(64).optional(),
});
export const SyncResponseSchema = z.object({
  applied: z.array(
    z.object({ collection: CollectionSchema, id: z.string(), version: z.number(), seq: z.number() }),
  ),
  conflicts: z.array(
    z.object({
      collection: CollectionSchema,
      id: z.string(),
      server: z.object({ data: z.unknown().nullable(), version: z.number(), deleted: z.boolean() }),
    }),
  ),
  changes: z.array(
    z.object({
      collection: CollectionSchema,
      id: z.string(),
      data: z.unknown().nullable(),
      version: z.number(),
      deleted: z.boolean(),
    }),
  ),
  cursor: z.number(),
  /**
   * Повторить запрос: на сервере есть ещё изменения после `cursor` или сервер обработал не все изменения запроса
   * (необработанные не попали ни в `applied`, ни в `conflicts`, ни в `rejected` — их нужно отправить снова, D-313).
   */
  more: z.boolean().optional(),
  /**
   * Изменения, которые сервер отклонил и не сохранил: документ не прошёл схему коллекции, больше `DOC_MAX_BYTES`,
   * не помещается в лимиты аккаунта или это удаление из коллекции «только добавление». Остальные изменения запроса
   * применяются как обычно.
   */
  rejected: z
    .array(z.object({ collection: CollectionSchema, id: z.string(), message: z.string() }))
    .optional(),
  /** Эпоха данных сервера (D-315): клиент хранит её рядом с `cursor` и шлёт в следующих запросах. */
  epoch: z.string().optional(),
});
export type SyncChange = z.infer<typeof SyncChangeSchema>;
export type SyncRequest = z.infer<typeof SyncRequestSchema>;
export type SyncResponse = z.infer<typeof SyncResponseSchema>;

export const ExportResponseSchema = z.object({
  exportedAt: z.string(),
  user: z.object({ id: z.string(), username: z.string(), createdAt: z.string() }),
  docs: z.array(
    z.object({
      collection: CollectionSchema,
      id: z.string(),
      data: z.unknown(),
      version: z.number(),
      updatedAt: z.string(),
    }),
  ),
});

/** Один документ пользователя: GET /api/docs/:collection/:id. */
export const DocResponseSchema = z.object({
  collection: CollectionSchema,
  id: z.string(),
  data: z.unknown(),
  version: z.number(),
  updatedAt: z.string(),
});

/** Патч датапака из админки данных: текущая версия (0 и `{}` — патча нет). */
export const AdminPatchResponseSchema = z.object({
  version: z.number().int().min(0),
  patch: z.unknown(),
  updatedAt: z.string().nullable(),
});
/** Сохранение патча: `baseVersion` — версия, от которой шла правка (оптимистичная блокировка). */
export const AdminPatchBodySchema = z.object({
  patch: DatapackPatchSchema,
  baseVersion: z.number().int().min(0),
});

export const ERROR_CODES = [
  'VALIDATION',
  'AUTH_REQUIRED',
  'BAD_CREDENTIALS',
  'RATE_LIMIT',
  'CONFLICT',
  'NOT_FOUND',
  'FORBIDDEN',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export const ApiErrorSchema = z.object({
  error: z.object({ code: z.enum(ERROR_CODES), message: z.string() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
