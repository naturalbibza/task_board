import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, LogOut, Plus, Save, Trash2 } from 'lucide-react';
import {
  MESSENGER_LABELS,
  messengerTypeSchema,
  type MessengerContact,
  type MessengerType,
  type UserProfileDto,
} from '@task-board/shared';
import { toast } from 'sonner';
import * as usersApi from '../api/users';
import * as authApi from '../api/auth';
import { errorText, useAuth } from '../state/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';

const MESSENGER_TYPES = messengerTypeSchema.options;

export function ProfilePage() {
  const { user, loading, refresh, emailVerificationRequired } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<UserProfileDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [messengers, setMessengers] = useState<MessengerContact[]>([]);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!user) return;
    usersApi
      .getProfile()
      .then((res) => {
        setProfile(res.user);
        setName(res.user.name);
        setDescription(res.user.description ?? '');
        setPhone(res.user.phone ?? '');
        setMessengers(res.user.messengers);
      })
      .catch((err) => setLoadError(errorText(err)));
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-full bg-background">
        <div className="mx-auto max-w-2xl space-y-4 px-4 py-10">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Имя не может быть пустым');
      return;
    }
    setSavingProfile(true);
    try {
      const res = await usersApi.updateProfile({
        name: trimmedName,
        description: description.trim() || null,
        phone: phone.trim() || null,
        messengers: messengers
          .map((m) => ({ type: m.type, value: m.value.trim() }))
          .filter((m) => m.value.length > 0),
      });
      setProfile(res.user);
      setMessengers(res.user.messengers);
      await refresh();
      toast.success('Профиль сохранён');
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error('Новый пароль должен быть не короче 8 символов');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Пароли не совпадают');
      return;
    }
    setSavingPassword(true);
    try {
      await usersApi.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Пароль изменён — остальные сессии завершены');
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSavingPassword(false);
    }
  };

  const resendVerification = async () => {
    setResending(true);
    try {
      const res = await authApi.resendVerification();
      toast.success(res.alreadyVerified ? 'Email уже подтверждён' : 'Письмо отправлено — проверьте почту');
      if (res.alreadyVerified) await refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setResending(false);
    }
  };

  const logoutAll = async () => {
    if (!window.confirm('Завершить все сессии, кроме текущей? На других устройствах потребуется повторный вход.')) {
      return;
    }
    try {
      await usersApi.logoutAll();
      toast.success('Остальные сессии завершены');
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const updateMessenger = (index: number, patch: Partial<MessengerContact>) => {
    setMessengers((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  };

  return (
    <div className="min-h-full bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-3">
            <Logo />
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('/boards')}>
              <ArrowLeft className="size-4" />
              Доски
            </Button>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Профиль</h1>
          <p className="text-sm text-muted-foreground">
            Контакты видят участники ваших досок — так им проще с вами связаться.
          </p>
        </div>

        {loadError && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {loadError}
          </p>
        )}

        <Card className="py-0">
          <CardHeader className="p-6 pb-2">
            <CardTitle className="text-base">Основное</CardTitle>
            <CardDescription>Имя видно всем, остальное — по желанию.</CardDescription>
          </CardHeader>
          <CardContent className="p-6 pt-2">
            {profile === null ? (
              <div className="grid gap-4">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : (
              <form onSubmit={(e) => void saveProfile(e)} className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="profile-email">Email</Label>
                  <Input id="profile-email" value={profile.email} readOnly disabled />
                  {/* Статус подтверждения — только когда режим включён (FR-52) */}
                  {emailVerificationRequired && (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {user.emailVerified ? (
                        <span className="text-emerald-600 dark:text-emerald-400">Email подтверждён</span>
                      ) : (
                        <>
                          <span className="text-amber-600 dark:text-amber-400">
                            Email не подтверждён — доступ к созданию досок и приглашениям ограничен
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={resending}
                            onClick={() => void resendVerification()}
                          >
                            {resending ? 'Отправляем…' : 'Отправить письмо'}
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="profile-name">Имя</Label>
                  <Input
                    id="profile-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={50}
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="profile-description">
                    О себе <span className="font-normal text-muted-foreground">(необязательно)</span>
                  </Label>
                  <Textarea
                    id="profile-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={500}
                    rows={3}
                    placeholder="Чем занимаетесь, над чем работаете…"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="profile-phone">
                    Телефон <span className="font-normal text-muted-foreground">(необязательно)</span>
                  </Label>
                  <Input
                    id="profile-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    maxLength={50}
                    placeholder="+7 …"
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Мессенджеры</Label>
                  {messengers.length === 0 && (
                    <p className="text-sm text-muted-foreground">Контактов пока нет.</p>
                  )}
                  {messengers.map((messenger, index) => (
                    <div key={index} className="flex flex-wrap items-center gap-2">
                      <Select
                        value={messenger.type}
                        onValueChange={(value) => updateMessenger(index, { type: value as MessengerType })}
                      >
                        <SelectTrigger className="w-36" aria-label="Тип мессенджера">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MESSENGER_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                              {MESSENGER_LABELS[type]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        className="min-w-0 flex-1"
                        value={messenger.value}
                        onChange={(e) => updateMessenger(index, { value: e.target.value })}
                        maxLength={100}
                        aria-label="Контакт"
                        placeholder="@username или номер"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="Удалить контакт"
                        onClick={() => setMessengers((prev) => prev.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                  {messengers.length < 5 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-fit gap-1.5"
                      onClick={() => setMessengers((prev) => [...prev, { type: 'telegram', value: '' }])}
                    >
                      <Plus className="size-4" />
                      Добавить контакт
                    </Button>
                  )}
                </div>

                <div className="flex justify-end">
                  <Button type="submit" disabled={savingProfile} className="gap-1.5">
                    <Save className="size-4" />
                    {savingProfile ? 'Сохраняем…' : 'Сохранить'}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        <Card className="py-0">
          <CardHeader className="p-6 pb-2">
            <CardTitle className="text-base">Пароль</CardTitle>
            <CardDescription>После смены все остальные сессии завершатся.</CardDescription>
          </CardHeader>
          <CardContent className="p-6 pt-2">
            <form onSubmit={(e) => void changePassword(e)} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="current-password">Текущий пароль</Label>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="new-password">Новый пароль</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="confirm-password">Повторите новый пароль</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={savingPassword}>
                  {savingPassword ? 'Меняем…' : 'Изменить пароль'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="py-0">
          <CardHeader className="p-6 pb-2">
            <CardTitle className="text-base">Сессии</CardTitle>
            <CardDescription>
              Если вы входили с чужого устройства, завершите все сессии, кроме текущей.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 pt-2">
            <Button type="button" variant="outline" className="gap-1.5" onClick={() => void logoutAll()}>
              <LogOut className="size-4" />
              Выйти на всех устройствах
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
