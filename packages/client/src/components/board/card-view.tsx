import { useState, type FormEvent } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import type { CardDto, ColumnDto, MemberDto } from '@task-board/shared';
import type { WsApi } from './types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface CardViewProps {
  card: CardDto;
  ws: WsApi;
  columns: ColumnDto[];
  onNotice: (message: string) => void;
  editingBy: string | null; // userId другого редактирующего
  members: MemberDto[];
  readOnly?: boolean;
}

/** Карточка: перетаскивание + модалка редактирования (включая перенос в колонку). */
export function CardView(props: CardViewProps) {
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
    setTitle(props.card.title);
    setDescription(props.card.description ?? '');
    setTargetColumnId(props.card.columnId);
    setOpen(true);
    if (!props.readOnly) props.ws.editingStart(props.card.id);
  };

  const closeModal = () => {
    setOpen(false);
    if (!props.readOnly) props.ws.editingStop(props.card.id);
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    props.ws.updateCard(props.card.id, { title: title.trim(), description: description || null });
    if (targetColumnId !== props.card.columnId) {
      props.ws.moveCardToEnd(props.card.id, targetColumnId);
      const columnTitle = props.columns.find((c) => c.id === targetColumnId)?.title;
      props.onNotice(columnTitle ? `Карточка перемещена в «${columnTitle}»` : 'Карточка перемещена');
    }
    closeModal();
  };

  const remove = () => {
    if (!window.confirm('Удалить карточку?')) return;
    props.ws.deleteCard(props.card.id);
    closeModal();
  };

  return (
    <>
      <article
        ref={setNodeRef}
        data-card-id={props.card.id}
        className={
          props.readOnly
            ? 'rounded-lg border bg-card p-3 text-sm shadow-xs'
            : 'group cursor-grab touch-manipulation rounded-lg border bg-card p-3 text-sm shadow-xs transition hover:border-primary/40 hover:shadow-sm active:cursor-grabbing'
        }
        {...attributes}
        {...(props.readOnly ? {} : listeners)}
        onClick={openModal}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 whitespace-pre-wrap break-words leading-snug">{props.card.title}</span>
          {editorName && (
            <Badge variant="secondary" className="shrink-0 gap-1 text-[10px] font-normal">
              <Pencil className="size-3" />
              {editorName}
            </Badge>
          )}
        </div>
      </article>

      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (value) openModal();
          else closeModal();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Карточка</DialogTitle>
            <DialogDescription>
              {props.readOnly
                ? 'Просмотр карточки — ваша роль не позволяет изменять содержимое доски.'
                : 'Измените заголовок и описание или перенесите карточку в другую колонку.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={save} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor={`card-title-${props.card.id}`}>Заголовок</Label>
              <Input
                id={`card-title-${props.card.id}`}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                required
                disabled={props.readOnly}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`card-desc-${props.card.id}`}>Описание</Label>
              <Textarea
                id={`card-desc-${props.card.id}`}
                rows={5}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={5000}
                placeholder="Детали задачи…"
                disabled={props.readOnly}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`card-col-${props.card.id}`}>Колонка</Label>
              <Select value={targetColumnId} onValueChange={setTargetColumnId} disabled={props.readOnly}>
                <SelectTrigger id={`card-col-${props.card.id}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {props.columns.map((column) => (
                    <SelectItem key={column.id} value={column.id}>
                      {column.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="gap-2 sm:justify-between">
              {props.readOnly ? (
                <Button type="button" variant="outline" onClick={closeModal} className="ml-auto">
                  Закрыть
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={remove}
                  >
                    <Trash2 className="size-4" />
                    Удалить
                  </Button>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={closeModal}>
                      Отмена
                    </Button>
                    <Button type="submit" disabled={!title.trim()}>
                      Сохранить
                    </Button>
                  </div>
                </>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
