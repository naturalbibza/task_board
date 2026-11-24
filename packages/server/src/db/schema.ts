import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';
import type { MessengerContact, TemplateCard, TemplateColumn } from '@task-board/shared';

const id = () =>
  text()
    .primaryKey()
    .$defaultFn(() => randomUUID());
const ts = () => timestamp({ withTimezone: true });

export const roleEnum = pgEnum('role', ['OWNER', 'MEMBER', 'ADMIN', 'EDITOR', 'VIEWER']);

export const users = pgTable('users', {
  id: id(),
  email: text().notNull().unique(),
  passwordHash: text().notNull(),
  name: text().notNull(),
  description: text(),
  phone: text(),
  messengers: jsonb().$type<MessengerContact[]>(),
  // Подтверждение email (v2, фаза 14): null — адрес ещё не подтверждён
  emailVerifiedAt: ts(),
  // Инвалидация сессий: смена пароля и «выйти везде» увеличивают версию (FR-30, FR-33)
  tokenVersion: integer().notNull().default(0),
  createdAt: ts().notNull().defaultNow(),
});

/** Одноразовые токены подтверждения email: в БД хранится только sha256-хэш. */
export const emailVerifications = pgTable(
  'email_verifications',
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text().notNull(),
    expiresAt: ts().notNull(),
    usedAt: ts(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [
    index('email_verifications_token_idx').on(t.tokenHash),
    index('email_verifications_user_idx').on(t.userId),
  ],
);

export const boards = pgTable('boards', {
  id: id(),
  title: text().notNull(),
  // Архив (v2, фаза 15): null — доска активна, иначе только просмотр
  archivedAt: ts(),
  createdAt: ts().notNull().defaultNow(),
  updatedAt: ts()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const boardMembers = pgTable(
  'board_members',
  {
    boardId: text()
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum().notNull(),
    // Избранное — персонально для участника (v2, фаза 15)
    favorite: boolean().notNull().default(false),
    // Ссылка, по которой участник вступил (v2): при удалении её отзываем,
    // чтобы он не вернулся по той же ссылке.
    inviteId: text().references(() => invites.id, { onDelete: 'set null' }),
    joinedAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.boardId, t.userId] })],
);

export const columns = pgTable(
  'columns',
  {
    id: id(),
    boardId: text()
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    position: doublePrecision().notNull(), // дробная позиция, см. FR-6
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index('columns_board_position_idx').on(t.boardId, t.position)],
);

export const cards = pgTable(
  'cards',
  {
    id: id(),
    columnId: text()
      .notNull()
      .references(() => columns.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    description: text(),
    position: doublePrecision().notNull(),
    authorId: text()
      .notNull()
      .references(() => users.id),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('cards_column_position_idx').on(t.columnId, t.position)],
);

export const invites = pgTable(
  'invites',
  {
    id: id(),
    boardId: text()
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    token: text().notNull().unique(), // ≥ 32 случайных символа (FR-16)
    role: roleEnum().notNull().default('EDITOR'), // роль при вступлении (v2, FR-25)
    // Приглашение по email (v2, FR-26): вступить сможет только этот адрес
    email: text(),
    expiresAt: ts().notNull(),
    revokedAt: ts(),
    createdBy: text()
      .notNull()
      .references(() => users.id),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex('invites_board_token_idx').on(t.boardId, t.token)],
);

/** Пользовательские шаблоны колонок (v2, фаза 15): название + карточки. */
export const columnTemplates = pgTable(
  'column_templates',
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    cards: jsonb().$type<TemplateCard[]>().notNull(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('column_templates_user_idx').on(t.userId)],
);

/** Пользовательские шаблоны досок (FR-51): колонки и карточки в jsonb. */
export const boardTemplates = pgTable(
  'board_templates',
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    columns: jsonb().$type<TemplateColumn[]>().notNull(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('board_templates_user_idx').on(t.userId)],
);

export type User = typeof users.$inferSelect;
export type Board = typeof boards.$inferSelect;
export type Column = typeof columns.$inferSelect;
export type Card = typeof cards.$inferSelect;
