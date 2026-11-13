// Логика позиций (7.2, FR-6): вставка между соседями = среднее; вставка в конец =
// last + STEP; при схлопывании зазора (< EPS) — перенормировка всей колонки одним SQL.
import { and, asc, eq, inArray, max } from 'drizzle-orm';
import { sql, type SQL } from 'drizzle-orm';
import type { CardDto, ColumnDto } from '@task-board/shared';
import { db } from '../db';
import { boardMembers, cards, columns } from '../db/schema';
import { HttpError } from '../http/errors';

const STEP = 1024;
const EPS = 0.001;

type CardRow = typeof cards.$inferSelect;
type ColumnRow = typeof columns.$inferSelect;

/** Следующая позиция в конце списка (FR-6: вставка в конец = last + STEP). */
export async function nextColumnPosition(boardId: string): Promise<number> {
  const [row] = await db.select({ maxPos: max(columns.position) }).from(columns).where(eq(columns.boardId, boardId));
  return (row?.maxPos ?? 0) + STEP;
}

export async function nextCardPosition(columnId: string): Promise<number> {
  const [row] = await db.select({ maxPos: max(cards.position) }).from(cards).where(eq(cards.columnId, columnId));
  return (row?.maxPos ?? 0) + STEP;
}

function cardDto(card: CardRow): CardDto {
  return {
    id: card.id,
    columnId: card.columnId,
    title: card.title,
    description: card.description,
    position: card.position,
    authorId: card.authorId,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  };
}

function columnDto(column: ColumnRow): ColumnDto {
  return { id: column.id, boardId: column.boardId, title: column.title, position: column.position };
}

async function requireBoardRole(userId: string, boardId: string): Promise<void> {
  const [membership] = await db
    .select()
    .from(boardMembers)
    .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId)));
  if (!membership) {
    throw new HttpError(404, 'BOARD_NOT_FOUND', 'Доска не найдена или нет доступа');
  }
}

/** Позиция вставки по beforeId/afterId в упорядоченном списке без перемещаемого элемента. */
function insertIndex(list: { id: string }[], beforeId: string | null, afterId: string | null): number {
  let index = list.length; // по умолчанию — в конец
  if (afterId) {
    const i = list.findIndex((x) => x.id === afterId);
    if (i !== -1) index = i + 1;
  } else if (beforeId) {
    const i = list.findIndex((x) => x.id === beforeId);
    if (i !== -1) index = i;
  }
  return index;
}

/** Перенормировка: все элементы списка получают позиции i * STEP одним батч-SQL.
 *  Обязательна на том же соединении, что и транзакция (иначе — блокировки и дедлоки). */
type Executor = { execute: (query: SQL) => Promise<unknown> };

async function renormalize(
  exec: Executor,
  table: typeof cards | typeof columns,
  rows: { id: string; pos: number }[],
): Promise<void> {
  if (rows.length === 0) return;
  const values = sql.join(
    rows.map((r) => sql`(${r.id}::text, ${r.pos}::double precision)`),
    sql`, `,
  );
  await exec.execute(sql`UPDATE ${table} SET position = v.pos FROM (VALUES ${values}) AS v(id, pos) WHERE ${table}.id = v.id`);
}

export async function moveCard(
  userId: string,
  cardId: string,
  toColumnId: string,
  beforeId: string | null,
  afterId: string | null,
): Promise<{ boardId: string; cards: CardDto[] }> {
  const [cardRow] = await db
    .select({ card: cards, boardId: columns.boardId })
    .from(cards)
    .innerJoin(columns, eq(columns.id, cards.columnId))
    .where(eq(cards.id, cardId));
  if (!cardRow) {
    throw new HttpError(404, 'CARD_NOT_FOUND', 'Карточка не найдена');
  }
  const [target] = await db.select().from(columns).where(eq(columns.id, toColumnId));
  if (!target) {
    throw new HttpError(404, 'COLUMN_NOT_FOUND', 'Колонка не найдена');
  }
  if (target.boardId !== cardRow.boardId) {
    throw new HttpError(400, 'INVALID_TARGET', 'Колонка принадлежит другой доске');
  }
  await requireBoardRole(userId, cardRow.boardId);

  const sourceColumnId = cardRow.card.columnId;

  const result = await db.transaction(async (tx) => {
    const siblings = await tx.select().from(cards).where(eq(cards.columnId, toColumnId)).orderBy(asc(cards.position));
    const list: CardRow[] = siblings.filter((c) => c.id !== cardId);
    const index = insertIndex(list, beforeId, afterId);

    const before = list[index - 1]?.position ?? 0;
    const after = list[index]?.position ?? before + STEP;
    let position = (before + after) / 2;

    if (after - before < EPS) {
      // Зазор схлопнулся — перенормировка колонки с карточкой на её месте
      list.splice(index, 0, { ...cardRow.card, columnId: toColumnId });
      const rows = list.map((c, i) => ({ id: c.id, pos: (i + 1) * STEP }));
      position = rows.find((r) => r.id === cardId)!.pos;
      await renormalize(tx, cards, rows);
      // Батч меняет только position — колонку перемещаемой карточки ставим отдельно
      await tx.update(cards).set({ columnId: toColumnId }).where(eq(cards.id, cardId));
    } else {
      await tx.update(cards).set({ columnId: toColumnId, position }).where(eq(cards.id, cardId));
    }

    const columnIds = sourceColumnId === toColumnId ? [toColumnId] : [sourceColumnId, toColumnId];
    const fresh = await tx.select().from(cards).where(inArray(cards.columnId, columnIds)).orderBy(asc(cards.position));
    return fresh.map(cardDto);
  });

  return { boardId: cardRow.boardId, cards: result };
}

export async function moveColumn(
  userId: string,
  columnId: string,
  beforeId: string | null,
  afterId: string | null,
): Promise<{ boardId: string; columns: ColumnDto[] }> {
  const [columnRow] = await db.select().from(columns).where(eq(columns.id, columnId));
  if (!columnRow) {
    throw new HttpError(404, 'COLUMN_NOT_FOUND', 'Колонка не найдена');
  }
  await requireBoardRole(userId, columnRow.boardId);

  const siblings = await db
    .select()
    .from(columns)
    .where(eq(columns.boardId, columnRow.boardId))
    .orderBy(asc(columns.position));
  const list: ColumnRow[] = siblings.filter((c) => c.id !== columnId);
  const index = insertIndex(list, beforeId, afterId);

  const before = list[index - 1]?.position ?? 0;
  const after = list[index]?.position ?? before + STEP;
  let position = (before + after) / 2;

  if (after - before < EPS) {
    list.splice(index, 0, { ...columnRow, position: 0 });
    const rows = list.map((c, i) => ({ id: c.id, pos: (i + 1) * STEP }));
    position = rows.find((r) => r.id === columnId)!.pos;
    await renormalize(db, columns, rows);
  } else {
    await db.update(columns).set({ position }).where(eq(columns.id, columnId));
  }

  const fresh = await db
    .select()
    .from(columns)
    .where(eq(columns.boardId, columnRow.boardId))
    .orderBy(asc(columns.position));
  return { boardId: columnRow.boardId, columns: fresh.map(columnDto) };
}
