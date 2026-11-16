import { LayoutDashboard } from 'lucide-react';
import { Link } from 'react-router-dom';

/** Логотип-ссылка на список досок. */
export function Logo() {
  return (
    <Link to="/boards" className="flex items-center gap-2">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <LayoutDashboard className="size-4" />
      </span>
      <span className="text-sm font-semibold tracking-tight">Task Board</span>
    </Link>
  );
}
