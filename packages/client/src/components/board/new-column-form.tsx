import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Добавление колонки: компактная форма в конце списка колонок. */
export function NewColumnForm({ onCreate }: { onCreate: (title: string) => void }) {
  const [title, setTitle] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = title.trim();
    if (!value) return;
    onCreate(value);
    setTitle('');
  };

  return (
    <form
      onSubmit={submit}
      className="flex w-72 shrink-0 flex-col gap-2 rounded-xl border border-dashed bg-muted/30 p-2.5"
    >
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
  );
}
