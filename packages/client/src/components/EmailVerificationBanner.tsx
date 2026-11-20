import { useState } from 'react';
import { MailWarning } from 'lucide-react';
import { toast } from 'sonner';
import * as authApi from '../api/auth';
import { errorText, useAuth } from '../state/auth-context';
import { Button } from '@/components/ui/button';

/**
 * Плашка для неподтверждённого email (FR-32): объясняет ограничения и позволяет
 * отправить письмо ещё раз или проверить статус (подтверждение в другой вкладке).
 */
export function EmailVerificationBanner() {
  const { user, refresh } = useAuth();
  const [busy, setBusy] = useState(false);

  if (!user || user.emailVerified) return null;

  const resend = async () => {
    setBusy(true);
    try {
      const res = await authApi.resendVerification();
      toast.success(res.alreadyVerified ? 'Email уже подтверждён' : 'Письмо отправлено — проверьте почту');
      if (res.alreadyVerified) await refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    await refresh();
    toast.info('Статус обновлён');
  };

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-2 text-sm">
        <MailWarning className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="min-w-0 flex-1">
          Подтвердите email: создавать доски и приглашать участников можно только после подтверждения.
        </span>
        <Button type="button" size="sm" variant="outline" onClick={() => void resend()} disabled={busy}>
          {busy ? 'Отправляем…' : 'Отправить письмо'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => void check()}>
          Проверить
        </Button>
      </div>
    </div>
  );
}
