import { useEffect, useState } from 'react';
import { Check, Copy, Link2, Plus, X } from 'lucide-react';
import type { UserDto } from '@task-board/shared';
import * as boardsApi from '../api/boards';
import type { InviteDto } from '../api/boards';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/** Шаринг (US-10–12): участники + invite-ссылки. */
export function ShareModal(props: { boardId: string; members: UserDto[]; onClose: () => void }) {
  const [invites, setInvites] = useState<InviteDto[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    boardsApi
      .listInvites(props.boardId)
      .then((res) => setInvites(res.invites))
      .catch((err: Error) => setError(err.message));
  };

  useEffect(reload, [props.boardId]);

  const linkOf = (token: string) => `${window.location.origin}/join/${token}`;

  const create = async () => {
    setBusy(true);
    try {
      const res = await boardsApi.createInvite(props.boardId);
      setInvites((prev) => [...(prev ?? []), res.invite]);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (invite: InviteDto) => {
    try {
      const res = await boardsApi.revokeInvite(invite.id);
      setInvites((prev) => (prev ?? []).map((i) => (i.id === invite.id ? res.invite : i)));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const copy = async (invite: InviteDto) => {
    try {
      await navigator.clipboard.writeText(linkOf(invite.token));
      setCopied(invite.id);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      window.prompt('Скопируйте ссылку вручную:', linkOf(invite.token));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) props.onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Доступ к доске</DialogTitle>
          <DialogDescription>Участники доски и ссылки-приглашения со сроком действия 7 дней.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <section className="grid gap-2">
            <h3 className="text-sm font-medium">Участники · {props.members.length}</h3>
            <ul className="divide-y overflow-hidden rounded-lg border">
              {props.members.map((member) => (
                <li key={member.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                    {initials(member.name)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{member.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{member.email}</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Ссылки-приглашения</h3>
              <Button size="sm" variant="outline" onClick={() => void create()} disabled={busy}>
                <Plus className="size-4" />
                Создать ссылку
              </Button>
            </div>

            {error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            {invites === null ? (
              <div className="grid gap-2">
                <Skeleton className="h-10 rounded-lg" />
                <Skeleton className="h-10 rounded-lg" />
              </div>
            ) : invites.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                Ссылок пока нет. Создайте первую — и отправьте её коллеге.
              </p>
            ) : (
              <ul className="grid gap-2">
                {invites.map((invite) => (
                  <li
                    key={invite.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 sm:flex-nowrap"
                  >
                    <Link2 className="size-4 shrink-0 text-muted-foreground" />
                    {invite.revoked ? (
                      <Badge variant="secondary" className="font-normal">
                        ссылка отозвана
                      </Badge>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={linkOf(invite.token)}>
                          {linkOf(invite.token)}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          onClick={() => void copy(invite)}
                        >
                          {copied === invite.id ? <Check className="size-4" /> : <Copy className="size-4" />}
                          {copied === invite.id ? 'Скопировано' : 'Копировать'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-destructive hover:text-destructive"
                          onClick={() => void revoke(invite)}
                        >
                          <X className="size-4" />
                          Отозвать
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={props.onClose}>
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
