import type { Prisma } from '@repo/db'

import { DomainError } from '../../shared/errors.ts'

/**
 * Prisma's `PageShareRole` / `GuestInviteRequestStatus` enums as string unions
 * (the people-module precedent — the enums aren't re-exported from the
 * `@repo/db` barrel). `GuestShareRole` is deliberately NOT named
 * `PageShareRole`: both this barrel and the people barrel feed the package
 * root barrel, and an `export *` name clash would silently drop the symbol.
 */
export type GuestShareRole = 'READER' | 'COMMENTER' | 'EDITOR'
export type GuestRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

// ── audit catalog (spec §2) ───────────────────────────────────────────────────

/**
 * `WorkspaceAuditLog.action` catalog for Phase 8C. Every security mutation
 * writes exactly one row per audited event, in the same transaction.
 *
 * `content_search.page_inspected` (the spec-optional drill-down audit) is
 * deliberately NOT included: 8C ships no per-row inspect surface — result rows
 * link straight to the page — and an unused catalog entry is dead weight that
 * costs review cycles (the identity `jitJoined` precedent).
 */
export const SECURITY_AUDIT_ACTIONS = {
  policyChanged: 'security.policy_changed',
  searchAcknowledged: 'security.search_acknowledged',
  contentSearchPerformed: 'content_search.performed',
  contentSearchOverride: 'content_search.override',
  guestRequestCreated: 'guest_request.created',
  guestRequestApproved: 'guest_request.approved',
  guestRequestRejected: 'guest_request.rejected',
} as const

export type SecurityAuditAction =
  (typeof SECURITY_AUDIT_ACTIONS)[keyof typeof SECURITY_AUDIT_ACTIONS]

// ── error codes (spec §3) ─────────────────────────────────────────────────────

export const SECURITY_ERROR_CODES = {
  POLICY_GUEST_INVITES_DISABLED: 'POLICY_GUEST_INVITES_DISABLED',
  POLICY_PUBLIC_SHARING_DISABLED: 'POLICY_PUBLIC_SHARING_DISABLED',
  POLICY_EXPORT_DISABLED: 'POLICY_EXPORT_DISABLED',
  POLICY_CROSS_WORKSPACE_DISABLED: 'POLICY_CROSS_WORKSPACE_DISABLED',
  POLICY_REQUESTS_DISABLED: 'POLICY_REQUESTS_DISABLED',
  SEARCH_ACK_REQUIRED: 'SEARCH_ACK_REQUIRED',
  REQUEST_NOT_FOUND: 'REQUEST_NOT_FOUND',
  REQUEST_ALREADY_DECIDED: 'REQUEST_ALREADY_DECIDED',
} as const

export type SecurityErrorCode = keyof typeof SECURITY_ERROR_CODES

// Honest messages that NAME the policy (spec §4: never vague denials).
const SECURITY_ERROR_DEFS: Record<SecurityErrorCode, { httpStatus: number; message: string }> = {
  POLICY_GUEST_INVITES_DISABLED: {
    httpStatus: 403,
    message: 'Гостевые приглашения отключены политикой безопасности пространства',
  },
  POLICY_PUBLIC_SHARING_DISABLED: {
    httpStatus: 403,
    message: 'Публичные ссылки и сайты отключены политикой безопасности пространства',
  },
  POLICY_EXPORT_DISABLED: {
    httpStatus: 403,
    message: 'Экспорт отключён политикой безопасности пространства',
  },
  POLICY_CROSS_WORKSPACE_DISABLED: {
    httpStatus: 403,
    message: 'Копирование в другие пространства отключено политикой безопасности',
  },
  POLICY_REQUESTS_DISABLED: {
    httpStatus: 403,
    message: 'Запросы на гостевой доступ отключены политикой безопасности пространства',
  },
  SEARCH_ACK_REQUIRED: {
    httpStatus: 412,
    message: 'Сначала подтвердите предупреждение о поиске по содержимому пространства',
  },
  REQUEST_NOT_FOUND: { httpStatus: 404, message: 'Запрос на гостевой доступ не найден' },
  REQUEST_ALREADY_DECIDED: { httpStatus: 409, message: 'Запрос на гостевой доступ уже рассмотрен' },
}

/**
 * A `DomainError` whose `code` is the security-error code itself (people-module
 * pattern). `messageOverride` exists for the one place a code carries two
 * truths: POLICY_REQUESTS_DISABLED when invites are ENABLED (requests are
 * pointless — invites are available directly).
 */
export function securityError(code: SecurityErrorCode, messageOverride?: string): DomainError {
  const def = SECURITY_ERROR_DEFS[code]
  return new DomainError(code, messageOverride ?? def.message, def.httpStatus)
}

// ── policy (spec §2/§3) ───────────────────────────────────────────────────────

export interface SecurityPolicyDto {
  workspaceId: string
  disableGuestInvites: boolean
  /** Meaningful only when invites are disabled. */
  allowGuestInviteRequests: boolean
  disablePublicLinksSitesForms: boolean
  disableExport: boolean
  disableMoveDuplicateOutsideWorkspace: boolean
  /** The one-time admin-content-search privacy-warning acknowledgment (8C Task 3). */
  adminContentSearchAcknowledgedAt: Date | null
  adminContentSearchAcknowledgedById: string | null
}

/**
 * No row = this zero-value policy (spec §2): everything allowed, requests
 * available the moment invites get disabled, search not yet acknowledged.
 */
export function zeroSecurityPolicy(workspaceId: string): SecurityPolicyDto {
  return {
    workspaceId,
    disableGuestInvites: false,
    allowGuestInviteRequests: true,
    disablePublicLinksSitesForms: false,
    disableExport: false,
    disableMoveDuplicateOutsideWorkspace: false,
    adminContentSearchAcknowledgedAt: null,
    adminContentSearchAcknowledgedById: null,
  }
}

/** The five owner-patchable flags — the ack fields move only via acknowledgeContentSearch. */
export const SECURITY_POLICY_FLAGS = [
  'disableGuestInvites',
  'allowGuestInviteRequests',
  'disablePublicLinksSitesForms',
  'disableExport',
  'disableMoveDuplicateOutsideWorkspace',
] as const

export type SecurityPolicyFlag = (typeof SECURITY_POLICY_FLAGS)[number]

export type SecurityPolicyPatch = Partial<Pick<SecurityPolicyDto, SecurityPolicyFlag>>

export interface UpdateSecurityPolicyInput {
  workspaceId: string
  actorId: string
  patch: SecurityPolicyPatch
}

// ── pure enforcement helpers (spec §3) ────────────────────────────────────────

export const isGuestInviteDisabled = (p: SecurityPolicyDto): boolean => p.disableGuestInvites
export const isPublicSharingDisabled = (p: SecurityPolicyDto): boolean =>
  p.disablePublicLinksSitesForms
export const isExportDisabled = (p: SecurityPolicyDto): boolean => p.disableExport
export const isCrossWorkspaceCopyDisabled = (p: SecurityPolicyDto): boolean =>
  p.disableMoveDuplicateOutsideWorkspace
/** Requests exist only in the gap the policy opens: invites OFF, requests ON. */
export const canRequestGuestInvite = (p: SecurityPolicyDto): boolean =>
  p.disableGuestInvites && p.allowGuestInviteRequests

// ── guest invite requests (spec §3) ───────────────────────────────────────────

export interface GuestInviteRequestDto {
  id: string
  pageId: string
  workspaceId: string
  email: string
  role: GuestShareRole
  requesterId: string
  status: GuestRequestStatus
  decidedById: string | null
  decidedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** The settings-queue row: the request plus requester/page context for the UI. */
export interface GuestInviteRequestListItem extends GuestInviteRequestDto {
  requesterName: string | null
  requesterEmail: string
  /** Null mirrors the nullable `Page.title` — the UI renders its own placeholder. */
  pageTitle: string | null
}

export interface CreateGuestInviteRequestInput {
  pageId: string
  requesterId: string
  email: string
  role: GuestShareRole
}

export interface CreateGuestInviteRequestResult {
  request: GuestInviteRequestDto
  /** Workspace OWNER userIds — the ROUTER notifies them; the domain emits nothing. */
  ownerIds: string[]
}

export interface DecideGuestInviteRequestInput {
  workspaceId: string
  id: string
  actorId: string
}

// ── the people-service port (approve path) ───────────────────────────────────

/**
 * Structural mirror of the people module's `GuestInviteDto` — kept in sync by
 * the compile-time pin in the security test suite (`PeopleService` must stay
 * assignable to `SecurityGuestInviteCreator`).
 */
export interface ApprovedGuestInvite {
  id: string
  pageId: string
  workspaceId: string
  email: string
  role: GuestShareRole
  inviterId: string
  expiresAt: Date
  createdAt: Date
  state: 'PENDING' | 'EXPIRED'
}

/**
 * What the security module needs from the people service: exactly
 * `PeopleService.createGuestInvite`. Declared HERE as a structural port —
 * importing the people barrel from this module would close an import cycle
 * (people.service imports `securityError` from the security barrel for the
 * createGuestInvite policy gate).
 */
export interface SecurityGuestInviteCreator {
  createGuestInvite(
    input: { pageId: string; actorId: string; email: string; role: GuestShareRole },
    options?: { bypassPolicy?: boolean },
  ): Promise<{ invite: ApprovedGuestInvite; token: string }>
}

export interface ApproveGuestInviteRequestResult {
  request: GuestInviteRequestDto
  invite: ApprovedGuestInvite
  /** Plaintext guest token — surfaced exactly once, for the ROUTER's invite email. */
  token: string
}

// ── audit writer ──────────────────────────────────────────────────────────────

export interface SecurityAuditEntry {
  workspaceId: string
  /** Null = system action. */
  actorId: string | null
  action: SecurityAuditAction
  targetUserId?: string
  targetEmail?: string
  metadata?: Prisma.InputJsonValue
}
