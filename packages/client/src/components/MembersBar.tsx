import type { PresenceUser, UserDto } from '@task-board/shared';

/** Полоска presence: кто сейчас подключён к доске (FR-14). */
export function MembersBar(props: { online: PresenceUser[]; members: UserDto[] }) {
  const online = props.online;
  if (online.length === 0) return null;

  return (
    <div className="members-bar" title={`Участников на доске: ${props.members.length}`}>
      {online.map((u) => (
        <span key={u.userId} className="member-chip">
          <span className="online-dot" aria-hidden />
          {u.name}
        </span>
      ))}
    </div>
  );
}
