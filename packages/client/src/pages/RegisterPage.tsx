import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { errorText, useAuth } from '../state/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/logo';

export function RegisterPage() {
  const { user, loading, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Возврат на исходную страницу после регистрации (FR-15: invite → регистрация → доска)
  const next = (location.state as { from?: string } | null)?.from ?? '/boards';
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to={next} replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }
    setBusy(true);
    try {
      await register({ email, password, name: name.trim() || undefined });
      navigate(next, { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-full items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo />
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Регистрация</h1>
            <p className="text-sm text-muted-foreground">Создайте аккаунт, чтобы работать с досками</p>
          </div>
        </div>

        <Card className="py-0">
          <CardContent className="p-6">
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="name">
                  Имя <span className="font-normal text-muted-foreground">(необязательно)</span>
                </Label>
                <Input
                  id="name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={50}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">
                  Пароль <span className="font-normal text-muted-foreground">(минимум 8 символов)</span>
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="confirm">Повторите пароль</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              {error && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Создаём аккаунт…' : 'Создать аккаунт'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Уже есть аккаунт?{' '}
          <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Войдите
          </Link>
        </p>
      </div>
    </main>
  );
}
