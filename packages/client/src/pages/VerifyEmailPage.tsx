import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle } from 'lucide-react';
import * as authApi from '../api/auth';
import { errorText, useAuth } from '../state/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/spinner';

type State = 'checking' | 'ok' | 'error';

/** Подтверждение email по ссылке из письма (FR-31). */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { refresh } = useAuth();
  const [state, setState] = useState<State>('checking');
  const [message, setMessage] = useState<string | null>(null);
  // StrictMode в dev вызывает эффект дважды — токен одноразовый, второй запрос не нужен
  const processed = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState('error');
      setMessage('В ссылке нет токена подтверждения');
      return;
    }
    if (processed.current === token) return;
    processed.current = token;
    authApi
      .verifyEmail(token)
      .then(async () => {
        await refresh();
        setState('ok');
      })
      .catch((err) => {
        setMessage(errorText(err));
        setState('error');
      });
  }, [token, refresh]);

  return (
    <main className="flex min-h-full items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md py-0">
        {state === 'checking' && (
          <CardContent className="flex items-center justify-center gap-3 p-6 py-12 text-muted-foreground">
            <Spinner />
            Проверяем ссылку…
          </CardContent>
        )}

        {state === 'ok' && (
          <>
            <CardHeader className="p-6 pb-2">
              <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                <CheckCircle2 className="size-5" />
              </div>
              <CardTitle className="text-xl">Email подтверждён</CardTitle>
              <CardDescription>
                Теперь вы можете создавать доски и приглашать участников.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 pt-2">
              <Button asChild>
                <Link to="/boards">К доскам</Link>
              </Button>
            </CardContent>
          </>
        )}

        {state === 'error' && (
          <>
            <CardHeader className="p-6 pb-2">
              <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <XCircle className="size-5" />
              </div>
              <CardTitle className="text-xl">Не удалось подтвердить email</CardTitle>
              <CardDescription>{message}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 p-6 pt-2">
              <Button asChild>
                <Link to="/boards">К доскам</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/login">Войти</Link>
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </main>
  );
}
