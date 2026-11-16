import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { joinByToken } from '../api/boards';
import { errorText } from '../state/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/spinner';

type Status = 'joining' | 'need-auth' | 'joined' | 'error';

/** Вступление по invite-ссылке (FR-15): неавторизованного ведём на логин с возвратом. */
export function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const location = useLocation();
  const [status, setStatus] = useState<Status>('joining');
  const [boardTitle, setBoardTitle] = useState<string | null>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const from = encodeURIComponent(location.pathname + location.search);

  useEffect(() => {
    if (!token || status !== 'joining') return;
    let cancelled = false;
    joinByToken(token)
      .then((res) => {
        if (cancelled) return;
        setBoardTitle(res.boardTitle);
        setBoardId(res.boardId);
        setStatus('joined');
      })
      .catch((err) => {
        if (cancelled) return;
        const text = errorText(err);
        if (text.includes('Войдите')) {
          setStatus('need-auth');
        } else {
          setMessage(text);
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, status]);

  return (
    <main className="flex min-h-full items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md py-0">
        {status === 'joining' && (
          <CardContent className="flex items-center justify-center gap-3 p-6 py-12 text-muted-foreground">
            <Spinner />
            Присоединяемся к доске…
          </CardContent>
        )}

        {status === 'need-auth' && (
          <>
            <CardHeader className="p-6 pb-2">
              <CardTitle className="text-xl">Приглашение на доску</CardTitle>
              <CardDescription>
                Чтобы присоединиться, войдите или зарегистрируйтесь — после этого вы вернётесь на доску.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 px-6 pb-6">
              <Button asChild>
                <Link to={`/login?next=${from}`}>Войти</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to={`/register?next=${from}`}>Зарегистрироваться</Link>
              </Button>
            </CardContent>
          </>
        )}

        {status === 'error' && (
          <>
            <CardHeader className="p-6 pb-2">
              <CardTitle className="text-xl">Не удалось присоединиться</CardTitle>
              <CardDescription>{message}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link to="/boards">К списку досок</Link>
              </Button>
            </CardContent>
          </>
        )}

        {status === 'joined' && (
          <>
            <CardHeader className="p-6 pb-2">
              <CardTitle className="text-xl">Готово</CardTitle>
              <CardDescription>Вы присоединились к доске «{boardTitle}».</CardDescription>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              <Button asChild>
                <Link to={`/boards/${boardId}`}>Открыть доску</Link>
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </main>
  );
}
