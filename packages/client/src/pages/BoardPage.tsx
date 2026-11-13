import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { BoardSnapshot, CardDto } from '@task-board/shared';
import * as boardsApi from '../api/boards';
import { errorText } from '../state/auth-context';

export function BoardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    void reload();
  }, [reload]);

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
      </header>

      <div className="columns">
        {snapshot.columns.map((column) => (
          <ColumnView
            key={column.id}
            snapshot={snapshot}
            columnId={column.id}
            title={column.title}
            cards={snapshot.cards.filter((c) => c.columnId === column.id)}
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

function ColumnView(props: {
  snapshot: BoardSnapshot;
  columnId: string;
  title: string;
  cards: CardDto[];
  reload: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [newCardTitle, setNewCardTitle] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(props.title);

  const onCreateCard = async (e: FormEvent) => {
    e.preventDefault();
    const title = newCardTitle.trim();
    if (!title) return;
    try {
      await boardsApi.createCard(props.columnId, title);
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
      await boardsApi.renameColumn(props.columnId, title);
      setEditingTitle(false);
      await props.reload();
    } catch (err) {
      props.onError(errorText(err));
    }
  };

  const onDeleteColumn = async () => {
    if (!window.confirm(`Удалить колонку «${props.title}» вместе с карточками?`)) return;
    try {
      await boardsApi.deleteColumn(props.columnId);
      await props.reload();
    } catch (err) {
      props.onError(errorText(err));
    }
  };

  return (
    <section className="column">
      <header className="column-header">
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
          <h2 className="editable" onClick={() => setEditingTitle(true)}>
            {props.title}
          </h2>
        )}
        <button type="button" className="link danger" onClick={() => void onDeleteColumn()}>
          ✕
        </button>
      </header>

      <div className="column-cards">
        {props.cards.map((card) => (
          <CardView key={card.id} card={card} reload={props.reload} onError={props.onError} />
        ))}
      </div>

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

function CardView(props: { card: CardDto; reload: () => Promise<void>; onError: (message: string) => void }) {
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
      <article className="card card-view" onClick={() => setOpen(true)}>
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
      // ошибка уже показана выше через reload/onError родителя — просто сбросим поле
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
