import { useState, type FormEvent } from 'react';
import { LayoutTemplate, Plus } from 'lucide-react';
import type { ColumnTemplateDto } from '@task-board/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface NewColumnFormProps {
  onCreate: (title: string) => void;
  /** Шаблоны колонок (FR-43): системные и личные пользователя. */
  templates?: ColumnTemplateDto[];
  onCreateFromTemplate?: (templateId: string) => void;
}

/** Добавление колонки: компактная форма в конце списка колонок + вставка из шаблона. */
export function NewColumnForm({ onCreate, templates = [], onCreateFromTemplate }: NewColumnFormProps) {
  const [title, setTitle] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = title.trim();
    if (!value) return;
    onCreate(value);
    setTitle('');
  };

  const system = templates.filter((t) => t.system);
  const personal = templates.filter((t) => !t.system);

  const insert = (templateId: string) => {
    onCreateFromTemplate?.(templateId);
  };

  return (
    <div className="flex w-72 shrink-0 flex-col gap-2 rounded-xl border border-dashed bg-muted/30 p-2.5">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Новая колонка"
          maxLength={100}
          aria-label="Название новой колонки"
          className="h-8 border-transparent bg-transparent shadow-none hover:border-input focus-visible:bg-background dark:bg-transparent dark:focus-visible:bg-background/60"
        />
        <Button type="submit" variant="secondary" size="sm" disabled={!title.trim()}>
          <Plus className="size-4" />
          Добавить колонку
        </Button>
      </form>

      {onCreateFromTemplate && templates.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="justify-start gap-1.5 text-muted-foreground">
              <LayoutTemplate className="size-4" />
              Из шаблона…
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            {system.length > 0 && (
              <>
                <DropdownMenuLabel>Системные</DropdownMenuLabel>
                {system.map((template) => (
                  <DropdownMenuItem key={template.id} onClick={() => insert(template.id)}>
                    <span className="flex-1 truncate">{template.title}</span>
                    <span className="text-xs text-muted-foreground">{template.cards.length}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
            {personal.length > 0 && (
              <>
                {system.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel>Мои шаблоны</DropdownMenuLabel>
                {personal.map((template) => (
                  <DropdownMenuItem key={template.id} onClick={() => insert(template.id)}>
                    <span className="flex-1 truncate">{template.title}</span>
                    <span className="text-xs text-muted-foreground">{template.cards.length}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
