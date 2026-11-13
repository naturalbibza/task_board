import { useEffect, useState } from 'react';
import type { UserDto } from '@task-board/shared';
import * as boardsApi from '../api/boards';
import type { InviteDto } from '../api/boards';

/** Модалка шаринга (US-10–12): участники + invite-ссылки с копированием и отзывом. */
export function ShareModal(props: { boardId: string; members: UserDto[]; onClose: () => void }) {
  const [invites, setInvites] = useState<InviteDto[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    boardsApi
      .listInvites(props.boardId)
      .then((res) => setInvites(res.invites))
      .catch((err) => setError(`${err.message ?? err}`));
  };

  useEffect(reload, [props.boardId]);

  const linkOf = (token: string) => `${window.location.origin}/join/${token}`;

  const create = async () => {
    try {
      const res = await boardsApi.createInvite(props.boardId);
      setInvites((prev) => [...(prev ?? []), res.invite]);
    } catch (err) {
      setError(`${(err as Error).message}`);
    }
  };

  const revoke = async (invite: InviteDto) => {
    try {
      const res = await boardsApi.revokeInvite(invite.id);
      setInvites((prev) => (prev ?? []).map((i) => (i.id === invite.id ? res.invite : i)));
    } catch (err) {
      setError(`${(err as Error).message}`);
    }
  };

  const copy = async (invite: InviteDto) => {
    try {
      await navigator.clipboard.writeText(linkOf(invite.token));
      setCopied(invite.id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      window.prompt('Скопируйте ссылку вручную:', linkOf(invite.token));
    }
  };

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <h1>Шаринг доски</h1>

        <h2 className="share-subtitle">Участники ({props.members.length})</h2>
        <ul className="member-list">
          {props.members.map((m) => (
            <li key={m.id}>{m.name}</li>
          ))}
        </ul>

        <h2 className="share-subtitle">Ссылки-приглашения</h2>
        {error && <p className="error">{error}</p>}
        {invites === null ? (
          <p className="empty">Загрузка…</p>
        ) : (
          <ul className="invite-list">
            {invites.map((invite) => (
              <li key={invite.id} className="invite-item">
                {invite.revoked ? (
                  <span className="invite-revoked">отозвана</span>
                ) : (
                  <>
                    <span className="invite-link" title={linkOf(invite.token)}>
                      {linkOf(invite.token).slice(0, 48)}…
                    </span>
                    <button type="button" className="link" onClick={() => void copy(invite)}>
                      {copied === invite.id ? 'скопировано' : 'копировать'}
                    </button>
                    <button type="button" className="link danger" onClick={() => void revoke(invite)}>
                      отозвать
                    </button>
                  </>
                )}
              </li>
            ))}
            {invites.length === 0 && <li className="empty">Ссылок ещё нет</li>}
          </ul>
        )}

        <div className="modal-actions">
          <button type="button" onClick={() => void create()}>
            Создать ссылку (7 дней)
          </button>
          <button type="button" className="link" onClick={props.onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
