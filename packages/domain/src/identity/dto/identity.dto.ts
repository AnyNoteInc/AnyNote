import type { Prisma, RoleType } from '@repo/db'

import { DomainError } from '../../shared/errors.ts'

/**
 * Prisma's `DomainVerificationStatus` enum as a string union — the enum isn't
 * re-exported from the `@repo/db` barrel (the people-module `PageShareRole`
 * precedent). Assignable to/from the generated Prisma type.
 */
export type DomainVerificationStatus = 'PENDING' | 'VERIFIED' | 'EXPIRED'

// ── audit catalog (spec §2) ───────────────────────────────────────────────────

/**
 * `WorkspaceAuditLog.action` catalog for Phase 8B. Every identity mutation
 * writes exactly one row per audited event, in the same transaction. The spec
 * §2 catalog (15 actions) plus `domain.verified_removed` — verified-domain
 * removal is its own audited mutation (spec §3 «audit both») and must not
 * masquerade as an allowed-domain removal.
 */
export const IDENTITY_AUDIT_ACTIONS = {
  allowedAdded: 'domain.allowed_added',
  allowedRemoved: 'domain.allowed_removed',
  verificationStarted: 'domain.verification_started',
  tokenRotated: 'domain.verification_token_rotated',
  verified: 'domain.verified',
  verificationFailed: 'domain.verification_failed',
  verifiedRemoved: 'domain.verified_removed',
  joined: 'domain.joined',
  providerCreated: 'provider.created',
  providerUpdated: 'provider.updated',
  providerActivated: 'provider.activated',
  providerDisabled: 'provider.disabled',
  providerDeleted: 'provider.deleted',
  enterpriseRequested: 'provider.enterprise_requested',
  identityLinked: 'sso.identity_linked',
  jitJoined: 'sso.jit_joined',
} as const

export type IdentityAuditAction =
  (typeof IDENTITY_AUDIT_ACTIONS)[keyof typeof IDENTITY_AUDIT_ACTIONS]

// ── error codes (spec §3) ─────────────────────────────────────────────────────

export const IDENTITY_ERROR_CODES = {
  PUBLIC_EMAIL_DOMAIN: 'PUBLIC_EMAIL_DOMAIN',
  INVALID_DOMAIN: 'INVALID_DOMAIN',
  DOMAIN_NOT_FOUND: 'DOMAIN_NOT_FOUND',
  DOMAIN_NOT_VERIFIED: 'DOMAIN_NOT_VERIFIED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  ALREADY_MEMBER: 'ALREADY_MEMBER',
  SEAT_LIMIT_REACHED: 'SEAT_LIMIT_REACHED',
  USER_BLOCKED: 'USER_BLOCKED',
  FEATURE_RESERVED: 'FEATURE_RESERVED',
} as const

export type IdentityErrorCode = keyof typeof IDENTITY_ERROR_CODES

const IDENTITY_ERROR_DEFS: Record<IdentityErrorCode, { httpStatus: number; message: string }> = {
  PUBLIC_EMAIL_DOMAIN: {
    httpStatus: 400,
    message: 'Публичные почтовые домены нельзя использовать — укажите корпоративный домен',
  },
  INVALID_DOMAIN: { httpStatus: 400, message: 'Некорректный домен' },
  DOMAIN_NOT_FOUND: { httpStatus: 404, message: 'Домен не найден' },
  DOMAIN_NOT_VERIFIED: { httpStatus: 412, message: 'Сначала подтвердите домен' },
  TOKEN_EXPIRED: {
    httpStatus: 412,
    message: 'Срок действия токена подтверждения истёк — запустите проверку заново',
  },
  ALREADY_MEMBER: { httpStatus: 409, message: 'Пользователь уже является участником воркспейса' },
  SEAT_LIMIT_REACHED: {
    httpStatus: 403,
    message: 'Достигнут лимит участников воркспейса. Повысьте тариф или удалите участников.',
  },
  USER_BLOCKED: { httpStatus: 403, message: 'Доступ заблокирован администратором' },
  FEATURE_RESERVED: {
    httpStatus: 403,
    message: 'Функция готовится — оставьте заявку на ранний доступ',
  },
}

/** A `DomainError` whose `code` is the identity-error code itself (people-module pattern). */
export function identityError(code: IdentityErrorCode): DomainError {
  const def = IDENTITY_ERROR_DEFS[code]
  return new DomainError(code, def.message, def.httpStatus)
}

// ── domain normalization / validation (spec §3) ───────────────────────────────

/** Public email providers that can never be a workspace domain (spec §3, the 10 entries). */
export const PUBLIC_EMAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'yandex.ru',
  'mail.ru',
  'outlook.com',
  'yahoo.com',
  'icloud.com',
  'bk.ru',
  'list.ru',
  'inbox.ru',
  'rambler.ru',
]

/**
 * RFC-1035-shaped hostname: 1–253 chars, dot-separated labels of [a-z0-9-]
 * (no leading/trailing hyphen), at least two labels. Input must already be
 * normalized (lowercase, no `@`).
 */
const DOMAIN_NAME_REGEX =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/

/** Lowercase, trim, strip a leading `@` — domains are stored in this form. */
export function normalizeDomain(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase()
}

/** Validates an already-normalized domain (see `normalizeDomain`). */
export function isValidDomainName(domain: string): boolean {
  return DOMAIN_NAME_REGEX.test(domain)
}

/** The (lowercased) domain part of an email, or null when there is none. */
export function emailDomainOf(email: string): string | null {
  const at = email.lastIndexOf('@')
  if (at < 0) return null
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase()
  return domain.length > 0 ? domain : null
}

// ── verification (spec §3) ────────────────────────────────────────────────────

export const VERIFICATION_TOKEN_TTL_DAYS = 7

/** The TXT record the owner publishes is `anynote-verification=<token>`. */
export const VERIFICATION_TXT_PREFIX = 'anynote-verification='

/**
 * Injectable DNS TXT resolver (the `@repo/webhooks` LookupFn precedent) —
 * `node:dns/promises` `resolveTxt` shape: one chunk array per TXT record.
 */
export type ResolveTxtFn = (domain: string) => Promise<string[][]>

// ── allowed domains ───────────────────────────────────────────────────────────

export interface AllowedDomainDto {
  id: string
  workspaceId: string
  domain: string
  addedById: string
  createdAt: Date
}

export interface AddAllowedDomainInput {
  workspaceId: string
  actorId: string
  domain: string
}

export interface RemoveAllowedDomainInput {
  workspaceId: string
  actorId: string
  domainId: string
}

// ── verified domains ──────────────────────────────────────────────────────────

/** The verification token is NOT secret (it is published in public DNS) — the DTO carries it. */
export interface VerifiedDomainDto {
  id: string
  workspaceId: string
  domain: string
  status: DomainVerificationStatus
  verificationToken: string
  tokenExpiresAt: Date
  verifiedAt: Date | null
  lastCheckedAt: Date | null
  lastCheckError: string | null
  createdAt: Date
}

export interface StartDomainVerificationInput {
  workspaceId: string
  actorId: string
  domain: string
}

/** Rotate / check / remove address an existing verification row by id. */
export interface VerifiedDomainActionInput {
  workspaceId: string
  actorId: string
  domainId: string
}

export interface RemoveVerifiedDomainResult {
  id: string
  /** ACTIVE providers bound to the removed domain that were disabled in the same tx. */
  providersDisabled: number
}

// ── auto-join (spec §3) ───────────────────────────────────────────────────────

/** Domain joins always land a billable member seat with this role (cl8 hard rule). */
export const DOMAIN_JOIN_ROLE: RoleType = 'EDITOR'

export interface DomainJoinableWorkspace {
  workspaceId: string
  name: string
  seatAvailable: boolean
}

export interface JoinViaDomainInput {
  workspaceId: string
  userId: string
  /** The session email — the domain match is re-checked against it, case-insensitively. */
  userEmail: string
}

export interface JoinViaDomainResult {
  workspaceId: string
  role: RoleType
  /** True when the user already held a seat (double-join or joined via another path). */
  alreadyMember: boolean
}

// ── audit writer ──────────────────────────────────────────────────────────────

export interface IdentityAuditEntry {
  workspaceId: string
  /** Null = system action. */
  actorId: string | null
  action: IdentityAuditAction
  targetUserId?: string
  targetEmail?: string
  metadata?: Prisma.InputJsonValue
}
