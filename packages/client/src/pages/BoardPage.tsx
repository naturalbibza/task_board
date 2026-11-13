import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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

export function BoardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null);
  const [online, setOnline] = useState<PresenceUser[]>([]);
  const [editingByCard, setEditingByCard] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // DragOverlay: перетаскиваемая карточка следует за курсором везде,
  // на её месте остаётся заглушка; возврат — только при дропе вне колонок.
  const [activeDrag, setActiveDrag] = useState<{
    type: 'card' | 'column';
    card?: CardDto;
    column?: ColumnDto;
    originalCard?: CardDto;
  } | null>(null);
  const lastMoveRef = useRef<{ cardId: string; toColumnId: string; beforeId: string | null; afterId: string | null; position: number } | null>(
    null,
  );

  const onDragStart = (event: DragStartEvent) => {
    lastMoveRef.current = null;
    const type = event.active.data.current?.type as 'card' | 'column' | undefined;
    if (type === 'card') {
      const card = snapshot?.cards.find((c) => c.id === event.active.id);
      setActiveDrag(card ? { type: 'card', card, originalCard: card } : null);
    } else if (type === 'column') {
      const column = snapshot?.columns.find((c) => c.id === event.active.id);
      setActiveDrag(column ? { type: 'column', column } : null);
    }
  };

  const clearDrag = () => {
    setActiveDrag(null);
    lastMoveRef.current = null;
  };

  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || !snapshot) return;
    if (active.data.current?.type !== 'card') return;
    const cardId = String(active.id);
    const card = snapshot.cards.find((c) => c.id === cardId);
    if (!card) return;
    const overType = over.data.current?.type as 'card' | 'column' | undefined;

    let targetColumnId: string | null = null;
    let index: number | null = null;
    if (overType === 'card') {
      const overCard = snapshot.cards.find((c) => c.id === over.id);
      if (!overCard || overCard.id === cardId) return;
      targetColumnId = overCard.columnId;
      const list = snapshot.cards
        .filter((c) => c.columnId === targetColumnId && c.id !== cardId)
        .sort((a, b) => a.position - b.position);
      const i = list.findIndex((c) => c.id === over.id);
      index = i === -1 ? list.length : i;
    } else if (overType === 'column') {
      targetColumnId = String(over.id);
      if (card.columnId !== targetColumnId) index = snapshot.cards.filter((c) => c.columnId === targetColumnId).length;
    }
    if (!targetColumnId || card.columnId === targetColumnId) return;

    const list = snapshot.cards
      .filter((c) => c.columnId === targetColumnId && c.id !== cardId)
      .sort((a, b) => a.position - b.position);
    const ins = insertion(list, index ?? list.length);
    optimisticMoveCard(cardId, targetColumnId, ins.position);
    lastMoveRef.current = { cardId, toColumnId: targetColumnId, beforeId: ins.beforeId, afterId: ins.afterId, position: ins.position };
  };

  /** Расчёт соседей и позиции после вставки в упорядоченный список. */
  const insertion = <T extends { id: string; position: number }>(
    list: T[],
    index: number,
  ): { beforeId: string | null; afterId: string | null; position: number } => {
    const before = list[index - 1]?.position ?? 0;
    const after = list[index]?.position ?? before + STEP;
    return {
      beforeId: list[index - 1]?.id ?? null,
      afterId: list[index]?.id ?? null,
      position: (before + after) / 2,
    };
  };

  const optimisticMoveCard = (cardId: string, toColumnId: string, position: number) => {
    setSnapshot((prev) =>
      prev && {
        ...prev,
        cards: prev.cards.map((c) => (c.id === cardId ? { ...c, columnId: toColumnId, position } : c)),
      },
    );
  };

  // Коллизия: приоритет — droppable под курсором (колонка/карточка), иначе ближайшие углы.
  // closestCorners один промахивался: дроп над пустой колонкой резолвился в карточку соседней.
  const collisionDetection: CollisionDetection = (args) => {
    const pointer = pointerWithin(args);
    return pointer.length > 0 ? pointer : closestCorners(args);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    clearDrag();

    // Дроп вне колонок: вернуть карточку в исходную (FR-7, как в Trello)
    if (!over) {
      const original = activeDrag?.originalCard;
      if (original) {
        setSnapshot((prev) => prev && ({ ...prev, cards: prev.cards.map((c) => (c.id === original.id ? original : c)) }));
      }
      return;
    }
    if (!snapshot || String(active.id) === String(over.id)) return;
    const activeType = active.data.current?.type as 'card' | 'column' | undefined;

    if (activeType === 'card') {
      const card = snapshot.cards.find((c) => c.id === active.id);
      if (!card) return;
      const overType = over.data.current?.type as 'card' | 'column' | undefined;

      let targetColumnId: string;
      let list: CardDto[];
      if (overType === 'card') {
        const overCard = snapshot.cards.find((c) => c.id === over.id);
        if (!overCard) return;
        targetColumnId = overCard.columnId;
        list = snapshot.cards
          .filter((c) => c.columnId === targetColumnId && c.id !== card.id)
          .sort((a, b) => a.position - b.position);
        const overIndex = list.findIndex((c) => c.id === over.id);
        if (overIndex === -1) return;
        // в той же колонке «ниже» over — вставляем после него
        const sameColumn = card.columnId === targetColumnId;
        let insertIndex = overIndex;
        if (sameColumn) {
          const currentList = snapshot.cards
            .filter((c) => c.columnId === targetColumnId)
            .sort((a, b) => a.position - b.position);
          const activeIndex = currentList.findIndex((c) => c.id === card.id);
          if (activeIndex > overIndex) insertIndex = overIndex + 1;
        }
        const ins = insertion(list, insertIndex);
        optimisticMoveCard(card.id, targetColumnId, ins.position);
        getSocket().emit('card:move', {
          id: card.id,
          toColumnId: targetColumnId,
          beforeId: ins.beforeId,
          afterId: ins.afterId,
        });
      } else if (overType === 'column') {
        targetColumnId = String(over.id);
        list = snapshot.cards
          .filter((c) => c.columnId === targetColumnId && c.id !== card.id)
          .sort((a, b) => a.position - b.position);
        const ins = insertion(list, list.length);
        optimisticMoveCard(card.id, targetColumnId, ins.position);
        getSocket().emit('card:move', {
          id: card.id,
          toColumnId: targetColumnId,
          beforeId: ins.beforeId,
          afterId: ins.afterId,
        });
      } else return;
    } else if (activeType === 'column') {
      const columnId = String(active.id);
      // over — другая колонка или карточка внутри неё
      const overColumnId =
        over.data.current?.type === 'card'
          ? (snapshot.cards.find((c) => c.id === over.id)?.columnId ?? '')
          : String(over.id);
      if (!overColumnId || overColumnId === columnId) return;
      const list = columns.filter((c) => c.id !== columnId);
      const overIndex = list.findIndex((c) => c.id === overColumnId);
      if (overIndex === -1) return;
      // в той же линии «правее» over — вставляем после
      const currentList = [...columns];
      const activeIndex = currentList.findIndex((c) => c.id === columnId);
      let insertIndex = overIndex;
      if (activeIndex > overIndex) insertIndex = overIndex + 1;
      const ins = insertion(list, insertIndex);
      setSnapshot((prev) =>
        prev && {
          ...prev,
          columns: prev.columns.map((c) => (c.id === columnId ? { ...c, position: ins.position } : c)),
        },
      );
      getSocket().emit('column:move', {
        id: columnId,
        beforeId: ins.beforeId,
        afterId: ins.afterId,
      });
    }
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
    const onWsError = (e: { code: string; message: string }) => setError(e.message);
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
    socket.emit('board:join', { boardId: id });

    return () => {
      socket.emit('board:leave', { boardId: id });
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
  }, [id]);

  // WS-мутации (FR-8, фаза 8): optimistic не нужен — событие от сервера
  // перезаписывает состояние (reconciliation, конституция №3)
  const ws = useMemo(() => {
    const socket = getSocket();
    const boardId = id;
    return {
      createColumn: (title: string) => {
        if (!boardId) return;
        socket.emit('column:create', { boardId, title });
      },
      renameColumn: (columnId: string, title: string) => socket.emit('column:rename', { id: columnId, title }),
      deleteColumn: (columnId: string) => socket.emit('column:delete', { id: columnId }),
      createCard: (columnId: string, title: string) => socket.emit('card:create', { columnId, title }),
      updateCard: (cardId: string, patch: { title?: string; description?: string | null }) =>
        socket.emit('card:update', { id: cardId, ...patch }),
      deleteCard: (cardId: string) => socket.emit('card:delete', { id: cardId }),
      editingStart: (cardId: string) => socket.emit('card:editing-start', { cardId }),
      editingStop: (cardId: string) => socket.emit('card:editing-stop', { cardId }),
    };
  }, [id]);

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

  const columns = useMemo(
    () => (snapshot ? [...snapshot.columns].sort((a, b) => a.position - b.position) : []),
    [snapshot],
  );

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
  if (!snapshot) return <main className="page">Загрузка…</main>;

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
        onDragOver={onDragOver}
        onDragEnd={(event) => {
          onDragEnd(event);
          clearDrag();
        }}
        onDragCancel={clearDrag}
      >
        <SortableContext items={columns.map((c) => c.id)}>
          <div className="columns">
            {columns.map((column) => (
              <ColumnView
                key={column.id}
                column={column}
                cards={snapshot.cards
                  .filter((c) => c.columnId === column.id)
                  .sort((a, b) => a.position - b.position)}
                ws={ws}
                reload={reload}
                onError={setError}
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
        </SortableContext>

        <DragOverlay>
          {activeDrag?.type === 'card' && activeDrag.card ? (
            <article className="card card-view overlay-card">{activeDrag.card.title}</article>
          ) : activeDrag?.type === 'column' && activeDrag.column ? (
            <section className="column overlay-column">
              <header className="column-header">
                <span className="drag-handle">⠿</span>
                <h2>{activeDrag.column.title}</h2>
              </header>
              <div className="column-cards">
                {snapshot.cards
                  .filter((c) => c.columnId === activeDrag.column!.id)
                  .slice(0, 5)
                  .map((c) => (
                    <article key={c.id} className="card card-view">
                      {c.title}
                    </article>
                  ))}
              </div>
            </section>
          ) : null}
        </DragOverlay>
      </DndContext>

      {error && <p className="error">{error}</p>}
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
  deleteCard: (cardId: string) => void;
  editingStart: (cardId: string) => void;
  editingStop: (cardId: string) => void;
}

interface ColumnViewProps {
  column: ColumnDto;
  cards: CardDto[];
  ws: WsApi;
  reload: () => Promise<void>;
  onError: (message: string) => void;
  editingByCard: Record<string, string>;
  members: UserDto[];
}

function ColumnView(props: ColumnViewProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.column.id,
    data: { type: 'column' },
  });

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
      className="column"
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
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

      <SortableContext items={props.cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div className="column-cards">
          {props.cards.map((card) => (
            <CardView
              key={card.id}
              card={card}
              ws={props.ws}
              reload={props.reload}
              onError={props.onError}
              editingBy={props.editingByCard[card.id] ?? null}
              members={props.members}
            />
          ))}
        </div>
      </SortableContext>

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
  reload: () => Promise<void>;
  onError: (message: string) => void;
  editingBy: string | null; // userId другого редактирующего
  members: UserDto[];
}

function CardView(props: CardViewProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.card.id,
    data: { type: 'card', columnId: props.card.columnId },
  });

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(props.card.title);
  const [description, setDescription] = useState(props.card.description ?? '');

  const editorName = props.editingBy
    ? (props.members.find((m) => m.id === props.editingBy)?.name ?? 'участник')
    : null;

  const openModal = () => {
    setOpen(true);
    props.ws.editingStart(props.card.id);
  };

  const closeModal = () => {
    setOpen(false);
    props.ws.editingStop(props.card.id);
  };

  const save = async () => {
    try {
      props.ws.updateCard(props.card.id, { title: title.trim(), description: description || null });
      closeModal();
      await props.reload();
    } catch (err) {
      props.onError(errorText(err));
    }
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
        className={`card card-view${isDragging ? ' dragging-ghost' : ''}`}
        style={{
          transform: CSS.Transform.toString(transform),
          transition,
        }}
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
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => {
                  void save();
                }}
              >
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
