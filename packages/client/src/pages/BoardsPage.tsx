import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { LayoutGrid, LogOut, Plus, Trash2 } from 'lucide-react';
import type { BoardDto } from '@task-board/shared';
import { BOARD_ROLE_LABELS } from '@task-board/shared';
import { toast } from 'sonner';
import * as boardsApi from '../api/boards';
import { errorText, useAuth } from '../state/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';

export function BoardsPage() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [boards, setBoards] = useState<BoardDto[] | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(() => {
    boardsApi
      .listBoards()
      .then((res) => setBoards(res.boards))
      .catch((err) => {
        setError(errorText(err));
        setBoards([]);
      });
  }, []);

  useEffect(() => {
    if (user) reload();
  }, [user, reload]);

  if (loading) {
    return (
      <div className="min-h-full bg-background">
        <div className="mx-auto max-w-5xl space-y-4 px-4 py-10">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-full" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  const onCreate = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setError(null);
    setCreating(true);
    try {
      const res = await boardsApi.createBoard(title);
      setNewTitle('');
      navigate(`/boards/${res.board.id}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setCreating(false);
    }
  };

  const onDelete = async (board: BoardDto) => {
    if (!window.confirm(`Удалить доску «${board.title}»? Это действие необратимо.`)) return;
    try {
      await boardsApi.deleteBoard(board.id);
      setBoards((prev) => (prev ?? []).filter((b) => b.id !== board.id));
      toast.success('Доска удалена');
    } catch (err) {
      setError(errorText(err));
    }
  };

  const initials = user.name.slice(0, 1).toUpperCase();

  return (
    <div className="min-h-full bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
          <Logo />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-9 gap-2 px-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                    {initials}
                  </span>
                  <span className="hidden max-w-40 truncate text-sm sm:inline">{user.name}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="text-sm font-medium">{user.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void logout()}>
                  <LogOut className="size-4" />
                  Выйти
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Мои доски</h1>
          <p className="text-sm text-muted-foreground">Создавайте доски, приглашайте участников и работайте вместе.</p>
        </div>

        <form
          className="mb-6 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void onCreate();
          }}
        >
          <Input
            placeholder="Название новой доски"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            maxLength={100}
            aria-label="Название новой доски"
          />
          <Button type="submit" disabled={creating || !newTitle.trim()}>
            <Plus className="size-4" />
            Создать доску
          </Button>
        </form>

        {error && (
          <p role="alert" className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {boards === null ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </div>
        ) : boards.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-muted">
              <LayoutGrid className="size-5 text-muted-foreground" />
            </span>
            <div className="space-y-1">
              <p className="font-medium">Досок пока нет</p>
              <p className="text-sm text-muted-foreground">Создайте первую доску — название введите выше.</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {boards.map((board) => (
              <Card
                key={board.id}
                className="group relative cursor-pointer py-0 transition-shadow hover:shadow-md"
                onClick={() => navigate(`/boards/${board.id}`)}
              >
                <CardContent className="flex min-h-24 flex-col justify-between gap-3 p-5">
                  <h2 className="line-clamp-2 pr-6 font-medium leading-snug">{board.title}</h2>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{BOARD_ROLE_LABELS[board.role]}</span>
                    {board.role === 'OWNER' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label={`Удалить доску «${board.title}»`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void onDelete(board);
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
