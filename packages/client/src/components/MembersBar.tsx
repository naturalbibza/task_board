import type { PresenceUser, UserDto } from '@task-board/shared';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

/** Presence: аватары тех, кто сейчас на доске (FR-14). */
export function MembersBar(props: { online: PresenceUser[]; members: UserDto[] }) {
  const online = props.online;
  if (online.length === 0) return null;

  const visible = online.slice(0, 4);
  const rest = online.length - visible.length;

  return (
    <div className="flex items-center" title={`Участников на доске: ${props.members.length}`}>
      <div className="flex -space-x-2">
        {visible.map((user) => (
          <Tooltip key={user.userId}>
            <TooltipTrigger asChild>
              <span className="relative flex size-7 items-center justify-center rounded-full border-2 border-background bg-secondary text-[11px] font-semibold text-secondary-foreground">
                {initials(user.name)}
                <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-emerald-500 ring-2 ring-background" />
              </span>
            </TooltipTrigger>
            <TooltipContent>{user.name} — на доске</TooltipContent>
          </Tooltip>
        ))}
        {rest > 0 && (
          <span className="flex size-7 items-center justify-center rounded-full border-2 border-background bg-muted text-[11px] font-semibold text-muted-foreground">
            +{rest}
          </span>
        )}
      </div>
    </div>
  );
}
