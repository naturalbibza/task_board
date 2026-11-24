// Шаблоны колонок (v2, FR-43–44): системные — из shared, пользовательские — в БД.
import { Router } from 'express';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import {
  SYSTEM_BOARD_TEMPLATES,
  SYSTEM_COLUMN_TEMPLATES,
  saveBoardTemplateSchema,
  saveColumnTemplateSchema,
  type BoardTemplateDto,
  type ColumnTemplateDto,
  type TemplateCard,
  type TemplateColumn,
} from '@task-board/shared';
import { db } from '../db';
import { boardTemplates, cards, columnTemplates, columns } from '../db/schema';
import { HttpError } from './errors';
import { requireUserId } from './session';
import { boardAccess } from './boards';

export const templatesRouter = Router();
export const boardTemplatesRouter = Router();

type TemplateRow = typeof columnTemplates.$inferSelect;
type BoardTemplateRow = typeof boardTemplates.$inferSelect;

function templateDto(row: TemplateRow): ColumnTemplateDto {
  return {
    id: row.id,
    title: row.title,
    cards: row.cards ?? [],
    system: false,
  };
}

/** GET /api/column-templates — системные первыми, затем пользовательские (только свои). */
const listTemplates: RequestHandler = async (req, res) => {
  const userId = await requireUserId(req);
  const rows = await db
    .select()
    .from(columnTemplates)
    .where(eq(columnTemplates.userId, userId))
    .orderBy(asc(columnTemplates.createdAt));
  res.json({ templates: [...SYSTEM_COLUMN_TEMPLATES, ...rows.map(templateDto)] });
};

/**
 * POST /api/column-templates — «сохранить колонку как шаблон».
 * Карточки копируются на сервере: название + описание, без исполнителей/ролей.
 */
const saveTemplate: RequestHandler = async (req, res) => {
  const userId = await requireUserId(req);
  const { columnId, title } = saveColumnTemplateSchema.parse(req.body);

  const [column] = await db.select().from(columns).where(eq(columns.id, columnId));
  if (!column) {
    throw new HttpError(404, 'COLUMN_NOT_FOUND', 'Колонка не найдена');
  }
  // Шаблон может сохранить любой участник доски (просмотр не меняет доску)
  await boardAccess(userId, column.boardId);

  const columnCards = await db
    .select()
    .from(cards)
    .where(eq(cards.columnId, column.id))
    .orderBy(asc(cards.position));
  const templateCards: TemplateCard[] = columnCards.map((card) => ({
    title: card.title,
    description: card.description,
  }));

  const [created] = await db
    .insert(columnTemplates)
    .values({
      userId,
      title: title?.trim() || column.title,
      cards: templateCards,
    })
    .returning();
  res.status(201).json({ template: templateDto(created) });
};

/** DELETE /api/column-templates/:id — только собственный шаблон автора. */
const deleteTemplate: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const [existing] = await db
    .select()
    .from(columnTemplates)
    .where(and(eq(columnTemplates.id, req.params.id), eq(columnTemplates.userId, userId)));
  if (!existing) {
    throw new HttpError(404, 'TEMPLATE_NOT_FOUND', 'Шаблон не найден');
  }
  await db.delete(columnTemplates).where(eq(columnTemplates.id, existing.id));
  res.json({ ok: true });
};

templatesRouter.get('/', listTemplates);
templatesRouter.post('/', saveTemplate);
templatesRouter.delete('/:id', deleteTemplate);

// --- Шаблоны досок (FR-51) ---

function boardTemplateDto(row: BoardTemplateRow): BoardTemplateDto {
  return {
    id: row.id,
    title: row.title,
    columns: row.columns ?? [],
    system: false,
  };
}

/** GET /api/board-templates — системные первыми, затем пользовательские (только свои). */
const listBoardTemplates: RequestHandler = async (req, res) => {
  const userId = await requireUserId(req);
  const rows = await db
    .select()
    .from(boardTemplates)
    .where(eq(boardTemplates.userId, userId))
    .orderBy(asc(boardTemplates.createdAt));
  res.json({ templates: [...SYSTEM_BOARD_TEMPLATES, ...rows.map(boardTemplateDto)] });
};

/** POST /api/board-templates — «сохранить доску как шаблон» (колонки + карточки). */
const saveBoardTemplate: RequestHandler = async (req, res) => {
  const userId = await requireUserId(req);
  const { boardId, title } = saveBoardTemplateSchema.parse(req.body);
  const access = await boardAccess(userId, boardId);

  const columnRows = await db
    .select()
    .from(columns)
    .where(eq(columns.boardId, boardId))
    .orderBy(asc(columns.position));
  const columnIds = columnRows.map((column) => column.id);
  const cardRows = columnIds.length
    ? await db
        .select()
        .from(cards)
        .where(inArray(cards.columnId, columnIds))
        .orderBy(asc(cards.position))
    : [];

  const cardsByColumn = new Map<string, TemplateCard[]>();
  for (const card of cardRows) {
    const list = cardsByColumn.get(card.columnId) ?? [];
    list.push({ title: card.title, description: card.description });
    cardsByColumn.set(card.columnId, list);
  }
  const templateColumns: TemplateColumn[] = columnRows.map((column) => ({
    title: column.title,
    cards: cardsByColumn.get(column.id) ?? [],
  }));

  const [created] = await db
    .insert(boardTemplates)
    .values({
      userId,
      title: title?.trim() || access.title,
      columns: templateColumns,
    })
    .returning();
  res.status(201).json({ template: boardTemplateDto(created) });
};

/** DELETE /api/board-templates/:id — только собственный шаблон автора. */
const deleteBoardTemplate: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const [existing] = await db
    .select()
    .from(boardTemplates)
    .where(and(eq(boardTemplates.id, req.params.id), eq(boardTemplates.userId, userId)));
  if (!existing) {
    throw new HttpError(404, 'TEMPLATE_NOT_FOUND', 'Шаблон не найден');
  }
  await db.delete(boardTemplates).where(eq(boardTemplates.id, existing.id));
  res.json({ ok: true });
};

boardTemplatesRouter.get('/', listBoardTemplates);
boardTemplatesRouter.post('/', saveBoardTemplate);
boardTemplatesRouter.delete('/:id', deleteBoardTemplate);
