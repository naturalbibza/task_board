import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  LayoutGrid,
  LayoutTemplate,
  LogOut,
  MoreHorizontal,
  Plus,
  Search,
  Star,
  Trash2,
  UserRound,
} from 'lucide-react';
import type { BoardDto, BoardTemplateDto } from '@task-board/shared';
import { BOARD_ROLE_LABELS } from '@task-board/shared';
import { toast } from 'sonner';
import * as boardsApi from '../api/boards';
import * as templatesApi from '../api/templates';
import { errorText, useAuth } from '../state/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { EmailVerificationBanner } from '@/components/EmailVerificationBanner';

type BoardTab = 'all' | 'favorites' | 'archive';
type SortBy = 'updated' | 'title';

/** Сортировка FR-42: избранные всегда сверху, дальше — по дате изменения или названию. */
function sortBoards(list: BoardDto[], sort: SortBy): BoardDto[] {
  return [...list].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    if (sort === 'title') return a.title.localeCompare(b.title, 'ru', { sensitivity: 'base' });
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

export function BoardsPage() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<BoardTab>('all');
  // Оба списка держим в памяти: переключение вкладок не перезагружает данные,
  // поэтому нет мерцания скелетонов (активные и архивные доски приходят сразу).
  const [activeBoards, setActiveBoards] = useState<BoardDto[] | null>(null);
  const [archivedBoards, setArchivedBoards] = useState<BoardDto[] | null>(null);
  const [boardTemplates, setBoardTemplates] = useState<BoardTemplateDto[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortBy>('updated');
  const [newTitle, setNewTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingFromTemplate, setCreatingFromTemplate] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [active, archived] = await Promise.all([boardsApi.listBoards(false), boardsApi.listBoards(true)]);
      setActiveBoards(active.boards);
      setArchivedBoards(archived.boards);
      setError(null);
    } catch (err) {
      setError(errorText(err));
      setActiveBoards([]);
      setArchivedBoards([]);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void reload();
    templatesApi
      .listBoardTemplates()
      .then((res) => setBoardTemplates(res.templates))
      .catch(() => undefined);
  }, [user, reload]);

  // Поиск по названию (FR-41) — без задержек, списки уже на клиенте.
  const visible = useMemo(() => {
    const source = tab === 'archive' ? archivedBoards : activeBoards;
    if (!source) return null;
    const needle = query.trim().toLowerCase();
    const filtered = source.filter(
      (b) => (tab !== 'favorites' || b.favorite) && (!needle || b.title.toLowerCase().includes(needle)),
    );
    return sortBoards(filtered, sort);
  }, [activeBoards, archivedBoards, query, sort, tab]);

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

  const onCreateFromTemplate = async (template: BoardTemplateDto) => {
    if (creatingFromTemplate) return;
    setError(null);
    setCreatingFromTemplate(true);
    try {
      const res = await boardsApi.createBoard(template.title, template.id);
      navigate(`/boards/${res.board.id}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setCreatingFromTemplate(false);
    }
  };

  // Доска живёт ровно в одном из списков — обновляем оба, чтобы не было рассинхрона.
  const updateLocal = (id: string, patch: Partial<BoardDto>) => {
    const apply = (prev: BoardDto[] | null) => prev?.map((b) => (b.id === id ? { ...b, ...patch } : b)) ?? null;
    setActiveBoards(apply);
    setArchivedBoards(apply);
  };

  const onToggleFavorite = async (board: BoardDto) => {
    const favorite = !board.favorite;
    updateLocal(board.id, { favorite }); // отметка мгновенная, сервер авторитетен
    try {
      await boardsApi.setBoardFavorite(board.id, favorite);
    } catch (err) {
      updateLocal(board.id, { favorite: board.favorite });
      toast.error(errorText(err));
    }
  };

  const onArchive = async (board: BoardDto) => {
    if (!window.confirm(`Отправить доску «${board.title}» в архив? Она станет доступна только для просмотра.`)) {
      return;
    }
    try {
      const res = await boardsApi.archiveBoard(board.id);
      setActiveBoards((prev) => (prev ?? []).filter((b) => b.id !== board.id));
      setArchivedBoards((prev) => [res.board, ...(prev ?? []).filter((b) => b.id !== board.id)]);
      toast.success('Доска в архиве');
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const onRestore = async (board: BoardDto) => {
    try {
      const res = await boardsApi.restoreBoard(board.id);
      setArchivedBoards((prev) => (prev ?? []).filter((b) => b.id !== board.id));
      setActiveBoards((prev) => [res.board, ...(prev ?? []).filter((b) => b.id !== board.id)]);
      toast.success('Доска восстановлена');
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const onDelete = async (board: BoardDto) => {
    if (!window.confirm(`Удалить доску «${board.title}»? Это действие необратимо.`)) return;
    try {
      await boardsApi.deleteBoard(board.id);
      setActiveBoards((prev) => (prev ?? []).filter((b) => b.id !== board.id));
      setArchivedBoards((prev) => (prev ?? []).filter((b) => b.id !== board.id));
      toast.success('Доска удалена');
    } catch (err) {
      setError(errorText(err));
    }
  };

  const initials = user.name.slice(0, 1).toUpperCase();
  const isArchive = tab === 'archive';
  const systemBoardTemplates = boardTemplates.filter((t) => t.system);
  const personalBoardTemplates = boardTemplates.filter((t) => !t.system);

  const emptyState = (() => {
    if (query.trim()) {
      return {
        title: 'Ничего не найдено',
        hint: `По запросу «${query.trim()}» досок нет. Попробуйте изменить название.`,
      };
    }
    if (tab === 'favorites') {
      return { title: 'В избранном пусто', hint: 'Отметьте доску звёздочкой — она всегда будет сверху.' };
    }
    if (isArchive) {
      return { title: 'Архив пуст', hint: 'Архивировать доску может владелец: меню «⋯» на карточке.' };
    }
    return { title: 'Досок пока нет', hint: 'Создайте первую доску — название введите выше.' };
  })();

  return (
    <div className="min-h-full bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
          <Logo />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-9 gap-2 px-2" aria-label="Меню пользователя">
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
                <DropdownMenuItem onClick={() => navigate('/profile')}>
                  <UserRound className="size-4" />
                  Профиль
                </DropdownMenuItem>
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

      <EmailVerificationBanner />

      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Мои доски</h1>
          <p className="text-sm text-muted-foreground">Создавайте доски, приглашайте участников и работайте вместе.</p>
        </div>

        {!isArchive && user.emailVerified ? (
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={creatingFromTemplate || boardTemplates.length === 0}
                  aria-label="Из шаблона доски"
                >
                  <LayoutTemplate className="size-4" />
                  {creatingFromTemplate ? 'Создаём…' : 'Из шаблона…'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {systemBoardTemplates.length > 0 && (
                  <>
                    <DropdownMenuLabel>Системные</DropdownMenuLabel>
                    {systemBoardTemplates.map((template) => (
                      <DropdownMenuItem key={template.id} onClick={() => void onCreateFromTemplate(template)}>
                        <span className="flex-1 truncate">{template.title}</span>
                        <span className="text-xs text-muted-foreground">{template.columns.length} кол.</span>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                {personalBoardTemplates.length > 0 && (
                  <>
                    {systemBoardTemplates.length > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel>Мои шаблоны</DropdownMenuLabel>
                    {personalBoardTemplates.map((template) => (
                      <DropdownMenuItem key={template.id} onClick={() => void onCreateFromTemplate(template)}>
                        <span className="flex-1 truncate">{template.title}</span>
                        <span className="text-xs text-muted-foreground">{template.columns.length} кол.</span>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </form>
        ) : !user.emailVerified ? (
          <p className="mb-6 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
            Чтобы создавать доски, подтвердите email — письмо отправлено при регистрации.
          </p>
        ) : null}

        {error && (
          <p role="alert" className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs value={tab} onValueChange={(value) => setTab(value as BoardTab)}>
            <TabsList>
              <TabsTrigger value="all">Все</TabsTrigger>
              <TabsTrigger value="favorites">
                <Star className="size-3.5" />
                Избранное
              </TabsTrigger>
              <TabsTrigger value="archive">
                <Archive className="size-3.5" />
                Архив
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск по названию"
                aria-label="Поиск по названию доски"
                className="h-9 pl-8 sm:w-56"
              />
            </div>
            <Select value={sort} onValueChange={(value) => setSort(value as SortBy)}>
              <SelectTrigger size="sm" className="h-9 w-full sm:w-44" aria-label="Сортировка досок">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated">По дате изменения</SelectItem>
                <SelectItem value="title">По названию</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {visible === null ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-muted">
              {isArchive ? (
                <Archive className="size-5 text-muted-foreground" />
              ) : (
                <LayoutGrid className="size-5 text-muted-foreground" />
              )}
            </span>
            <div className="space-y-1">
              <p className="font-medium">{emptyState.title}</p>
              <p className="text-sm text-muted-foreground">{emptyState.hint}</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((board) => (
              <Card
                key={board.id}
                className="group relative cursor-pointer py-0 transition-shadow hover:shadow-md"
                onClick={() => navigate(`/boards/${board.id}`)}
              >
                <CardContent className="flex min-h-24 flex-col justify-between gap-3 p-5">
                  <h2 className="line-clamp-2 pr-6 font-medium leading-snug">{board.title}</h2>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {BOARD_ROLE_LABELS[board.role]}
                      {board.archivedAt && ' · в архиве'}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-amber-500"
                        aria-label={board.favorite ? `Убрать «${board.title}» из избранного` : `Добавить «${board.title}» в избранное`}
                        aria-pressed={board.favorite}
                        onClick={(e) => {
                          e.stopPropagation();
                          void onToggleFavorite(board);
                        }}
                      >
                        <Star className={board.favorite ? 'size-4 fill-amber-400 text-amber-500' : 'size-4'} />
                      </Button>
                      {board.role === 'OWNER' && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                              aria-label={`Действия с доской «${board.title}»`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                            {board.archivedAt ? (
                              <DropdownMenuItem onClick={() => void onRestore(board)}>
                                <ArchiveRestore className="size-4" />
                                Восстановить
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => void onArchive(board)}>
                                <Archive className="size-4" />
                                В архив
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => void onDelete(board)}
                            >
                              <Trash2 className="size-4" />
                              Удалить
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
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
