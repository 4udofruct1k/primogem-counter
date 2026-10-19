// Схема БД (14.3) и таблица патчей админки данных. Миграции — drizzle-kit в apps/api/drizzle/.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** Логин без учёта регистра — расширение citext (создаётся первой миграцией). */
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: citext('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  recoveryHash: text('recovery_hash').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Сессии: `id` — SHA-256 от 256-битного токена из cookie (D-303). */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

/** Одна глобальная последовательность для всех документов всех пользователей (курсор синхронизации). */
export const userDocsSeq = pgSequence('user_docs_seq');

export const userDocs = pgTable(
  'user_docs',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    collection: text('collection').notNull(),
    docId: text('doc_id').notNull(),
    /** null — документ удалён (`deleted = true`). */
    data: jsonb('data'),
    version: integer('version').notNull(),
    seq: bigint('seq', { mode: 'number' })
      .notNull()
      .default(sql`nextval('user_docs_seq')`),
    deleted: boolean('deleted').notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.collection, t.docId] }),
    index('user_docs_user_seq_idx').on(t.userId, t.seq),
  ],
);

/** Патчи датапака из админки (16): каждая правка — новая версия, старые не меняются. */
export const adminPatches = pgTable('admin_patches', {
  version: integer('version').primaryKey(),
  patch: jsonb('patch').notNull(),
  createdAt: createdAt(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
});
