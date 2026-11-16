import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { BoardSnapshot, CardDto, ColumnDto, PresenceUser } from '@task-board/shared';
import { ArrowLeft, GripVertical, LayoutGrid, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import * as boardsApi from '../api/boards';
import { getSocket } from '../api/socket';
import { errorText, useAuth } from '../state/auth-context';
import { cn } from '@/lib/utils';
import { MembersBar } from '@/components/MembersBar';
import { ShareModal } from '@/components/ShareModal';
import { ThemeToggle } from '@/components/theme-toggle';
import { BoardTitle } from '@/components/board/board-title';
import { ColumnView } from '@/components/board/column-view';
import { NewColumnForm } from '@/components/board/new-column-form';
import type { WsApi } from '@/components/board/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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

  // Мышь — с порогом 5 px; тач — «долгое нажатие» (220 мс), чтобы свайп
  // оставался прокруткой доски, а не превращался в случайный перенос.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const columns = useMemo(
    () => (snapshot ? [...snapshot.columns].sort((a, b) => a.position - b.position) : []),
    [snapshot],
  );

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

  const onDragStart = (event: DragStartEvent) => {
    setCardPreviewState(null);
    setColumnOrderState(null);
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
    const onBoardUpdated = (payload: { board: BoardSnapshot['board'] }) =>
      setSnapshot((prev) => prev && { ...prev, board: payload.board });
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
    socket.on('board:updated', onBoardUpdated);
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
      socket.off('board:updated', onBoardUpdated);
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
      },
      renameColumn: (columnId: string, title: string) => {
        if (!guard()) return;
        socket.emit('column:rename', { id: columnId, title });
      },
      deleteColumn: (columnId: string) => {
        if (!guard()) return;
        socket.emit('column:delete', { id: columnId });
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
            canRename={snapshot.board.role === 'OWNER'}
            onRename={async (title) => setSnapshot(await boardsApi.renameBoard(snapshot.board.id, title))}
            onError={setError}
          />

          <Badge variant={snapshot.board.role === 'OWNER' ? 'default' : 'secondary'} className="hidden md:inline-flex">
            {snapshot.board.role === 'OWNER' ? 'владелец' : 'участник'}
          </Badge>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
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
            {snapshot.board.role === 'OWNER' && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShareOpen(true)}>
                <Share2 className="size-4" />
                <span className="hidden sm:inline">Поделиться</span>
              </Button>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

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
        <div data-columns-row className="flex flex-1 items-start gap-3 overflow-x-auto overflow-y-hidden p-3 sm:p-4">
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
            />
          ))}

          <NewColumnForm
            onCreate={(title) => {
              ws.createColumn(title);
            }}
          />
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
        <ShareModal boardId={snapshot.board.id} members={snapshot.members} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}
