import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { BoardSnapshot, CardDto, ColumnDto, PresenceUser } from '@task-board/shared';
import * as boardsApi from '../api/boards';
import { getSocket } from '../api/socket';
import { errorText } from '../state/auth-context';
import { MembersBar } from '../components/MembersBar';

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
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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

  // WS: снапшот и presence приходят с сервера (FR-9, FR-13, FR-14)
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

    socket.on('board:state', onState);
    socket.on('presence:update', onPresence);
    socket.on('ws:error', onWsError);
    socket.on('card:moved', onCardMoved);
    socket.on('column:moved', onColumnMoved);
    socket.emit('board:join', { boardId: id });

    return () => {
      socket.emit('board:leave', { boardId: id });
      socket.off('board:state', onState);
      socket.off('presence:update', onPresence);
      socket.off('ws:error', onWsError);
      socket.off('card:moved', onCardMoved);
      socket.off('column:moved', onColumnMoved);
    };
  }, [id]);

  useEffect(() => {
    if (error) void reload();
  }, [error, reload]);

  const columns = useMemo(
    () => (snapshot ? [...snapshot.columns].sort((a, b) => a.position - b.position) : []),
    [snapshot],
  );

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

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || !snapshot || String(active.id) === String(over.id)) return;
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

  const optimisticMoveCard = (cardId: string, toColumnId: string, position: number) => {
    setSnapshot((prev) =>
      prev && {
        ...prev,
        cards: prev.cards.map((c) => (c.id === cardId ? { ...c, columnId: toColumnId, position } : c)),
      },
    );
  };

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
      </header>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        <SortableContext items={columns.map((c) => c.id)}>
          <div className="columns">
            {columns.map((column) => (
              <ColumnView
                key={column.id}
                column={column}
                cards={snapshot.cards
                  .filter((c) => c.columnId === column.id)
                  .sort((a, b) => a.position - b.position)}
                boardId={snapshot.board.id}
                reload={reload}
                onError={setError}
              />
            ))}
            <NewColumnForm
              boardId={snapshot.board.id}
              onCreate={async (title) => {
                const res = await boardsApi.createColumn(snapshot.board.id, title);
                setSnapshot({ ...snapshot, columns: [...snapshot.columns, res.column] });
              }}
            />
          </div>
        </SortableContext>
      </DndContext>

      {error && <p className="error">{error}</p>}
    </main>
  );
}

function BoardTitle(props: {
  title: string;
  canRename: boolean;
  onRename: (title: string) => Promise<unknown>;
  onError: (message: string) => void;
}) {
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

interface ColumnViewProps {
  column: ColumnDto;
  cards: CardDto[];
  boardId: string;
  reload: () => Promise<void>;
  onError: (message: string) => void;
}

function ColumnView(props: ColumnViewProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.column.id,
    data: { type: 'column' },
  });

  const [newCardTitle, setNewCardTitle] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(props.column.title);

  const onCreateCard = async (e: FormEvent) => {
    e.preventDefault();
    const title = newCardTitle.trim();
    if (!title) return;
    try {
      await boardsApi.createCard(props.column.id, title);
      setNewCardTitle('');
      await props.reload();
    } catch (err) {
      props.onError(errorText(err));
    }
  };

  const onRename = async (e: FormEvent) => {
    e.preventDefault();
    const title = titleValue.trim();
    if (!title) return;
    try {
      await boardsApi.renameColumn(props.column.id, title);
      setEditingTitle(false);
      await props.reload();
    } catch (err) {
      props.onError(errorText(err));
    }
  };

  const onDeleteColumn = async () => {
    if (!window.confirm(`Удалить колонку «${props.column.title}» вместе с карточками?`)) return;
    try {
      await boardsApi.deleteColumn(props.column.id);
      await props.reload();
    } catch (err) {
      props.onError(errorText(err));
    }
  };

  return (
    <section
      ref={setNodeRef}
      className="column"
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
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
            <CardView key={card.id} card={card} reload={props.reload} onError={props.onError} />
          ))}
        </div>
      </SortableContext>

      <form
        className="card-create"
        onSubmit={(e) => {
          void onCreateCard(e);
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
  reload: () => Promise<void>;
  onError: (message: string) => void;
}

function CardView(props: CardViewProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.card.id,
    data: { type: 'card', columnId: props.card.columnId },
  });

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(props.card.title);
  const [description, setDescription] = useState(props.card.description ?? '');

  const save = async () => {
    try {
      await boardsApi.updateCard(props.card.id, { title: title.trim(), description: description || null });
      setOpen(false);
      await props.reload();
    } catch (err) {
      props.onError(errorText(err));
    }
  };

  const remove = async () => {
    if (!window.confirm('Удалить карточку?')) return;
    try {
      await boardsApi.deleteCard(props.card.id);
      setOpen(false);
      await props.reload();
    } catch (err) {
      props.onError(errorText(err));
    }
  };

  return (
    <>
      <article
        ref={setNodeRef}
        className="card card-view"
        style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
        {...attributes}
        {...listeners}
        onClick={() => setOpen(true)}
      >
        {props.card.title}
      </article>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
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
              <button type="button" onClick={() => void save()}>
                Сохранить
              </button>
              <button type="button" className="danger" onClick={() => void remove()}>
                Удалить
              </button>
              <button type="button" className="link" onClick={() => setOpen(false)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function NewColumnForm(props: { boardId: string; onCreate: (title: string) => Promise<void> }) {
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
