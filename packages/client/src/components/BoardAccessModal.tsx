import { useEffect, useState } from 'react';
import { Check, Contact, Copy, Link2, MessageCircle, Phone, Plus, UserMinus, X } from 'lucide-react';
import {
  BOARD_ROLE_LABELS,
  MESSENGER_LABELS,
  can,
  type BoardRole,
  type InviteDto,
  type MemberDto,
} from '@task-board/shared';
import * as boardsApi from '../api/boards';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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

type AssignableRole = Exclude<BoardRole, 'OWNER'>;
const INVITE_ROLES: AssignableRole[] = ['ADMIN', 'EDITOR', 'VIEWER'];

interface BoardAccessModalProps {
  boardId: string;
  members: MemberDto[];
  myRole: BoardRole;
  onClose: () => void;
}

/** «Участники и доступ»: роли участников и invite-ссылки (US-10–12, US-15–17). */
export function BoardAccessModal(props: BoardAccessModalProps) {
  const [members, setMembers] = useState<MemberDto[]>(props.members);
  const [invites, setInvites] = useState<InviteDto[] | null>(null);
  const [inviteRole, setInviteRole] = useState<AssignableRole>('EDITOR');
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Снапшот обновляется через WS (member:updated/removed) — синхронизируемся с props
  useEffect(() => setMembers(props.members), [props.members]);

  useEffect(() => {
    // Ссылки видят и создают только владелец/админ; остальным запрос вернул бы 403
    if (!can(props.myRole, 'invite')) {
      setInvites([]);
      return;
    }
    boardsApi
      .listInvites(props.boardId)
      .then((res) => setInvites(res.invites))
      .catch((err: Error) => setError(err.message));
  }, [props.boardId, props.myRole]);

  const canManage = can(props.myRole, 'manageMembers');
  const canAssignAdmin = can(props.myRole, 'assignAdmin');
  const canInvite = can(props.myRole, 'invite');

  const linkOf = (token: string) => `${window.location.origin}/join/${token}`;

  const changeRole = async (member: MemberDto, role: AssignableRole) => {
    try {
      const res = await boardsApi.updateMember(props.boardId, member.id, role);
      setMembers((prev) => prev.map((m) => (m.id === member.id ? res.member : m)));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const removeMember = async (member: MemberDto) => {
    if (
      !window.confirm(
        `Удалить «${member.name}» из доски?\n\nДоступ по ссылке-приглашению будет отозван — вернуться по ней он не сможет.`,
      )
    ) {
      return;
    }
    try {
      const res = await boardsApi.removeMember(props.boardId, member.id);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      // Отозванные ссылки должны сразу отобразиться как «отозвана»
      if (res.revokedInvites > 0) {
        const invitesRes = await boardsApi.listInvites(props.boardId);
        setInvites(invitesRes.invites);
      }
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const createInvite = async () => {
    setBusy(true);
    try {
      const res = await boardsApi.createInvite(props.boardId, inviteRole);
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Участники и доступ</DialogTitle>
          <DialogDescription>
            Роли участников и ссылки-приглашения со сроком действия 7 дней.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="grid min-w-0 gap-5">
          <section className="grid min-w-0 gap-2">
            <h3 className="text-sm font-medium">Участники · {members.length}</h3>
            <ul className="min-w-0 divide-y overflow-hidden rounded-lg border">
              {members.map((member) => {
                const isOwnerRow = member.role === 'OWNER';
                const isAdminRow = member.role === 'ADMIN';
                const roleLocked = !canManage || isOwnerRow || (isAdminRow && !canAssignAdmin);
                return (
                  <li key={member.id} className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                      {initials(member.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{member.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{member.email}</div>
                    </div>

                    <div className="ml-auto flex shrink-0 items-center gap-1">
                      {(member.description || member.phone || member.messengers.length > 0) && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8 text-muted-foreground"
                              aria-label={`Контакты ${member.name}`}
                            >
                              <Contact className="size-4" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-72">
                            <div className="grid gap-2 text-sm">
                              <div>
                                <div className="font-medium">{member.name}</div>
                                <div className="truncate text-xs text-muted-foreground">{member.email}</div>
                              </div>
                              {member.description && (
                                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                                  {member.description}
                                </p>
                              )}
                              {member.phone && (
                                <div className="flex items-center gap-2">
                                  <Phone className="size-3.5 shrink-0 text-muted-foreground" />
                                  <span>{member.phone}</span>
                                </div>
                              )}
                              {member.messengers.map((messenger, index) => (
                                <div key={`${messenger.type}-${index}`} className="flex min-w-0 items-center gap-2">
                                  <MessageCircle className="size-3.5 shrink-0 text-muted-foreground" />
                                  <span className="shrink-0 text-muted-foreground">
                                    {MESSENGER_LABELS[messenger.type]}:
                                  </span>
                                  <span className="min-w-0 break-all">{messenger.value}</span>
                                </div>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}

                      {roleLocked ? (
                        <Badge variant={isOwnerRow ? 'default' : 'secondary'} className="font-normal">
                          {BOARD_ROLE_LABELS[member.role]}
                        </Badge>
                      ) : (
                        <Select
                          value={member.role}
                          onValueChange={(value) => void changeRole(member, value as AssignableRole)}
                        >
                          <SelectTrigger size="sm" className="w-40" aria-label={`Роль ${member.name}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(canAssignAdmin ? INVITE_ROLES : (['EDITOR', 'VIEWER'] as AssignableRole[])).map((role) => (
                              <SelectItem key={role} value={role}>
                                {BOARD_ROLE_LABELS[role]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}

                      {canManage && !isOwnerRow && !(isAdminRow && !canAssignAdmin) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          aria-label={`Удалить ${member.name} из доски`}
                          onClick={() => void removeMember(member)}
                        >
                          <UserMinus className="size-4" />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {canInvite && (
            <section className="grid min-w-0 gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Ссылки-приглашения</h3>
              {canInvite && (
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as AssignableRole)}>
                    <SelectTrigger size="sm" className="w-40" aria-label="Роль по ссылке">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INVITE_ROLES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {BOARD_ROLE_LABELS[role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" onClick={() => void createInvite()} disabled={busy}>
                    <Plus className="size-4" />
                    Создать ссылку
                  </Button>
                </div>
              )}
            </div>

            {invites === null ? (
              <div className="grid gap-2">
                <Skeleton className="h-14 rounded-lg" />
                <Skeleton className="h-14 rounded-lg" />
              </div>
            ) : invites.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                Ссылок пока нет. Создайте первую — и отправьте её коллеге.
              </p>
            ) : (
              <ul className="grid min-w-0 gap-2">
                {invites.map((invite) => (
                  <li key={invite.id} className="flex min-w-0 flex-col gap-2 rounded-lg border px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Link2 className="size-4 shrink-0 text-muted-foreground" />
                      {invite.revoked ? (
                        <Badge variant="secondary" className="font-normal">
                          ссылка отозвана
                        </Badge>
                      ) : (
                        <>
                          <Badge variant="outline" className="shrink-0 font-normal">
                            {BOARD_ROLE_LABELS[invite.role]}
                          </Badge>
                          <span
                            className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
                            title={linkOf(invite.token)}
                          >
                            {linkOf(invite.token)}
                          </span>
                        </>
                      )}
                    </div>

                    {!invite.revoked && (
                      <div className="flex flex-wrap justify-end gap-1">
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
                        {canInvite && (
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
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            </section>
          )}
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
