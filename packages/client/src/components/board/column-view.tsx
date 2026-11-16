import { useCallback, useState, type FormEvent } from 'react';
import { GripVertical, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { CardDto, ColumnDto, UserDto } from '@task-board/shared';
import { cn } from '@/lib/utils';
import type { WsApi } from './types';
import { CardView } from './card-view';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ColumnViewProps {
  column: ColumnDto;
  cards: CardDto[];
  activeCardId: string | null;
  columns: ColumnDto[];
  ws: WsApi;
  onNotice: (message: string) => void;
  editingByCard: Record<string, string>;
  members: UserDto[];
  readOnly?: boolean;
}

/** Колонка: перетаскивание за ручку, переименование, удаление, карточки. */
export function ColumnView(props: ColumnViewProps) {
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

  const onRename = (e: FormEvent) => {
    e.preventDefault();
    const title = titleValue.trim();
    if (!title) {
      setTitleValue(props.column.title);
      setEditingTitle(false);
      return;
    }
    if (title !== props.column.title) props.ws.renameColumn(props.column.id, title);
    setEditingTitle(false);
  };

  const onDeleteColumn = () => {
    if (!window.confirm(`Удалить колонку «${props.column.title}» вместе с карточками?`)) return;
    props.ws.deleteColumn(props.column.id);
  };

  return (
    <section
      ref={setNodeRef}
      data-column-id={props.column.id}
      className={cn(
        'flex max-h-[calc(100svh-7rem)] w-72 shrink-0 flex-col gap-2 rounded-xl border bg-muted/50 p-2.5',
        isDragging && 'opacity-50 ring-2 ring-primary/40',
      )}
    >
      <header className="flex items-center gap-1 px-0.5">
        <span
          className={
            props.readOnly
              ? 'rounded p-1 text-muted-foreground/50'
              : 'cursor-grab touch-none rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing'
          }
          aria-label={`Перетащить колонку «${props.column.title}»`}
          {...attributes}
          {...(props.readOnly ? {} : listeners)}
        >
          <GripVertical className="size-4" />
        </span>

        {editingTitle ? (
          <form
            className="flex-1"
            onSubmit={(e) => {
              onRename(e);
            }}
          >
            <Input
              autoFocus
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={() => setEditingTitle(false)}
              maxLength={100}
              className="h-7 px-1.5 text-sm"
            />
          </form>
        ) : (
          <h2
            className="flex-1 cursor-text truncate px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            title="Переименовать колонку"
            onClick={() => {
              setTitleValue(props.column.title);
              setEditingTitle(true);
            }}
          >
            {props.column.title}
          </h2>
        )}

        <span className="text-xs tabular-nums text-muted-foreground">{props.cards.length}</span>

        {!props.readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground"
                aria-label="Действия с колонкой"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDeleteColumn}>
                <Trash2 className="size-4" />
                Удалить колонку
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <div className="flex min-h-2 flex-1 flex-col gap-2 overflow-y-auto px-0.5">
        {props.cards.length === 0 && (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            Пусто — перетащите карточку сюда
          </p>
        )}

        {props.cards.map((card) =>
          card.id === props.activeCardId ? (
            // «Тень»: место, куда карточка встанет после дропа
            <article
              key={card.id}
              data-card-id={card.id}
              className="rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 p-3 text-sm text-muted-foreground"
            >
              {card.title}
            </article>
          ) : (
            <CardView
              key={card.id}
              card={card}
              ws={props.ws}
              columns={props.columns}
              onNotice={props.onNotice}
              editingBy={props.editingByCard[card.id] ?? null}
              members={props.members}
              readOnly={props.readOnly}
            />
          ),
        )}
      </div>

      {!props.readOnly && (
        <form onSubmit={onCreateCard} className="flex items-center gap-1 px-0.5">
          <Input
            value={newCardTitle}
            onChange={(e) => setNewCardTitle(e.target.value)}
            placeholder="+ карточка"
            maxLength={200}
            className="h-8 border-transparent bg-transparent shadow-none hover:border-input focus-visible:bg-background dark:bg-transparent dark:focus-visible:bg-background/60"
          />
          <Button
            type="submit"
            size="icon"
            variant="ghost"
            className="size-8 shrink-0"
            aria-label="Добавить карточку"
            disabled={!newCardTitle.trim()}
          >
            <Plus className="size-4" />
          </Button>
        </form>
      )}
    </section>
  );
}
