import { resolveTxt as dnsResolveTxt } from 'node:dns/promises'

import { addDays } from 'date-fns'

import type { RoleType } from '@repo/db'

import type { CollectionService } from '../../collections/index.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import {
  DOMAIN_JOIN_ROLE,
  IDENTITY_AUDIT_ACTIONS,
  VERIFICATION_TOKEN_TTL_DAYS,
  VERIFICATION_TXT_PREFIX,
  PUBLIC_EMAIL_DOMAINS,
  emailDomainOf,
  identityError,
  isValidDomainName,
  normalizeDomain,
} from '../dto/identity.dto.ts'
import type {
  AddAllowedDomainInput,
  AllowedDomainDto,
  DomainJoinableWorkspace,
  IdentityAuditEntry,
  JoinViaDomainInput,
  JoinViaDomainResult,
  RemoveAllowedDomainInput,
  RemoveVerifiedDomainResult,
  ResolveTxtFn,
  StartDomainVerificationInput,
  VerifiedDomainActionInput,
  VerifiedDomainDto,
} from '../dto/identity.dto.ts'
import { generateVerificationToken } from '../verification-token.ts'
import type {
  AllowedDomainRow,
  IdentityRepository,
  VerifiedDomainRow,
} from '../repositories/identity.repository.ts'

const defaultResolveTxt: ResolveTxtFn = (domain) => dnsResolveTxt(domain)

const NO_TXT_MATCH_ERROR = 'Подтверждающая TXT-запись не найдена'
const TOKEN_EXPIRED_CHECK_ERROR = 'Срок действия токена подтверждения истёк'

/** `lastCheckError` is VarChar(255) — keep resolver errors inside the column. */
function truncateCheckError(e: unknown): string {
  const message = e instanceof Error ? e.message : 'DNS-запрос не выполнен'
  return message.slice(0, 255)
}

function toAllowedDto(row: AllowedDomainRow): AllowedDomainDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    domain: row.domain,
    addedById: row.addedById,
    createdAt: row.createdAt,
  }
}

function toVerifiedDto(row: VerifiedDomainRow): VerifiedDomainDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    domain: row.domain,
    status: row.status,
    verificationToken: row.verificationToken,
    tokenExpiresAt: row.tokenExpiresAt,
    verifiedAt: row.verifiedAt,
    lastCheckedAt: row.lastCheckedAt,
    lastCheckError: row.lastCheckError,
    createdAt: row.createdAt,
  }
}

export class IdentityService {
  private readonly repo: IdentityRepository
  private readonly uow: UnitOfWork
  private readonly collections: CollectionService
  private readonly resolveTxt: ResolveTxtFn

  constructor(
    repo: IdentityRepository,
    uow: UnitOfWork,
    collections: CollectionService,
    resolveTxt: ResolveTxtFn = defaultResolveTxt,
  ) {
    this.repo = repo
    this.uow = uow
    this.collections = collections
    this.resolveTxt = resolveTxt
  }

  // ── block helpers (the people-module chokepoint, mirrored) ──────────────────

  async isWorkspaceBlocked(workspaceId: string, userId: string): Promise<boolean> {
    return (await this.repo.findBlock(workspaceId, userId)) !== null
  }

  async assertNotBlocked(workspaceId: string, userId: string): Promise<void> {
    if (await this.isWorkspaceBlocked(workspaceId, userId)) throw identityError('USER_BLOCKED')
  }

  // ── audit ────────────────────────────────────────────────────────────────────

  /**
   * Writes one `WorkspaceAuditLog` row on the active client — when called inside
   * `uow.transaction()` (as every mutation below does) it lands in the same tx.
   */
  async writeAudit(entry: IdentityAuditEntry): Promise<void> {
    await this.repo.writeAudit(entry)
  }

  // ── allowed domains ──────────────────────────────────────────────────────────

  /** Idempotent: re-adding an existing domain returns the row without a second audit. */
  async addAllowedDomain(input: AddAllowedDomainInput): Promise<AllowedDomainDto> {
    const domain = this.normalizeDomainOrThrow(input.domain)
    const existing = await this.repo.findAllowedDomain(input.workspaceId, domain)
    if (existing) return toAllowedDto(existing)

    try {
      return await this.uow.transaction(async () => {
        const saved = await this.repo.createAllowedDomain({
          workspaceId: input.workspaceId,
          domain,
          addedById: input.actorId,
        })
        await this.repo.writeAudit({
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          action: IDENTITY_AUDIT_ACTIONS.allowedAdded,
          metadata: { domain },
        })
        return toAllowedDto(saved)
      })
    } catch (e: unknown) {
      if ((e as { code?: string })?.code !== 'P2002') throw e
      // A concurrent add won the (workspaceId, domain) unique race — converge
      // on the idempotent path.
      const winner = await this.repo.findAllowedDomain(input.workspaceId, domain)
      if (!winner) throw e
      return toAllowedDto(winner)
    }
  }

  async removeAllowedDomain(input: RemoveAllowedDomainInput): Promise<{ id: string }> {
    const row = await this.repo.findAllowedDomainById(input.workspaceId, input.domainId)
    if (!row) throw identityError('DOMAIN_NOT_FOUND')

    await this.uow.transaction(async () => {
      await this.repo.deleteAllowedDomain(row.id)
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: IDENTITY_AUDIT_ACTIONS.allowedRemoved,
        metadata: { domain: row.domain },
      })
    })
    return { id: row.id }
  }

  async listAllowedDomains(workspaceId: string): Promise<AllowedDomainDto[]> {
    const rows = await this.repo.listAllowedDomains(workspaceId)
    return rows.map(toAllowedDto)
  }

  // ── verification lifecycle ───────────────────────────────────────────────────

  /**
   * Create-or-restart: an existing PENDING/EXPIRED row gets a fresh token + TTL
   * and returns to PENDING; a VERIFIED domain is durable — returned unchanged.
   */
  async startDomainVerification(input: StartDomainVerificationInput): Promise<VerifiedDomainDto> {
    const domain = this.normalizeDomainOrThrow(input.domain)
    const token = generateVerificationToken()
    const tokenExpiresAt = addDays(new Date(), VERIFICATION_TOKEN_TTL_DAYS)

    return this.uow.transaction(async () => {
      const existing = await this.repo.findVerifiedDomainByName(input.workspaceId, domain)
      if (existing?.status === 'VERIFIED') return toVerifiedDto(existing)
      const saved = existing
        ? await this.repo.updateVerifiedDomain(existing.id, {
            status: 'PENDING',
            verificationToken: token,
            tokenExpiresAt,
            verifiedAt: null,
            lastCheckError: null,
          })
        : await this.repo.createVerifiedDomain({
            workspaceId: input.workspaceId,
            domain,
            verificationToken: token,
            tokenExpiresAt,
            addedById: input.actorId,
          })
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: IDENTITY_AUDIT_ACTIONS.verificationStarted,
        metadata: { domain, restarted: existing !== null },
      })
      return toVerifiedDto(saved)
    })
  }

  /** Fresh token + TTL for a PENDING/EXPIRED row; VERIFIED is durable (no-op). */
  async rotateVerificationToken(input: VerifiedDomainActionInput): Promise<VerifiedDomainDto> {
    const row = await this.repo.findVerifiedDomainById(input.workspaceId, input.domainId)
    if (!row) throw identityError('DOMAIN_NOT_FOUND')
    if (row.status === 'VERIFIED') return toVerifiedDto(row)

    const token = generateVerificationToken()
    return this.uow.transaction(async () => {
      const saved = await this.repo.updateVerifiedDomain(row.id, {
        status: 'PENDING',
        verificationToken: token,
        tokenExpiresAt: addDays(new Date(), VERIFICATION_TOKEN_TTL_DAYS),
        lastCheckError: null,
      })
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: IDENTITY_AUDIT_ACTIONS.tokenRotated,
        metadata: { domain: row.domain },
      })
      return toVerifiedDto(saved)
    })
  }

  /**
   * On-demand TXT check. Match ⇒ VERIFIED (+`domain.verified` audit); no match
   * or resolver error ⇒ stays PENDING with `lastCheckError`
   * (+`domain.verification_failed` audit); a token past its TTL ⇒ the row is
   * marked EXPIRED (audited) and TOKEN_EXPIRED is thrown — restart required.
   * VERIFIED is durable: re-checks return without touching DNS.
   */
  async checkDomainVerification(
    input: VerifiedDomainActionInput,
    resolveTxt: ResolveTxtFn = this.resolveTxt,
  ): Promise<VerifiedDomainDto> {
    const row = await this.repo.findVerifiedDomainById(input.workspaceId, input.domainId)
    if (!row) throw identityError('DOMAIN_NOT_FOUND')
    if (row.status === 'VERIFIED') return toVerifiedDto(row)

    const now = new Date()
    if (row.tokenExpiresAt <= now) {
      await this.uow.transaction(async () => {
        await this.repo.updateVerifiedDomain(row.id, {
          status: 'EXPIRED',
          lastCheckedAt: now,
          lastCheckError: TOKEN_EXPIRED_CHECK_ERROR,
        })
        await this.repo.writeAudit({
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          action: IDENTITY_AUDIT_ACTIONS.verificationFailed,
          metadata: { domain: row.domain, reason: 'TOKEN_EXPIRED' },
        })
      })
      throw identityError('TOKEN_EXPIRED')
    }

    let records: string[][] | null = null
    let resolveError: string | null = null
    try {
      records = await resolveTxt(row.domain)
    } catch (e: unknown) {
      resolveError = truncateCheckError(e)
    }
    // node's resolveTxt returns each TXT record as a chunk array — join before matching.
    const expected = `${VERIFICATION_TXT_PREFIX}${row.verificationToken}`
    const matched = records?.some((chunks) => chunks.join('').trim() === expected) ?? false

    if (matched) {
      const saved = await this.uow.transaction(async () => {
        const updated = await this.repo.updateVerifiedDomain(row.id, {
          status: 'VERIFIED',
          verifiedAt: now,
          lastCheckedAt: now,
          lastCheckError: null,
        })
        await this.repo.writeAudit({
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          action: IDENTITY_AUDIT_ACTIONS.verified,
          metadata: { domain: row.domain },
        })
        return updated
      })
      return toVerifiedDto(saved)
    }

    const lastCheckError = resolveError ?? NO_TXT_MATCH_ERROR
    const saved = await this.uow.transaction(async () => {
      const updated = await this.repo.updateVerifiedDomain(row.id, {
        lastCheckedAt: now,
        lastCheckError,
      })
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: IDENTITY_AUDIT_ACTIONS.verificationFailed,
        metadata: { domain: row.domain, error: lastCheckError },
      })
      return updated
    })
    return toVerifiedDto(saved)
  }

  /**
   * Removes the verification row and, in the SAME tx, disables every ACTIVE
   * provider bound to it — audited per provider plus the removal itself
   * (spec §3 «audit both»). The FK SetNull then detaches the disabled rows.
   */
  async removeVerifiedDomain(
    input: VerifiedDomainActionInput,
  ): Promise<RemoveVerifiedDomainResult> {
    const row = await this.repo.findVerifiedDomainById(input.workspaceId, input.domainId)
    if (!row) throw identityError('DOMAIN_NOT_FOUND')

    return this.uow.transaction(async () => {
      const providers = await this.repo.listActiveProvidersBoundToDomain(row.id)
      for (const provider of providers) {
        await this.repo.disableProvider(provider.id)
        await this.repo.writeAudit({
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          action: IDENTITY_AUDIT_ACTIONS.providerDisabled,
          metadata: {
            providerId: provider.id,
            name: provider.name,
            reason: 'domain_removed',
            domain: row.domain,
          },
        })
      }
      await this.repo.deleteVerifiedDomain(row.id)
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: IDENTITY_AUDIT_ACTIONS.verifiedRemoved,
        metadata: { domain: row.domain, providersDisabled: providers.length },
      })
      return { id: row.id, providersDisabled: providers.length }
    })
  }

  async listVerifiedDomains(workspaceId: string): Promise<VerifiedDomainDto[]> {
    const rows = await this.repo.listVerifiedDomains(workspaceId)
    return rows.map(toVerifiedDto)
  }

  // ── auto-join ────────────────────────────────────────────────────────────────

  /**
   * Workspaces with an AllowedEmailDomain matching the user's email domain,
   * excluding ones where the user is a member or blocked. Seat availability is
   * a preview — the authoritative re-check runs inside `joinViaDomain`'s tx.
   */
  async listDomainJoinableWorkspaces(
    userId: string,
    userEmail: string,
  ): Promise<DomainJoinableWorkspace[]> {
    const domain = emailDomainOf(userEmail)
    if (!domain) return []
    const rows = await this.repo.listJoinableWorkspacesByDomain(domain, userId)
    const result: DomainJoinableWorkspace[] = []
    for (const row of rows) {
      result.push({
        workspaceId: row.workspaceId,
        name: row.name,
        seatAvailable: await this.isSeatAvailable(row.workspaceId),
      })
    }
    return result
  }

  /** Mirrors `joinViaLink`: explicit join only, member seat (never guest), audited. */
  async joinViaDomain(input: JoinViaDomainInput): Promise<JoinViaDomainResult> {
    // Domain-match re-check — no allowed domain ⇒ uniformly DOMAIN_NOT_FOUND
    // (no oracle about whether the workspace exists or lists other domains).
    const domain = emailDomainOf(input.userEmail)
    const match = domain ? await this.repo.findAllowedDomain(input.workspaceId, domain) : null
    if (!match || !domain) throw identityError('DOMAIN_NOT_FOUND')
    await this.assertNotBlocked(input.workspaceId, input.userId)

    const existing = await this.repo.findMembership(input.workspaceId, input.userId)
    if (existing) {
      return this.joinViaDomainAlreadyMember(input.workspaceId, input.userId, existing.role, domain)
    }

    try {
      await this.uow.transaction(async () => {
        // Authoritative seat re-check inside the tx — narrows (does not
        // eliminate) the count-then-insert TOCTOU under READ COMMITTED.
        await this.assertSeatAvailable(input.workspaceId)
        await this.repo.createMember(input.workspaceId, input.userId, DOMAIN_JOIN_ROLE)
        await this.collections.ensurePersonalCollection(input.workspaceId, input.userId)
        await this.repo.writeAudit({
          workspaceId: input.workspaceId,
          actorId: input.userId,
          action: IDENTITY_AUDIT_ACTIONS.joined,
          targetUserId: input.userId,
          metadata: { domain, role: DOMAIN_JOIN_ROLE },
        })
      })
    } catch (e: unknown) {
      if ((e as { code?: string })?.code !== 'P2002') throw e
      // A concurrent join won the workspace_members unique race after our
      // membership pre-check — converge on the alreadyMember path.
      const member = await this.repo.findMembership(input.workspaceId, input.userId)
      if (!member) throw e
      return this.joinViaDomainAlreadyMember(input.workspaceId, input.userId, member.role, domain)
    }
    return { workspaceId: input.workspaceId, role: DOMAIN_JOIN_ROLE, alreadyMember: false }
  }

  /** Audit parity with `joinViaLink`: the alreadyMember no-op still leaves a trace. */
  private async joinViaDomainAlreadyMember(
    workspaceId: string,
    userId: string,
    role: RoleType,
    domain: string,
  ): Promise<JoinViaDomainResult> {
    await this.uow.transaction(async () => {
      await this.repo.writeAudit({
        workspaceId,
        actorId: userId,
        action: IDENTITY_AUDIT_ACTIONS.joined,
        targetUserId: userId,
        metadata: { domain, alreadyMember: true },
      })
    })
    return { workspaceId, role, alreadyMember: true }
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private normalizeDomainOrThrow(raw: string): string {
    const domain = normalizeDomain(raw)
    if (!isValidDomainName(domain)) throw identityError('INVALID_DOMAIN')
    if (PUBLIC_EMAIL_DOMAINS.includes(domain)) throw identityError('PUBLIC_EMAIL_DOMAIN')
    return domain
  }

  /**
   * Same semantics as the people module: no limit row ⇒ unlimited. Reads run
   * sequentially so the check is safe on the single connection of an
   * interactive transaction — `joinViaDomain` calls this inside
   * `uow.transaction()` as its authoritative re-check.
   */
  private async isSeatAvailable(workspaceId: string): Promise<boolean> {
    const limit = await this.repo.findWorkspaceLimit(workspaceId)
    if (!limit) return true
    const memberCount = await this.repo.countMembers(workspaceId)
    return memberCount < limit.maxMembers
  }

  private async assertSeatAvailable(workspaceId: string): Promise<void> {
    if (!(await this.isSeatAvailable(workspaceId))) throw identityError('SEAT_LIMIT_REACHED')
  }
}
