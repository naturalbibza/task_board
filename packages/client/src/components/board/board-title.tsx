import { useState, type FormEvent } from 'react';
import { errorText } from '../../state/auth-context';
import { Input } from '@/components/ui/input';

interface BoardTitleProps {
  title: string;
  canRename: boolean;
  onRename: (title: string) => Promise<unknown>;
  onError: (message: string) => void;
}

/** Название доски: клик — переименование (только владелец). */
export function BoardTitle(props: BoardTitleProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(props.title);

  if (!editing) {
    return (
      <h1
        tabIndex={props.canRename ? 0 : undefined}
        className={
          props.canRename
            ? 'max-w-[42vw] cursor-text truncate rounded px-1.5 py-0.5 text-lg font-semibold tracking-tight hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-none'
            : 'max-w-[42vw] truncate px-1.5 py-0.5 text-lg font-semibold tracking-tight sm:max-w-none'
        }
        title={props.canRename ? 'Переименовать доску' : undefined}
        onClick={() => {
          if (!props.canRename) return;
          setValue(props.title);
          setEditing(true);
        }}
        onKeyDown={(e) => {
          if (!props.canRename) return;
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          setValue(props.title);
          setEditing(true);
        }}
      >
        {props.title}
      </h1>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const title = value.trim();
    if (!title) {
      setEditing(false);
      return;
    }
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
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => setEditing(false)}
        maxLength={100}
        className="h-8 w-48 text-base font-semibold sm:w-64"
      />
    </form>
  );
}
