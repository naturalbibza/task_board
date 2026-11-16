import type { BoardRole } from './api-types';

/**
 * Матрица прав на доске (FR-23) — единый источник истины для сервера и клиента.
 * Сервер обязан проверять каждое действие, клиент использует `can()` только для UI.
 */
export type BoardAction =
  | 'view'
  | 'editContent'
  | 'invite'
  | 'manageMembers'
  | 'renameBoard'
  | 'archiveBoard'
  | 'deleteBoard'
  | 'assignAdmin';

const PERMISSIONS: Record<BoardRole, readonly BoardAction[]> = {
  OWNER: [
    'view',
    'editContent',
    'invite',
    'manageMembers',
    'renameBoard',
    'archiveBoard',
    'deleteBoard',
    'assignAdmin',
  ],
  ADMIN: ['view', 'editContent', 'invite', 'manageMembers', 'renameBoard'],
  EDITOR: ['view', 'editContent'],
  VIEWER: ['view'],
};

export function can(role: BoardRole, action: BoardAction): boolean {
  return PERMISSIONS[role].includes(action);
}

export const BOARD_ROLE_LABELS: Record<BoardRole, string> = {
  OWNER: 'владелец',
  ADMIN: 'администратор',
  EDITOR: 'редактор',
  VIEWER: 'наблюдатель',
};
