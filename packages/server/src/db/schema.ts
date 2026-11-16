import {
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
import type { MessengerContact } from '@task-board/shared';

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
  // Инвалидация сессий: смена пароля и «выйти везде» увеличивают версию (FR-30, FR-33)
  tokenVersion: integer().notNull().default(0),
  createdAt: ts().notNull().defaultNow(),
});

export const boards = pgTable('boards', {
  id: id(),
  title: text().notNull(),
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
    expiresAt: ts().notNull(),
    revokedAt: ts(),
    createdBy: text()
      .notNull()
      .references(() => users.id),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex('invites_board_token_idx').on(t.boardId, t.token)],
);

export type User = typeof users.$inferSelect;
export type Board = typeof boards.$inferSelect;
export type Column = typeof columns.$inferSelect;
export type Card = typeof cards.$inferSelect;
