import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type {
  BoardSnapshot,
  CardDto,
  ColumnDto,
  ColumnTemplateDto,
  MemberDto,
  PresenceUser,
} from '@task-board/shared';
import { BOARD_ROLE_LABELS, can } from '@task-board/shared';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  GripVertical,
  LayoutGrid,
  MoreHorizontal,
  Save,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import * as boardsApi from '../api/boards';
import * as templatesApi from '../api/templates';
import { getSocket } from '../api/socket';
import { errorText, useAuth } from '../state/auth-context';
import { cn } from '@/lib/utils';
import { MembersBar } from '@/components/MembersBar';
import { BoardAccessModal } from '@/components/BoardAccessModal';
import { EmailVerificationBanner } from '@/components/EmailVerificationBanner';
import { ThemeToggle } from '@/components/theme-toggle';
import { BoardTitle } from '@/components/board/board-title';
import { ColumnView } from '@/components/board/column-view';
import { NewColumnForm } from '@/components/board/new-column-form';
import type { WsApi } from '@/components/board/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const STEP = 1024;

/** Слияние по id: delta-события (FR-12) обновляют сущности, не затрагивая остальные. */
function mergeById<T extends { id: string }>(prev: T[], updated: T[]): T[] {
  const map = new Map(prev.map((x) => [x.id, x]));
  for (const x of updated) map.set(x.id, x);
  return [...map.values()];
}

/**
 * Соседи по индексу в упорядоченном списке без перемещаемого элемента (FR-6).
 * Контракт сервера (services/positions.ts): afterId — «встать сразу после него»,
 * beforeId — «встать сразу перед ним». Позиция = среднее между соседями.
 */
function insertion<T extends { id: string; position: number }>(
  list: T[],
  index: number,
): { beforeId: string | null; afterId: string | null; position: number } {
  const before = list[index - 1]?.position ?? 0;
  const after = list[index]?.position ?? before + STEP;
  return {
    beforeId: list[index]?.id ?? null,
    afterId: list[index - 1]?.id ?? null,
    position: (before + after) / 2,
  };
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Куда встанет карточка: колонка под центром перетаскиваемой карточки + индекс
 * по центрам карточек этой колонки (сама карточка не учитывается).
 * Геометрия, а не dnd-kit-коллизии: превью и дроп считаются одинаково, поэтому
 * место, куда пользователь отпустил, всегда совпадает с сохранённым.
 */
function resolveCardDrop(rect: RectLike, cardId: string): { columnId: string; index: number } | null {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const column = document.elementFromPoint(cx, cy)?.closest<HTMLElement>('[data-column-id]') ?? null;
  const columnId = column?.dataset.columnId;
  if (!column || !columnId) return null;

  const cards = [...column.querySelectorAll<HTMLElement>('[data-card-id]')].filter(
    (el) => el.dataset.cardId !== cardId,
  );
  let index = cards.length;
  for (let i = 0; i < cards.length; i += 1) {
    const box = cards[i].getBoundingClientRect();
    if (cy < box.top + box.height / 2) {
      index = i;
      break;
    }
  }
  return { columnId, index };
}

/** Индекс колонки по центру перетаскиваемой колонки (горизонтальное сравнение). */
function resolveColumnDrop(rect: RectLike, columnId: string): { index: number } | null {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const el = document.elementFromPoint(cx, cy);
  if (!el?.closest('[data-columns-row]')) return null;

  const columns = [...document.querySelectorAll<HTMLElement>('[data-columns-row] > [data-column-id]')].filter(
    (node) => node.dataset.columnId !== columnId,
  );
  let index = columns.length;
  for (let i = 0; i < columns.length; i += 1) {
    const box = columns[i].getBoundingClientRect();
    if (cx < box.left + box.width / 2) {
      index = i;
      break;
    }
  }
  return { index };
}

type DragState =
  | { type: 'card'; card: CardDto; originalIndex: number }
  | { type: 'column'; column: ColumnDto; originalIndex: number }
  | null;

export function BoardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null);
  const [online, setOnline] = useState<PresenceUser[]>([]);
  const [editingByCard, setEditingByCard] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(() => getSocket().connected);
  const [shareOpen, setShareOpen] = useState(false);
  const [templates, setTemplates] = useState<ColumnTemplateDto[]>([]);

  // Перетаскивание: DragOverlay следует за курсором, а «тень»-заглушка живёт
  // в разметке на том месте, куда карточка/колонка встанет после дропа.
  const [activeDrag, setActiveDrag] = useState<DragState>(null);
  const [cardPreview, setCardPreview] = useState<{ columnId: string; index: number } | null>(null);
  const [columnOrder, setColumnOrder] = useState<string[] | null>(null);
  const cardPreviewRef = useRef<{ columnId: string; index: number } | null>(null);
  const columnOrderRef = useRef<string[] | null>(null);
  const wasOffline = useRef(false);

  const showNotice = useCallback((message: string) => {
    toast(message);
  }, []);

  const onRenameBoard = async (title: string) => {
    const result = await boardsApi.renameBoard(snapshot!.board.id, title);
    setSnapshot(result);
    toast.success('Название доски обновлено');
  };

  // Мышь — с порогом 5 px; тач — «долгое нажатие» (220 мс), чтобы свайп
  // оставался прокруткой доски, а не превращался в случайный перенос.
  // Enter не запускает перетаскивание: он открывает карточку (FR-45), drag — Space.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  const columns = useMemo(
    () => (snapshot ? [...snapshot.columns].sort((a, b) => a.position - b.position) : []),
    [snapshot],
  );

  // Права текущего пользователя на доске (FR-23). В архиве — только просмотр (FR-39).
  const archived = snapshot ? snapshot.board.archivedAt !== null : false;
  const canEdit = snapshot ? can(snapshot.board.role, 'editContent') && !archived : false;
  const isOwner = snapshot ? can(snapshot.board.role, 'archiveBoard') : false;

  // Базовый порядок карточек по колонкам (без превью) — источник правды для дропа.
  const cardsByColumnBase = useMemo(() => {
    const map = new Map<string, CardDto[]>();
    for (const column of columns) map.set(column.id, []);
    for (const card of snapshot?.cards ?? []) map.get(card.columnId)?.push(card);
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [columns, snapshot]);

  const setCardPreviewState = useCallback((next: { columnId: string; index: number } | null) => {
    cardPreviewRef.current = next;
    setCardPreview(next);
  }, []);

  const setColumnOrderState = useCallback((next: string[] | null) => {
    columnOrderRef.current = next;
    setColumnOrder(next);
  }, []);

  const clearDrag = useCallback(() => {
    setActiveDrag(null);
    setCardPreviewState(null);
    setColumnOrderState(null);
  }, [setCardPreviewState, setColumnOrderState]);

  /**
   * Клавиатура на доске (FR-45): стрелки — между карточками/колонками,
   * Enter — открыть карточку или перейти к полю «+ карточка», Esc закрывает модалку (Radix).
   * Capture-фаза: Enter перехватываем до keyboard-сенсора dnd-kit, иначе он начнёт drag.
   */
  const onBoardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;

    const row = event.currentTarget;
    const columnEls = [...row.querySelectorAll<HTMLElement>(':scope > [data-column-id]')];
    const cardEl = target.closest<HTMLElement>('[data-card-id]');
    // Кнопки/ссылки/ручки drag (в т.ч. заголовок колонки) обрабатывают клавиши сами
    if (!cardEl && target.closest('button, a, [role="button"], [role="combobox"], [data-column-title]')) return;
    const columnEl = target.closest<HTMLElement>('[data-column-id]');
    const focusElement = (el: HTMLElement | null | undefined) => {
      if (!el) return;
      el.focus();
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };

    if (event.key === 'Enter') {
      if (cardEl) {
        event.preventDefault();
        event.stopPropagation();
        cardEl.click();
        return;
      }
      if (columnEl) {
        // С клавиатуры на колонке Enter ведёт к добавлению карточки
        const input = columnEl.querySelector<HTMLInputElement>('input[placeholder="+ карточка"]');
        if (input) {
          event.preventDefault();
          input.focus();
        }
      }
      return;
    }

    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    if (!columnEls.length) return;
    event.preventDefault();

    const columnIndex = columnEl ? columnEls.indexOf(columnEl) : -1;
    const cards = columnEl ? [...columnEl.querySelectorAll<HTMLElement>('[data-card-id]')] : [];
    const cardIndex = cardEl ? cards.indexOf(cardEl) : -1;

    if (cardIndex !== -1) {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const next = cards[cardIndex + (event.key === 'ArrowDown' ? 1 : -1)];
        focusElement(next);
        return;
      }
      // Влево/вправо — соседняя колонка, карточка на той же позиции (или сама колонка)
      const nextColumn = columnEls[columnIndex + (event.key === 'ArrowRight' ? 1 : -1)];
      if (!nextColumn) return;
      const nextCards = [...nextColumn.querySelectorAll<HTMLElement>('[data-card-id]')];
      focusElement(nextCards[Math.min(cardIndex, nextCards.length - 1)] ?? nextColumn);
      return;
    }

    if (columnIndex !== -1) {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        focusElement(columnEls[columnIndex + (event.key === 'ArrowRight' ? 1 : -1)]);
        return;
      }
      // Вниз/вверх с колонки — к первой/последней карточке
      const nextCards = [...columnEl!.querySelectorAll<HTMLElement>('[data-card-id]')];
      focusElement(event.key === 'ArrowDown' ? nextCards[0] : nextCards[nextCards.length - 1]);
      return;
    }

    focusElement(columnEls[0]);
  };

  const onDragStart = (event: DragStartEvent) => {
    setCardPreviewState(null);
    setColumnOrderState(null);
    // Роль VIEWER не может менять контент — drag не начинаем
    if (!canEdit) return;
    const type = event.active.data.current?.type as 'card' | 'column' | undefined;

    if (type === 'card') {
      const card = snapshot?.cards.find((c) => c.id === event.active.id);
      if (!card) return;
      const originalIndex = (cardsByColumnBase.get(card.columnId) ?? []).findIndex((c) => c.id === card.id);
      setActiveDrag({ type: 'card', card, originalIndex });
    } else if (type === 'column') {
      const column = columns.find((c) => c.id === event.active.id);
      if (!column) return;
      setActiveDrag({ type: 'column', column, originalIndex: columns.findIndex((c) => c.id === column.id) });
      setColumnOrderState(columns.map((c) => c.id));
    }
  };

  const onDragMove = (event: DragMoveEvent) => {
    const rect = event.active.rect.current.translated;
    if (!rect || !activeDrag) return;
    // Без связи мутацию не отправить: не показываем фантомный перенос
    if (!getSocket().connected) return;

    if (activeDrag.type === 'card') {
      const target = resolveCardDrop(rect, activeDrag.card.id);
      if (!target) {
        if (cardPreviewRef.current) setCardPreviewState(null);
        return;
      }
      const current = cardPreviewRef.current;
      if (current && current.columnId === target.columnId && current.index === target.index) return;
      setCardPreviewState(target);
      return;
    }

    const target = resolveColumnDrop(rect, activeDrag.column.id);
    if (!target) {
      if (columnOrderRef.current) setColumnOrderState(null);
      return;
    }
    const base = (columnOrderRef.current ?? columns.map((c) => c.id)).filter((cid) => cid !== activeDrag.column.id);
    const index = Math.max(0, Math.min(target.index, base.length));
    const next = [...base.slice(0, index), activeDrag.column.id, ...base.slice(index)];
    if (columnOrderRef.current && sameOrder(columnOrderRef.current, next)) return;
    setColumnOrderState(next);
  };

  // Коллизия: приоритет — droppable под курсором, иначе ближайшие углы (для over/отмены).
  const collisionDetection: CollisionDetection = (args) => {
    const pointer = pointerWithin(args);
    return pointer.length > 0 ? pointer : closestCorners(args);
  };

  const onDragEnd = () => {
    const drag = activeDrag;
    if (!drag) {
      clearDrag();
      return;
    }
    // Офлайн: подтвердить нечего — сервер мутацию не получит
    if (!getSocket().connected) {
      clearDrag();
      showNotice('Нет соединения — изменение не сохранено');
      return;
    }

    if (drag.type === 'card') {
      // Источник истины — последнее превью: «тень» стоит именно там, куда упадёт карточка.
      const target = cardPreviewRef.current;
      setCardPreviewState(null);
      if (!target) {
        // Дроп вне колонок: карточка осталась на прежнем месте (FR-7, как в Trello)
        showNotice('Перетаскивание отменено — отпустите карточку над колонкой');
        return;
      }
      if (target.columnId === drag.card.columnId && target.index === drag.originalIndex) return;

      const list = cardsByColumnBase.get(target.columnId)?.filter((c) => c.id !== drag.card.id) ?? [];
      const ins = insertion(list, Math.min(target.index, list.length));
      // optimistic: карточка сразу на новом месте, серверный broadcast сверяет (FR-11)
      setSnapshot(
        (prev) =>
          prev && {
            ...prev,
            cards: prev.cards.map((c) =>
              c.id === drag.card.id ? { ...c, columnId: target.columnId, position: ins.position } : c,
            ),
          },
      );
      getSocket().emit('card:move', {
        id: drag.card.id,
        toColumnId: target.columnId,
        beforeId: ins.beforeId,
        afterId: ins.afterId,
      });
      return;
    }

    // Колонки: порядок из превью, а не пересчёт по «уехавшему» макету.
    const preview = columnOrderRef.current;
    setColumnOrderState(null);
    if (!preview) {
      showNotice('Перемещение колонки отменено');
      return;
    }
    const index = preview.indexOf(drag.column.id);
    if (index === -1 || index === drag.originalIndex) return;

    const list = columns.filter((c) => c.id !== drag.column.id);
    const ins = insertion(list, Math.min(index, list.length));
    setSnapshot(
      (prev) =>
        prev && {
          ...prev,
          columns: prev.columns.map((c) => (c.id === drag.column.id ? { ...c, position: ins.position } : c)),
        },
    );
    getSocket().emit('column:move', {
      id: drag.column.id,
      beforeId: ins.beforeId,
      afterId: ins.afterId,
    });
  };

  useEffect(() => {
    templatesApi
      .listTemplates()
      .then((res) => setTemplates(res.templates))
      .catch(() => undefined);
  }, []);

  // WS: снапшот, presence и события мутаций (FR-9, FR-13, FR-14, фаза 8)
  useEffect(() => {
    if (!id) return;
    const socket = getSocket();

    const onState = (snap: BoardSnapshot) => {
      setSnapshot(snap);
      setError(null);
    };
    const onPresence = (payload: { boardId: string; users: PresenceUser[] }) => {
      if (payload.boardId === id) setOnline(payload.users);
    };
    const onWsError = (e: { code: string; message: string }) => {
      // Ошибка конкретной мутации не должна убивать доску: тост + перечитывание
      // снапшота (сервер авторитетен, клиент мог разойтись с ним).
      showNotice(e.message);
      void boardsApi
        .getBoard(id)
        .then(setSnapshot)
        .catch(() => undefined);
    };
    const onCardMoved = (payload: { cards: CardDto[] }) =>
      setSnapshot((prev) => prev && { ...prev, cards: mergeById(prev.cards, payload.cards) });
    const onColumnMoved = (payload: { columns: ColumnDto[] }) =>
      setSnapshot((prev) => prev && { ...prev, columns: mergeById(prev.columns, payload.columns) });
    const onColumnCreated = (payload: { column: ColumnDto }) =>
      setSnapshot((prev) => prev && { ...prev, columns: [...prev.columns, payload.column] });
    const onColumnUpdated = (payload: { column: ColumnDto }) =>
      setSnapshot((prev) => prev && { ...prev, columns: mergeById(prev.columns, [payload.column]) });
    const onColumnDeleted = (payload: { columnId: string }) =>
      setSnapshot(
        (prev) =>
          prev && {
            ...prev,
            columns: prev.columns.filter((c) => c.id !== payload.columnId),
            cards: prev.cards.filter((c) => c.columnId !== payload.columnId),
          },
      );
    const onCardCreated = (payload: { card: CardDto }) =>
      setSnapshot((prev) => prev && { ...prev, cards: [...prev.cards, payload.card] });
    const onCardUpdated = (payload: { card: CardDto }) =>
      setSnapshot((prev) => prev && { ...prev, cards: mergeById(prev.cards, [payload.card]) });
    const onCardDeleted = (payload: { cardId: string; columnId: string }) =>
      setSnapshot((prev) => prev && { ...prev, cards: prev.cards.filter((c) => c.id !== payload.cardId) });
    const onCardsCreated = (payload: { cards: CardDto[] }) =>
      setSnapshot((prev) => prev && { ...prev, cards: [...prev.cards, ...payload.cards] });
    const onBoardArchived = (payload: { boardId: string; archivedAt: string }) =>
      setSnapshot((prev) =>
        prev && prev.board.id === payload.boardId
          ? { ...prev, board: { ...prev.board, archivedAt: payload.archivedAt } }
          : prev,
      );
    const onBoardRestored = (payload: { boardId: string; archivedAt: null }) =>
      setSnapshot((prev) =>
        prev && prev.board.id === payload.boardId
          ? { ...prev, board: { ...prev.board, archivedAt: payload.archivedAt } }
          : prev,
      );
    const onBoardUpdated = (payload: { boardId: string; title: string }) =>
      setSnapshot((prev) =>
        prev && prev.board.id === payload.boardId ? { ...prev, board: { ...prev.board, title: payload.title } } : prev,
      );
    const onMemberUpdated = (payload: { boardId: string; member: MemberDto }) =>
      setSnapshot(
        (prev) =>
          prev && {
            ...prev,
            members: prev.members.map((m) => (m.id === payload.member.id ? payload.member : m)),
            board:
              payload.member.id === user?.id ? { ...prev.board, role: payload.member.role } : prev.board,
          },
      );
    const onMemberRemoved = (payload: { boardId: string; userId: string }) => {
      if (payload.userId === user?.id) {
        showNotice('Доступ к доске отозван');
        navigate('/boards');
        return;
      }
      setSnapshot(
        (prev) => prev && { ...prev, members: prev.members.filter((m) => m.id !== payload.userId) },
      );
    };
    const onEditing = (payload: { cardId: string; userId: string | null }) =>
      setEditingByCard((prev) => {
        const next = { ...prev };
        // Свой бейдж «редактирует» не показываем — только чужой
        if (payload.userId && payload.userId !== user?.id) next[payload.cardId] = payload.userId;
        else delete next[payload.cardId];
        return next;
      });

    socket.on('board:state', onState);
    socket.on('presence:update', onPresence);
    socket.on('ws:error', onWsError);
    socket.on('card:moved', onCardMoved);
    socket.on('column:moved', onColumnMoved);
    socket.on('column:created', onColumnCreated);
    socket.on('column:updated', onColumnUpdated);
    socket.on('column:deleted', onColumnDeleted);
    socket.on('card:created', onCardCreated);
    socket.on('card:updated', onCardUpdated);
    socket.on('card:deleted', onCardDeleted);
    socket.on('cards:created', onCardsCreated);
    socket.on('board:archived', onBoardArchived);
    socket.on('board:restored', onBoardRestored);
    socket.on('board:updated', onBoardUpdated);
    socket.on('member:updated', onMemberUpdated);
    socket.on('member:removed', onMemberRemoved);
    socket.on('presence:editing', onEditing);

    // Переподключение (потеря сети, bfcache, рестарт сервера): заново вступаем
    // в комнату доски — иначе события мутаций не доходят, а emits теряются.
    const join = () => socket.emit('board:join', { boardId: id });
    const onConnect = () => {
      setConnected(true);
      if (wasOffline.current) {
        wasOffline.current = false;
        showNotice('Связь восстановлена');
      }
      join();
    };
    const onDisconnect = () => {
      wasOffline.current = true;
      setConnected(false);
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted && !socket.connected) socket.connect();
      if (socket.connected) join();
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    window.addEventListener('pageshow', onPageShow);
    setConnected(socket.connected);
    if (socket.connected) join();

    return () => {
      if (socket.connected) socket.emit('board:leave', { boardId: id });
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      window.removeEventListener('pageshow', onPageShow);
      socket.off('board:state', onState);
      socket.off('presence:update', onPresence);
      socket.off('ws:error', onWsError);
      socket.off('card:moved', onCardMoved);
      socket.off('column:moved', onColumnMoved);
      socket.off('column:created', onColumnCreated);
      socket.off('column:updated', onColumnUpdated);
      socket.off('column:deleted', onColumnDeleted);
      socket.off('card:created', onCardCreated);
      socket.off('card:updated', onCardUpdated);
      socket.off('card:deleted', onCardDeleted);
      socket.off('cards:created', onCardsCreated);
      socket.off('board:archived', onBoardArchived);
      socket.off('board:restored', onBoardRestored);
      socket.off('board:updated', onBoardUpdated);
      socket.off('member:updated', onMemberUpdated);
      socket.off('member:removed', onMemberRemoved);
      socket.off('presence:editing', onEditing);
    };
  }, [id, showNotice, user?.id]);

  // WS-мутации (FR-8, фаза 8): optimistic не нужен — событие от сервера
  // перезаписывает состояние (reconciliation, конституция №3)
  const ws = useMemo<WsApi>(() => {
    const socket = getSocket();
    const boardId = id;
    // Офлайн-мутации не буферизуем: socket.io иначе отправит устаревший intent
    // после реконнекта. Честнее сказать «не сохранено» и не менять UI.
    const guard = () => {
      if (socket.connected) return true;
      showNotice('Нет соединения — изменение не сохранено');
      return false;
    };
    return {
      createColumn: (title: string) => {
        if (!boardId || !guard()) return;
        socket.emit('column:create', { boardId, title });
        toast.success('Колонка добавлена');
      },
      createColumnFromTemplate: (templateId: string, title?: string) => {
        if (!boardId || !guard()) return;
        socket.emit(
          'column:create-from-template',
          title?.trim() ? { boardId, templateId, title: title.trim() } : { boardId, templateId },
        );
        toast.success('Колонка добавлена из шаблона');
      },
      renameColumn: (columnId: string, title: string) => {
        if (!guard()) return;
        socket.emit('column:rename', { id: columnId, title });
      },
      deleteColumn: (columnId: string) => {
        if (!guard()) return;
        socket.emit('column:delete', { id: columnId });
        toast.success('Колонка удалена');
      },
      createCard: (columnId: string, title: string) => {
        if (!guard()) return;
        socket.emit('card:create', { columnId, title });
      },
      updateCard: (cardId: string, patch: { title?: string; description?: string | null }) => {
        if (!guard()) return;
        socket.emit('card:update', { id: cardId, ...patch });
      },
      moveCardToEnd: (cardId: string, toColumnId: string) => {
        if (!guard()) return;
        socket.emit('card:move', { id: cardId, toColumnId, beforeId: null, afterId: null });
      },
      deleteCard: (cardId: string) => {
        if (!guard()) return;
        socket.emit('card:delete', { id: cardId });
      },
      editingStart: (cardId: string) => {
        if (!guard()) return;
        socket.emit('card:editing-start', { cardId });
      },
      editingStop: (cardId: string) => {
        if (!guard()) return;
        socket.emit('card:editing-stop', { cardId });
      },
    };
  }, [id, showNotice]);

  const reload = useCallback(async () => {
    if (!id) return;
    try {
      setSnapshot(await boardsApi.getBoard(id));
      setError(null);
    } catch (err) {
      setError(errorText(err));
      setSnapshot(null);
    }
  }, [id]);

  // --- Архив, избранное, шаблоны (v2, фаза 15) ---

  const onToggleFavorite = async () => {
    if (!snapshot) return;
    const favorite = !snapshot.board.favorite;
    setSnapshot((prev) => prev && { ...prev, board: { ...prev.board, favorite } });
    try {
      await boardsApi.setBoardFavorite(snapshot.board.id, favorite);
      toast.success(favorite ? 'Доска в избранном' : 'Убрано из избранного');
    } catch (err) {
      setSnapshot((prev) => prev && { ...prev, board: { ...prev.board, favorite: !favorite } });
      toast.error(errorText(err));
    }
  };

  const onArchive = async () => {
    if (!snapshot) return;
    if (
      !window.confirm(
        `Отправить доску «${snapshot.board.title}» в архив? Она станет доступна только для просмотра.`,
      )
    ) {
      return;
    }
    try {
      setSnapshot(await boardsApi.archiveBoard(snapshot.board.id));
      toast.success('Доска в архиве');
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const onRestore = async () => {
    if (!snapshot) return;
    try {
      setSnapshot(await boardsApi.restoreBoard(snapshot.board.id));
      toast.success('Доска восстановлена');
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const onDeleteBoard = async () => {
    if (!snapshot) return;
    if (!window.confirm(`Удалить доску «${snapshot.board.title}»? Это действие необратимо.`)) return;
    try {
      await boardsApi.deleteBoard(snapshot.board.id);
      toast.success('Доска удалена');
      navigate('/boards');
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const onSaveBoardAsTemplate = async () => {
    if (!snapshot) return;
    const title = window.prompt('Название шаблона доски', snapshot.board.title);
    if (title === null) return;
    try {
      const res = await templatesApi.saveBoardTemplate(snapshot.board.id, title.trim() || snapshot.board.title);
      toast.success(`Шаблон доски «${res.template.title}» сохранён`);
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const onSaveAsTemplate = async (column: ColumnDto) => {
    const title = window.prompt('Название шаблона', column.title);
    if (title === null) return;
    try {
      const res = await templatesApi.saveColumnTemplate(column.id, title.trim() || column.title);
      setTemplates((prev) => [...prev, res.template]);
      toast.success(`Шаблон «${res.template.title}» сохранён`);
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  // Порядок колонок с учётом превью перетаскивания (без изменения данных до дропа).
  const displayColumns = useMemo(() => {
    if (!columnOrder) return columns;
    const byId = new Map(columns.map((c) => [c.id, c]));
    const ordered = columnOrder.map((cid) => byId.get(cid)).filter((c): c is ColumnDto => Boolean(c));
    return ordered.length === columns.length ? ordered : columns;
  }, [columns, columnOrder]);

  // Карточки по колонкам с превью: «тень» уже стоит на будущем месте.
  const cardsByColumn = useMemo(() => {
    if (!activeDrag || activeDrag.type !== 'card' || !cardPreview) return cardsByColumnBase;
    const next = new Map(cardsByColumnBase);
    const card = activeDrag.card;
    const source = next.get(card.columnId);
    if (source) next.set(card.columnId, source.filter((c) => c.id !== card.id));
    const target = [...(next.get(cardPreview.columnId) ?? [])];
    target.splice(Math.min(cardPreview.index, target.length), 0, card);
    next.set(cardPreview.columnId, target);
    return next;
  }, [cardsByColumnBase, activeDrag, cardPreview]);

  const dragCardId = activeDrag?.type === 'card' ? activeDrag.card.id : null;

  if (error) {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Не удалось открыть доску</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                void reload();
              }}
            >
              Повторить
            </Button>
            <Button variant="outline" onClick={() => navigate('/boards')}>
              К списку досок
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="flex h-full flex-col" aria-busy="true">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-6 w-40" />
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="size-7 rounded-full" />
            <Skeleton className="h-7 w-28" />
          </div>
        </div>
        <div className="flex gap-3 overflow-hidden p-4">
          <Skeleton className="h-80 w-72 shrink-0 rounded-xl" />
          <Skeleton className="h-80 w-72 shrink-0 rounded-xl" />
          <Skeleton className="h-80 w-72 shrink-0 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="z-10 shrink-0 border-b bg-background/85 backdrop-blur">
        <div className="flex h-14 items-center gap-1 px-2 sm:gap-2 sm:px-4">
          <Button variant="ghost" size="sm" className="shrink-0 gap-1.5" onClick={() => navigate('/boards')}>
            <ArrowLeft className="size-4" />
            <span className="hidden sm:inline">Доски</span>
          </Button>
          <span className="hidden text-muted-foreground/40 sm:inline">/</span>

          <BoardTitle
            title={snapshot.board.title}
            canRename={can(snapshot.board.role, 'renameBoard') && !archived}
            onRename={onRenameBoard}
            onError={setError}
          />

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground hover:text-amber-500"
            aria-label={snapshot.board.favorite ? 'Убрать доску из избранного' : 'Добавить доску в избранное'}
            aria-pressed={snapshot.board.favorite}
            onClick={() => void onToggleFavorite()}
          >
            <Star className={snapshot.board.favorite ? 'size-4 fill-amber-400 text-amber-500' : 'size-4'} />
          </Button>

          <Badge variant={snapshot.board.role === 'OWNER' ? 'default' : 'secondary'} className="hidden md:inline-flex">
            {BOARD_ROLE_LABELS[snapshot.board.role]}
          </Badge>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            {isOwner && !archived && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-muted-foreground"
                    aria-label="Действия с доской"
                    title="Действия с доской"
                  >
                    <MoreHorizontal className="size-4" />
                    <span className="hidden lg:inline">Действия</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => void onSaveBoardAsTemplate()}>
                    <Save className="size-4" />
                    Сохранить как шаблон…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void onArchive()}>
                    <Archive className="size-4" />
                    В архив
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <MembersBar online={online} members={snapshot.members} />
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                connected
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : 'border-destructive/40 bg-destructive/10 text-destructive',
              )}
              title={connected ? 'Соединение с сервером активно' : 'Нет связи: изменения не сохраняются'}
            >
              <span className={cn('size-1.5 rounded-full', connected ? 'bg-emerald-500' : 'bg-destructive')} />
              <span className="hidden sm:inline">{connected ? 'онлайн' : 'нет связи'}</span>
            </span>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              aria-label="Участники"
              onClick={() => setShareOpen(true)}
            >
              <Users className="size-4" />
              <span className="hidden sm:inline">Участники</span>
              <span className="text-xs tabular-nums text-muted-foreground">{snapshot.members.length}</span>
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {archived && (
        <div className="border-b border-amber-500/30 bg-amber-500/10">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
            <Archive className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="min-w-0 flex-1">
              Доска в архиве — доступен только просмотр. Восстановите её, чтобы снова вносить изменения.
            </span>
            {isOwner && (
              <>
                <Button size="sm" variant="outline" onClick={() => void onRestore()}>
                  <ArchiveRestore className="size-4" />
                  Восстановить
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => void onDeleteBoard()}
                >
                  <Trash2 className="size-4" />
                  Удалить
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <EmailVerificationBanner />

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={() => {
          onDragEnd();
          clearDrag();
        }}
        onDragCancel={clearDrag}
      >
        <div
          data-columns-row
          role="group"
          aria-label="Колонки доски"
          onKeyDownCapture={onBoardKeyDown}
          className="flex flex-1 items-start gap-3 overflow-x-auto overflow-y-hidden p-3 sm:p-4"
        >
          {displayColumns.length === 0 && (
            <div className="flex w-72 shrink-0 flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              <LayoutGrid className="size-5" />
              Колонок пока нет. Создайте первую справа.
            </div>
          )}

          {displayColumns.map((column) => (
            <ColumnView
              key={column.id}
              column={column}
              cards={cardsByColumn.get(column.id) ?? []}
              activeCardId={dragCardId}
              columns={columns}
              ws={ws}
              onNotice={showNotice}
              editingByCard={editingByCard}
              members={snapshot.members}
              readOnly={!canEdit}
              onSaveAsTemplate={(column) => void onSaveAsTemplate(column)}
            />
          ))}

          {canEdit && (
            <NewColumnForm
              templates={templates}
              onCreate={(title) => {
                ws.createColumn(title);
              }}
              onCreateFromTemplate={(templateId) => ws.createColumnFromTemplate(templateId)}
            />
          )}
        </div>

        <DragOverlay className="pointer-events-none">
          {activeDrag?.type === 'card' && activeDrag.card ? (
            <article className="w-64 rotate-2 rounded-lg border bg-card p-3 text-sm shadow-2xl">
              {activeDrag.card.title}
            </article>
          ) : activeDrag?.type === 'column' && activeDrag.column ? (
            <section className="flex w-72 flex-col gap-2 rounded-xl border bg-muted/90 p-2.5 opacity-95 shadow-2xl">
              <header className="flex items-center gap-2 px-1">
                <GripVertical className="size-4 text-muted-foreground" />
                <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {activeDrag.column.title}
                </h2>
              </header>
              <div className="flex flex-col gap-2">
                {(cardsByColumnBase.get(activeDrag.column.id) ?? []).slice(0, 5).map((card) => (
                  <article key={card.id} className="rounded-lg border bg-card p-3 text-sm shadow-xs">
                    {card.title}
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </DragOverlay>
      </DndContext>

      {shareOpen && (
        <BoardAccessModal
          boardId={snapshot.board.id}
          members={snapshot.members}
          myRole={snapshot.board.role}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}
