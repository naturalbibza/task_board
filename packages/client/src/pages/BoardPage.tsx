import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { BoardSnapshot, CardDto, ColumnDto, PresenceUser, UserDto } from '@task-board/shared';
import * as boardsApi from '../api/boards';
import { getSocket } from '../api/socket';
import { errorText } from '../state/auth-context';
import { MembersBar } from '../components/MembersBar';
import { ShareModal } from '../components/ShareModal';

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
  if (!el?.closest('.columns')) return null;

  const columns = [...document.querySelectorAll<HTMLElement>('.columns > [data-column-id]')].filter(
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
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null);
  const [online, setOnline] = useState<PresenceUser[]>([]);
  const [editingByCard, setEditingByCard] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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

  const noticeTimer = useRef<number | null>(null);
  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3000);
  }, []);
  useEffect(
    () => () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    },
    [],
  );

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
        if (payload.userId) next[payload.cardId] = payload.userId;
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
  }, [id, showNotice]);

  // WS-мутации (FR-8, фаза 8): optimistic не нужен — событие от сервера
  // перезаписывает состояние (reconciliation, конституция №3)
  const ws = useMemo(() => {
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
      // Перемещение из модалки карточки (мобильный сценарий): в конец целевой колонки
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

  useEffect(() => {
    if (error) void reload();
  }, [error, reload]);

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
      <main className="page">
        <p className="error">{error}</p>
        <button type="button" onClick={() => navigate('/boards')}>
          К списку досок
        </button>
      </main>
    );
  }
  if (!snapshot) {
    return (
      <main className="board-page" aria-busy="true">
        <div className="board-skeleton">
          <div className="skeleton skeleton-bar" />
          <div className="skeleton-row">
            <div className="skeleton skeleton-column" />
            <div className="skeleton skeleton-column" />
            <div className="skeleton skeleton-column" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="board-page">
      <header className="board-header">
        <button type="button" className="link" onClick={() => navigate('/boards')}>
          ← Доски
        </button>
        <BoardTitle
          title={snapshot.board.title}
          canRename={snapshot.board.role === 'OWNER'}
          onRename={async (title) => setSnapshot(await boardsApi.renameBoard(snapshot.board.id, title))}
          onError={setError}
        />
        <MembersBar online={online} members={snapshot.members} />
        <span
          className={`conn ${connected ? 'conn-ok' : 'conn-down'}`}
          title={connected ? 'Соединение с сервером активно' : 'Нет связи: изменения не сохраняются'}
        >
          {connected ? 'онлайн' : 'нет связи'}
        </span>
        {snapshot.board.role === 'OWNER' && (
          <button type="button" onClick={() => setShareOpen(true)}>
            Поделиться
          </button>
        )}
        {shareOpen && (
          <ShareModal boardId={snapshot.board.id} members={snapshot.members} onClose={() => setShareOpen(false)} />
        )}
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
        <div className="columns">
          {displayColumns.length === 0 && (
            <p className="board-empty">Колонок пока нет. Создайте первую — справа.</p>
          )}
          {displayColumns.map((column) => (
            <ColumnView
              key={column.id}
              column={column}
              cards={cardsByColumn.get(column.id) ?? []}
              activeCardId={dragCardId}
              columns={columns}
              ws={ws}
              onError={setError}
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

        <DragOverlay className="drag-overlay">
          {activeDrag?.type === 'card' && activeDrag.card ? (
            <article className="card card-view overlay-card">{activeDrag.card.title}</article>
          ) : activeDrag?.type === 'column' && activeDrag.column ? (
            <section className="column overlay-column">
              <header className="column-header">
                <span className="drag-handle">⠿</span>
                <h2>{activeDrag.column.title}</h2>
              </header>
              <div className="column-cards">
                {(cardsByColumnBase.get(activeDrag.column.id) ?? []).slice(0, 5).map((c) => (
                  <article key={c.id} className="card card-view">
                    {c.title}
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </DragOverlay>
      </DndContext>

      {notice && <div className="toast">{notice}</div>}
    </main>
  );
}

interface BoardTitleProps {
  title: string;
  canRename: boolean;
  onRename: (title: string) => Promise<unknown>;
  onError: (message: string) => void;
}

function BoardTitle(props: BoardTitleProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(props.title);

  if (!editing) {
    return (
      <h1
        className={props.canRename ? 'editable' : undefined}
        title={props.canRename ? 'Переименовать' : undefined}
        onClick={() => {
          if (props.canRename) {
            setValue(props.title);
            setEditing(true);
          }
        }}
      >
        {props.title}
      </h1>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const title = value.trim();
    if (!title) return;
    try {
      await props.onRename(title);
      setEditing(false);
    } catch (err) {
      props.onError(errorText(err));
    }
  };

  return (
    <form
      onSubmit={(e) => {
        void submit(e);
      }}
    >
      <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => setEditing(false)} />
    </form>
  );
}

interface WsApi {
  createColumn: (title: string) => void;
  renameColumn: (columnId: string, title: string) => void;
  deleteColumn: (columnId: string) => void;
  createCard: (columnId: string, title: string) => void;
  updateCard: (cardId: string, patch: { title?: string; description?: string | null }) => void;
  moveCardToEnd: (cardId: string, toColumnId: string) => void;
  deleteCard: (cardId: string) => void;
  editingStart: (cardId: string) => void;
  editingStop: (cardId: string) => void;
}

interface ColumnViewProps {
  column: ColumnDto;
  cards: CardDto[];
  activeCardId: string | null;
  columns: ColumnDto[];
  ws: WsApi;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  editingByCard: Record<string, string>;
  members: UserDto[];
}

function ColumnView(props: ColumnViewProps) {
  const { setNodeRef: setDragRef, listeners, attributes, isDragging } = useDraggable({
    id: props.column.id,
    data: { type: 'column' },
  });
  const { setNodeRef: setDropRef } = useDroppable({ id: props.column.id, data: { type: 'column' } });
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );

  const [newCardTitle, setNewCardTitle] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(props.column.title);

  const onCreateCard = (e: FormEvent) => {
    e.preventDefault();
    const title = newCardTitle.trim();
    if (!title) return;
    props.ws.createCard(props.column.id, title);
    setNewCardTitle('');
  };

  const onRename = async (e: FormEvent) => {
    e.preventDefault();
    const title = titleValue.trim();
    if (!title) return;
    props.ws.renameColumn(props.column.id, title);
    setEditingTitle(false);
  };

  const onDeleteColumn = async () => {
    if (!window.confirm(`Удалить колонку «${props.column.title}» вместе с карточками?`)) return;
    props.ws.deleteColumn(props.column.id);
  };

  return (
    <section
      ref={setNodeRef}
      className={`column${isDragging ? ' dragging-column' : ''}`}
      data-column-id={props.column.id}
    >
      <header className="column-header">
        <span className="drag-handle" {...attributes} {...listeners}>
          ⠿
        </span>
        {editingTitle ? (
          <form
            onSubmit={(e) => {
              void onRename(e);
            }}
          >
            <input
              autoFocus
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={() => setEditingTitle(false)}
            />
          </form>
        ) : (
          <h2
            className="editable"
            onClick={() => {
              setTitleValue(props.column.title);
              setEditingTitle(true);
            }}
          >
            {props.column.title}
          </h2>
        )}
        <button type="button" className="link danger" onClick={() => void onDeleteColumn()}>
          ✕
        </button>
      </header>

      <div className="column-cards">
        {props.cards.length === 0 && <p className="column-empty">Пусто. Перетащите карточку сюда.</p>}
        {props.cards.map((card) =>
          card.id === props.activeCardId ? (
            // «Тень»: место, куда карточка встанет после дропа
            <article key={card.id} className="card card-view dragging-ghost" data-card-id={card.id}>
              {card.title}
            </article>
          ) : (
            <CardView
              key={card.id}
              card={card}
              ws={props.ws}
              columns={props.columns}
              onError={props.onError}
              onNotice={props.onNotice}
              editingBy={props.editingByCard[card.id] ?? null}
              members={props.members}
            />
          ),
        )}
      </div>

      <form
        className="card-create"
        onSubmit={(e) => {
          onCreateCard(e);
        }}
      >
        <input
          type="text"
          placeholder="+ карточка"
          value={newCardTitle}
          onChange={(e) => setNewCardTitle(e.target.value)}
          maxLength={200}
        />
      </form>
    </section>
  );
}

interface CardViewProps {
  card: CardDto;
  ws: WsApi;
  columns: ColumnDto[];
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  editingBy: string | null; // userId другого редактирующего
  members: UserDto[];
}

function CardView(props: CardViewProps) {
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: props.card.id,
    data: { type: 'card' },
  });

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(props.card.title);
  const [description, setDescription] = useState(props.card.description ?? '');
  const [targetColumnId, setTargetColumnId] = useState(props.card.columnId);

  const editorName = props.editingBy
    ? (props.members.find((m) => m.id === props.editingBy)?.name ?? 'участник')
    : null;

  const openModal = () => {
    setOpen(true);
    setTitle(props.card.title);
    setDescription(props.card.description ?? '');
    setTargetColumnId(props.card.columnId);
    props.ws.editingStart(props.card.id);
  };

  const closeModal = () => {
    setOpen(false);
    props.ws.editingStop(props.card.id);
  };

  const save = () => {
    props.ws.updateCard(props.card.id, { title: title.trim(), description: description || null });
    if (targetColumnId !== props.card.columnId) {
      props.ws.moveCardToEnd(props.card.id, targetColumnId);
      const columnTitle = props.columns.find((c) => c.id === targetColumnId)?.title;
      props.onNotice(columnTitle ? `Карточка перемещена в «${columnTitle}»` : 'Карточка перемещена');
    }
    closeModal();
  };

  const remove = async () => {
    if (!window.confirm('Удалить карточку?')) return;
    props.ws.deleteCard(props.card.id);
    closeModal();
  };

  return (
    <>
      <article
        ref={setNodeRef}
        className="card card-view"
        data-card-id={props.card.id}
        {...attributes}
        {...listeners}
        onClick={openModal}
      >
        {props.card.title}
        {editorName && <span className="editing-badge">✏️ {editorName}</span>}
      </article>

      {open && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <label>
              Заголовок
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            </label>
            <label>
              Описание
              <textarea
                rows={5}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={5000}
              />
            </label>
            <label>
              Колонка
              <select value={targetColumnId} onChange={(e) => setTargetColumnId(e.target.value)}>
                {props.columns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="modal-actions">
              <button type="button" onClick={save}>
                Сохранить
              </button>
              <button type="button" className="danger" onClick={remove}>
                Удалить
              </button>
              <button type="button" className="link" onClick={closeModal}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

interface NewColumnFormProps {
  onCreate: (title: string) => void;
}

function NewColumnForm(props: NewColumnFormProps) {
  const [title, setTitle] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    try {
      await props.onCreate(t);
      setTitle('');
    } catch {
      setTitle('');
    }
  };

  return (
    <form
      className="column new-column"
      onSubmit={(e) => {
        void submit(e);
      }}
    >
      <input
        type="text"
        placeholder="+ колонка"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={100}
      />
    </form>
  );
}
