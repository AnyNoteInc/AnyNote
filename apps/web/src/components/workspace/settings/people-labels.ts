// Shared label maps for the people-management settings blocks
// (members-section.tsx and its subcomponents).

export type ChipColor = 'default' | 'success' | 'error' | 'warning' | 'info'

/** Workspace member roles (RoleType). GUEST is the frozen legacy role. */
export const MEMBER_ROLE_LABELS: Record<string, string> = {
  OWNER: 'Владелец',
  ADMIN: 'Администратор',
  EDITOR: 'Редактор',
  COMMENTER: 'Комментатор',
  VIEWER: 'Читатель',
  GUEST: 'Гость (устар.)',
}

/** Page-grant roles (PageShareRole) for guest invites. */
export const SHARE_ROLE_LABELS: Record<string, string> = {
  READER: 'Читатель',
  COMMENTER: 'Комментатор',
  EDITOR: 'Редактор',
}

/** Roles assignable through the invite form / member role select — never OWNER/GUEST. */
export const INVITABLE_ROLES = ['ADMIN', 'EDITOR', 'COMMENTER', 'VIEWER'] as const
export type InvitableRole = (typeof INVITABLE_ROLES)[number]

export const INVITE_STATE_CHIPS: Record<string, { label: string; color: ChipColor }> = {
  PENDING: { label: 'Ожидает', color: 'default' },
  EXPIRED: { label: 'Просрочено', color: 'warning' },
}

export function formatDateTime(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
