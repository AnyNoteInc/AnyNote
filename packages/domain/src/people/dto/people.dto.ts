import type { Prisma, RoleType } from '@repo/db'

import { DomainError } from '../../shared/errors.ts'

// ── audit catalog (spec §2) ───────────────────────────────────────────────────

/**
 * `WorkspaceAuditLog.action` catalog for Phase 8A. Every people mutation writes
 * exactly one row with one of these actions, in the same transaction. 8B/8C
 * append their own actions.
 */
export const PEOPLE_AUDIT_ACTIONS = {
  memberInvited: 'member.invited',
  inviteRevoked: 'invite.revoked',
  inviteAccepted: 'invite.accepted',
  inviteLinkEnabled: 'invite_link.enabled',
  inviteLinkDisabled: 'invite_link.disabled',
  inviteLinkRotated: 'invite_link.rotated',
  inviteLinkJoined: 'invite_link.joined',
  memberRoleChanged: 'member.role_changed',
  memberRemoved: 'member.removed',
  guestInvited: 'guest.invited',
  guestInviteRevoked: 'guest.invite_revoked',
  guestJoined: 'guest.joined',
  guestAccessRevoked: 'guest.access_revoked',
  guestConvertedToMember: 'guest.converted_to_member',
  userBlocked: 'user.blocked',
  userUnblocked: 'user.unblocked',
} as const

export type PeopleAuditAction = (typeof PEOPLE_AUDIT_ACTIONS)[keyof typeof PEOPLE_AUDIT_ACTIONS]

// ── error codes (spec §3) ─────────────────────────────────────────────────────

export const PEOPLE_ERROR_CODES = {
  INVITE_NOT_FOUND: 'INVITE_NOT_FOUND',
  INVITE_EXPIRED: 'INVITE_EXPIRED',
  INVITE_REVOKED: 'INVITE_REVOKED',
  INVITE_EMAIL_MISMATCH: 'INVITE_EMAIL_MISMATCH',
  ALREADY_MEMBER: 'ALREADY_MEMBER',
  SEAT_LIMIT_REACHED: 'SEAT_LIMIT_REACHED',
  USER_BLOCKED: 'USER_BLOCKED',
  LAST_OWNER: 'LAST_OWNER',
  FORBIDDEN_ROLE: 'FORBIDDEN_ROLE',
} as const

export type PeopleErrorCode = keyof typeof PEOPLE_ERROR_CODES

const PEOPLE_ERROR_DEFS: Record<PeopleErrorCode, { httpStatus: number; message: string }> = {
  INVITE_NOT_FOUND: { httpStatus: 404, message: 'Приглашение не найдено' },
  INVITE_EXPIRED: { httpStatus: 412, message: 'Срок действия приглашения истёк' },
  INVITE_REVOKED: { httpStatus: 412, message: 'Приглашение отозвано' },
  INVITE_EMAIL_MISMATCH: { httpStatus: 403, message: 'Приглашение выдано на другой email' },
  ALREADY_MEMBER: { httpStatus: 409, message: 'Пользователь уже является участником воркспейса' },
  SEAT_LIMIT_REACHED: {
    httpStatus: 403,
    message: 'Достигнут лимит участников воркспейса. Повысьте тариф или удалите участников.',
  },
  USER_BLOCKED: { httpStatus: 403, message: 'Доступ заблокирован администратором' },
  LAST_OWNER: { httpStatus: 409, message: 'Нельзя лишить воркспейс последнего владельца' },
  FORBIDDEN_ROLE: { httpStatus: 403, message: 'Эту роль нельзя назначить' },
}

/** A `DomainError` whose `code` is the people-error code itself (not a generic FORBIDDEN). */
export function peopleError(code: PeopleErrorCode): DomainError {
  const def = PEOPLE_ERROR_DEFS[code]
  return new DomainError(code, def.message, def.httpStatus)
}

// ── invitations ───────────────────────────────────────────────────────────────

/** Roles a member invitation may carry — never OWNER, never the frozen legacy GUEST. */
export const INVITABLE_MEMBER_ROLES: readonly RoleType[] = [
  'ADMIN',
  'EDITOR',
  'COMMENTER',
  'VIEWER',
]

export const INVITE_TTL_DAYS = 7

/** Invitations store emails lowercased; comparisons are case-insensitive. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export type InvitationState = 'PENDING' | 'EXPIRED'

export interface WorkspaceInvitationDto {
  id: string
  workspaceId: string
  email: string
  role: RoleType
  inviterId: string
  expiresAt: Date
  createdAt: Date
  state: InvitationState
}

export interface CreateInvitationInput {
  workspaceId: string
  actorId: string
  email: string
  role: RoleType
}

export interface CreateInvitationResult {
  invitation: WorkspaceInvitationDto
  /** Plaintext invite token — surfaced exactly once, for the email link. Only the hash is stored. */
  token: string
}

export interface RevokeInvitationInput {
  workspaceId: string
  actorId: string
  invitationId: string
}

export interface AcceptInvitationInput {
  token: string
  userId: string
  /** The session email — equality with the invite email is checked case-insensitively. */
  userEmail: string
}

export interface AcceptInvitationResult {
  workspaceId: string
  role: RoleType
  /** True when the user already held a seat (double-accept or joined via another path). */
  alreadyMember: boolean
}

/** Billing-impact data for the invite form («Занято X из Y мест тарифа Z»). */
export interface InvitePreview {
  currentMembers: number
  maxMembers: number
  planSlug: string
  isPaid: boolean
  periodEnd: Date | null
}

// ── audit writer ──────────────────────────────────────────────────────────────

export interface PeopleAuditEntry {
  workspaceId: string
  /** Null = system action. */
  actorId: string | null
  action: PeopleAuditAction
  targetUserId?: string
  targetEmail?: string
  metadata?: Prisma.InputJsonValue
}
