import { Router } from 'express';
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import {
  can,
  createBoardSchema,
  favoriteBoardSchema,
  renameBoardSchema,
  SYSTEM_BOARD_TEMPLATES,
  updateMemberSchema,
  type BoardAction,
  type BoardDto,
  type BoardRole,
  type BoardSnapshot,
  type CardDto,
  type ColumnDto,
  type MemberDto,
  type TemplateColumn,
} from '@task-board/shared';
import { db, env } from '../db';
import { boardMembers, boards, boardTemplates, cards, columns, invites, users } from '../db/schema';
import { HttpError } from './errors';
import { requireUserId } from './session';
import { emitToBoard } from '../ws/emit';

export const boardsRouter = Router();

type Access = {
  boardId: string;
  title: string;
  role: BoardRole;
  verified: boolean;
  archived: boolean;
  favorite: boolean;
};
type DbRole = typeof boardMembers.$inferSelect['role'];

/** В БД enum хранит legacy-значение MEMBER (v1) — наружу отдаём только 4 роли (v2). */
export function normalizeRole(role: DbRole): BoardRole {
  return role === 'MEMBER' ? 'EDITOR' : role;
}

/** Проверка права по матрице FR-23; бросает 403, который превращается в ошибку API/WS. */
export function requirePermission(role: BoardRole, action: BoardAction): void {
  if (!can(role, action)) {
    throw new HttpError(403, 'FORBIDDEN', 'Недостаточно прав для этого действия');
  }
}

/**
 * Право + ограничения неподтверждённого email (FR-32): нельзя приглашать и управлять
 * участниками; нельзя редактировать содержимое чужих досок. Свои доски — можно.
 */
export function requireAction(access: Access, action: BoardAction): void {
  requirePermission(access.role, action);
  // Архивная доска — только просмотр; владелец может удалить или восстановить её
  if (access.archived && action !== 'deleteBoard' && action !== 'archiveBoard') {
    throw new HttpError(403, 'BOARD_ARCHIVED', 'Доска в архиве — доступен только просмотр');
  }
  if (access.verified) return;
  if (action === 'invite' || action === 'manageMembers') {
    throw new HttpError(403, 'EMAIL_NOT_VERIFIED', 'Подтвердите email, чтобы управлять участниками доски');
  }
  if (action === 'editContent' && access.role !== 'OWNER') {
    throw new HttpError(403, 'EMAIL_NOT_VERIFIED', 'Подтвердите email, чтобы изменять доски, где вы не владелец');
  }
}

/** Доступ к доске: участник или владелец; иначе 404 (не раскрываем существование). */
export async function boardAccess(userId: string, boardId: string): Promise<Access> {
  const [row] = await db
    .select({
      boardId: boards.id,
      title: boards.title,
      role: boardMembers.role,
      favorite: boardMembers.favorite,
      archivedAt: boards.archivedAt,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(boards)
    .innerJoin(boardMembers, and(eq(boardMembers.boardId, boards.id), eq(boardMembers.userId, userId)))
    .innerJoin(users, eq(users.id, userId))
    .where(eq(boards.id, boardId));
  if (!row) {
    throw new HttpError(404, 'BOARD_NOT_FOUND', 'Доска не найдена или нет доступа');
  }
  return {
    boardId: row.boardId,
    title: row.title,
    role: normalizeRole(row.role),
    verified: !env.REQUIRE_EMAIL_VERIFICATION || row.emailVerifiedAt !== null,
    archived: row.archivedAt !== null,
    favorite: row.favorite,
  };
}

/** Доступ через колонку (для карточек и колонок по их id). */
export async function columnAccess(userId: string, columnId: string): Promise<Access & { columnId: string }> {
  const [column] = await db.select().from(columns).where(eq(columns.id, columnId));
  if (!column) {
    throw new HttpError(404, 'COLUMN_NOT_FOUND', 'Колонка не найдена');
  }
  const access = await boardAccess(userId, column.boardId);
  return { ...access, columnId: column.id };
}

/** Доступ через карточку. */
export async function cardAccess(userId: string, cardId: string): Promise<Access & { columnId: string }> {
  const [card] = await db.select().from(cards).where(eq(cards.id, cardId));
  if (!card) {
    throw new HttpError(404, 'CARD_NOT_FOUND', 'Карточка не найдена');
  }
  const access = await columnAccess(userId, card.columnId);
  return access;
}

export function boardDto(
  board: { id: string; title: string; createdAt: Date; updatedAt: Date; archivedAt: Date | null },
  role: BoardRole,
  favorite = false,
): BoardDto {
  return {
    id: board.id,
    title: board.title,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
    role,
    archivedAt: board.archivedAt ? board.archivedAt.toISOString() : null,
    favorite,
  };
}

export function columnDto(column: { id: string; boardId: string; title: string; position: number }): ColumnDto {
  return { id: column.id, boardId: column.boardId, title: column.title, position: column.position };
}

export function cardDto(card: typeof cards.$inferSelect): CardDto {
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

function memberDto(user: typeof users.$inferSelect, role: DbRole): MemberDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: normalizeRole(role),
    description: user.description,
    phone: user.phone,
    messengers: user.messengers ?? [],
  };
}

/** Полный снапшот доски (FR-9: тот же формат у WS board:state). */
export async function snapshot(boardId: string, role: BoardRole, favorite = false): Promise<BoardSnapshot> {
  const [board] = await db.select().from(boards).where(eq(boards.id, boardId));
  if (!board) {
    throw new HttpError(404, 'BOARD_NOT_FOUND', 'Доска не найдена');
  }
  const columnRows = await db
    .select()
    .from(columns)
    .where(eq(columns.boardId, boardId))
    .orderBy(asc(columns.position));
  const columnIds = columnRows.map((c) => c.id);
  const cardRows = columnIds.length
    ? await db
        .select()
        .from(cards)
        .where(inArray(cards.columnId, columnIds))
        .orderBy(asc(cards.position))
    : [];
  const memberRows = await db
    .select({ user: users, role: boardMembers.role })
    .from(boardMembers)
    .innerJoin(users, eq(users.id, boardMembers.userId))
    .where(eq(boardMembers.boardId, boardId))
    .orderBy(asc(boardMembers.joinedAt));

  return {
    board: boardDto(board, role, favorite),
    columns: columnRows.map(columnDto),
    cards: cardRows.map(cardDto),
    members: memberRows.map((m) => memberDto(m.user, m.role)),
  };
}

// --- Доски (FR-8: CRUD досок остаётся на REST) ---

const listBoards: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const archived = req.query.archived === '1';
  const rows = await db
    .select({ board: boards, role: boardMembers.role, favorite: boardMembers.favorite })
    .from(boardMembers)
    .innerJoin(boards, eq(boards.id, boardMembers.boardId))
    .where(and(eq(boardMembers.userId, userId), archived ? isNotNull(boards.archivedAt) : isNull(boards.archivedAt)))
    .orderBy(desc(boards.updatedAt));
  res.json({ boards: rows.map((r) => boardDto(r.board, normalizeRole(r.role), r.favorite)) });
};

const createBoard: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const [account] = await db
    .select({ emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, userId));
  if (env.REQUIRE_EMAIL_VERIFICATION && !account?.emailVerifiedAt) {
    throw new HttpError(403, 'EMAIL_NOT_VERIFIED', 'Подтвердите email, чтобы создавать доски');
  }
  const { title, templateId } = createBoardSchema.parse(req.body);

  // Шаблон доски (FR-51): системный или собственный; колонки/карточки копируются.
  let templateColumns: TemplateColumn[];
  if (templateId) {
    const system = SYSTEM_BOARD_TEMPLATES.find((t) => t.id === templateId);
    if (system) {
      templateColumns = system.columns;
    } else {
      const [row] = await db
        .select()
        .from(boardTemplates)
        .where(and(eq(boardTemplates.id, templateId), eq(boardTemplates.userId, userId)));
      if (!row) {
        throw new HttpError(404, 'TEMPLATE_NOT_FOUND', 'Шаблон не найден');
      }
      templateColumns = row.columns ?? [];
    }
  } else {
    templateColumns = ['To Do', 'In Progress', 'Done'].map((columnTitle) => ({ title: columnTitle, cards: [] }));
  }

  const board = await db.transaction(async (tx) => {
    const [created] = await tx.insert(boards).values({ title }).returning();
    await tx.insert(boardMembers).values({ boardId: created.id, userId, role: 'OWNER' });
    for (const [i, templateColumn] of templateColumns.entries()) {
      const [column] = await tx
        .insert(columns)
        .values({ boardId: created.id, title: templateColumn.title, position: (i + 1) * 1024 })
        .returning();
      if (templateColumn.cards.length > 0) {
        await tx.insert(cards).values(
          templateColumn.cards.map((card, j) => ({
            columnId: column.id,
            title: card.title,
            description: card.description,
            position: (j + 1) * 1024,
            authorId: userId,
          })),
        );
      }
    }
    return created;
  });
  res.status(201).json({ board: boardDto(board, 'OWNER', false) });
};

const getBoard: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const access = await boardAccess(userId, req.params.id);
  res.json(await snapshot(access.boardId, access.role, access.favorite));
};

const renameBoard: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const access = await boardAccess(userId, req.params.id);
  requireAction(access, 'renameBoard');
  const { title } = renameBoardSchema.parse(req.body);
  await db.update(boards).set({ title }).where(eq(boards.id, access.boardId));
  res.json(await snapshot(access.boardId, access.role, access.favorite));
};

const deleteBoard: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const access = await boardAccess(userId, req.params.id);
  requireAction(access, 'deleteBoard');
  await db.delete(boards).where(eq(boards.id, access.boardId));
  res.json({ ok: true });
};

// --- Архив и избранное (v2, фаза 15) ---

const archiveBoard: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const access = await boardAccess(userId, req.params.id);
  requireAction(access, 'archiveBoard');
  if (access.archived) {
    throw new HttpError(400, 'BOARD_ALREADY_ARCHIVED', 'Доска уже в архиве');
  }
  const archivedAt = new Date();
  await db.update(boards).set({ archivedAt }).where(eq(boards.id, access.boardId));
  emitToBoard(access.boardId, 'board:archived', {
    boardId: access.boardId,
    archivedAt: archivedAt.toISOString(),
  });
  res.json(await snapshot(access.boardId, access.role, access.favorite));
};

const restoreBoard: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const access = await boardAccess(userId, req.params.id);
  requireAction(access, 'archiveBoard');
  await db.update(boards).set({ archivedAt: null }).where(eq(boards.id, access.boardId));
  emitToBoard(access.boardId, 'board:restored', { boardId: access.boardId, archivedAt: null });
  res.json(await snapshot(access.boardId, access.role, access.favorite));
};

const setFavorite: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const access = await boardAccess(userId, req.params.id);
  requireAction(access, 'view');
  const { favorite } = favoriteBoardSchema.parse(req.body);
  await db
    .update(boardMembers)
    .set({ favorite })
    .where(and(eq(boardMembers.boardId, access.boardId), eq(boardMembers.userId, userId)));
  // Избранное персонально — никому больше не транслируем; клиент обновляет локально.
  res.json({ boardId: access.boardId, favorite });
};

// --- Участники и роли (v2, FR-23–24) ---

const listMembers: RequestHandler<{ id: string }> = async (req, res) => {
  const userId = await requireUserId(req);
  const access = await boardAccess(userId, req.params.id);
  const rows = await db
    .select({ user: users, role: boardMembers.role })
    .from(boardMembers)
    .innerJoin(users, eq(users.id, boardMembers.userId))
    .where(eq(boardMembers.boardId, access.boardId))
    .orderBy(asc(boardMembers.joinedAt));
  res.json({ members: rows.map((r) => memberDto(r.user, r.role)) });
};

const updateMember: RequestHandler<{ id: string; userId: string }> = async (req, res) => {
  const actorId = await requireUserId(req);
  const access = await boardAccess(actorId, req.params.id);
  requireAction(access, 'manageMembers');
  const { role } = updateMemberSchema.parse(req.body);
  const targetId = req.params.userId;

  const [target] = await db
    .select()
    .from(boardMembers)
    .where(and(eq(boardMembers.boardId, access.boardId), eq(boardMembers.userId, targetId)));
  if (!target) {
    throw new HttpError(404, 'MEMBER_NOT_FOUND', 'Участник не найден');
  }
  if (target.role === 'OWNER') {
    throw new HttpError(403, 'FORBIDDEN', 'Роль владельца изменить нельзя');
  }
  // Назначать и снимать ADMIN может только владелец
  if (!can(access.role, 'assignAdmin') && (role === 'ADMIN' || target.role === 'ADMIN')) {
    throw new HttpError(403, 'FORBIDDEN', 'Назначать и снимать админов может только владелец');
  }

  const [updated] = await db
    .update(boardMembers)
    .set({ role })
    .where(and(eq(boardMembers.boardId, access.boardId), eq(boardMembers.userId, targetId)))
    .returning();
  const [user] = await db.select().from(users).where(eq(users.id, targetId));
  const member = memberDto(user, updated.role);
  emitToBoard(access.boardId, 'member:updated', { boardId: access.boardId, member });
  res.json({ member });
};

const removeMember: RequestHandler<{ id: string; userId: string }> = async (req, res) => {
  const actorId = await requireUserId(req);
  const access = await boardAccess(actorId, req.params.id);
  requireAction(access, 'manageMembers');
  const targetId = req.params.userId;

  const [target] = await db
    .select()
    .from(boardMembers)
    .where(and(eq(boardMembers.boardId, access.boardId), eq(boardMembers.userId, targetId)));
  if (!target) {
    throw new HttpError(404, 'MEMBER_NOT_FOUND', 'Участник не найден');
  }
  if (target.role === 'OWNER') {
    throw new HttpError(403, 'FORBIDDEN', 'Владельца нельзя удалить из доски');
  }
  if (!can(access.role, 'assignAdmin') && target.role === 'ADMIN') {
    throw new HttpError(403, 'FORBIDDEN', 'Удалить админа может только владелец');
  }

  // Удаляем участника и отзываем ссылку, по которой он вступил:
  // иначе он вернётся в доску по той же самой ссылке (v2).
  // Для участников, вступивших до v2 (inviteId неизвестен), отзываем все активные ссылки.
  const revokedInviteIds = await db.transaction(async (tx) => {
    await tx
      .delete(boardMembers)
      .where(and(eq(boardMembers.boardId, access.boardId), eq(boardMembers.userId, targetId)));

    const activeInvites = await tx
      .select({ id: invites.id })
      .from(invites)
      .where(
        and(
          eq(invites.boardId, access.boardId),
          isNull(invites.revokedAt),
          target.inviteId ? eq(invites.id, target.inviteId) : undefined,
        ),
      );
    if (activeInvites.length === 0) return [] as string[];

    const ids = activeInvites.map((i) => i.id);
    await tx.update(invites).set({ revokedAt: new Date() }).where(inArray(invites.id, ids));
    return ids;
  });

  emitToBoard(access.boardId, 'member:removed', { boardId: access.boardId, userId: targetId });
  res.json({ ok: true, revokedInvites: revokedInviteIds.length });
};

boardsRouter.get('/', listBoards);
boardsRouter.post('/', createBoard);
boardsRouter.get('/:id/members', listMembers);
boardsRouter.patch('/:id/members/:userId', updateMember);
boardsRouter.delete('/:id/members/:userId', removeMember);
boardsRouter.post('/:id/archive', archiveBoard);
boardsRouter.post('/:id/restore', restoreBoard);
boardsRouter.patch('/:id/favorite', setFavorite);
boardsRouter.get('/:id', getBoard);
boardsRouter.patch('/:id', renameBoard);
boardsRouter.delete('/:id', deleteBoard);
