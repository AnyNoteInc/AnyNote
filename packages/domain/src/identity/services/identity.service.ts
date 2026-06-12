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
  ActivateProviderInput,
  AddAllowedDomainInput,
  AllowedDomainDto,
  AuthProviderDto,
  CreateProviderInput,
  DomainJoinableWorkspace,
  ExternalIdentityLinkDto,
  IdentityAuditEntry,
  IdentitySsoPort,
  JoinViaDomainInput,
  JoinViaDomainResult,
  LinkExternalIdentityInput,
  ProviderActionInput,
  RemoveAllowedDomainInput,
  RemoveVerifiedDomainResult,
  RequestEnterpriseFeatureInput,
  RequestEnterpriseFeatureResult,
  ResolveTxtFn,
  SsoRegistrationData,
  StartDomainVerificationInput,
  UpdateProviderInput,
  VerifiedDomainActionInput,
  VerifiedDomainDto,
} from '../dto/identity.dto.ts'
import { generateVerificationToken } from '../verification-token.ts'
import type {
  AllowedDomainRow,
  AuthProviderRow,
  IdentityLinkRow,
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

/**
 * The single chokepoint where a provider row becomes externally visible —
 * `clientSecretEnc` is reduced to a presence flag here, so NO read shape of
 * the domain can ever carry the encrypted payload (spec §7 invariant 3).
 */
function toProviderDto(row: AuthProviderRow): AuthProviderDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    type: row.type,
    name: row.name,
    status: row.status,
    domainId: row.domainId,
    issuerUrl: row.issuerUrl,
    clientId: row.clientId,
    hasClientSecret: row.clientSecretEnc !== null && row.clientSecretEnc !== undefined,
    ssoProviderId: row.ssoProviderId,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toLinkDto(row: IdentityLinkRow): ExternalIdentityLinkDto {
  return {
    id: row.id,
    providerId: row.providerId,
    userId: row.userId,
    externalSubject: row.externalSubject,
    email: row.email,
    linkedAt: row.linkedAt,
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
    // The match is CASE-SENSITIVE by design (spec §6): the token is base62, so
    // case-folding would collide distinct tokens. Some DNS panels lowercase
    // TXT values on save — Task 7's TXT instructions card MUST tell the user
    // «скопируйте точно как показано».
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
   * Removes the verification row and disables every ACTIVE provider bound to
   * it — audited per provider plus the removal itself (spec §3 «audit both»).
   * The FK SetNull then detaches the disabled rows.
   *
   * Registered providers are deregistered from `@better-auth/sso` FIRST,
   * before the tx — the module-wide port-then-persist order (`disableProvider`
   * / `deleteProvider` / `activateProvider`): a port failure aborts with the
   * DB fully unchanged, and the tx that follows does ONLY DB writes — it never
   * runs port I/O inside an open transaction, so a tx crash can no longer
   * commit half a removal around an already-applied plugin-row delete (the
   * remaining crash window — unregister succeeded, tx lost — converges on
   * retry because `port.unregister` is delete-if-exists, see sso.md). Callers
   * MUST pass the port when a bound provider may hold a registration; the
   * guard below makes a missing port loud.
   */
  async removeVerifiedDomain(
    input: VerifiedDomainActionInput,
    port?: IdentitySsoPort,
  ): Promise<RemoveVerifiedDomainResult> {
    const row = await this.repo.findVerifiedDomainById(input.workspaceId, input.domainId)
    if (!row) throw identityError('DOMAIN_NOT_FOUND')

    // Port loop strictly BEFORE the tx (see the doc comment above): a failure
    // anywhere in it leaves every provider and the domain row untouched.
    const providers = await this.repo.listActiveProvidersBoundToDomain(row.id)
    for (const provider of providers) {
      if (!provider.ssoProviderId) continue
      if (!port) {
        throw new Error(
          'removeVerifiedDomain: a bound ACTIVE provider holds an sso registration — an IdentitySsoPort is required',
        )
      }
      await port.unregister(provider.ssoProviderId)
    }

    return this.uow.transaction(async () => {
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
   * a preview computed from the counts the single repository query returns
   * inline (same semantics as `isSeatAvailable`: no limit row ⇒ unlimited) —
   * the authoritative re-check runs inside `joinViaDomain`'s tx.
   */
  async listDomainJoinableWorkspaces(
    userId: string,
    userEmail: string,
  ): Promise<DomainJoinableWorkspace[]> {
    const domain = emailDomainOf(userEmail)
    if (!domain) return []
    const rows = await this.repo.listJoinableWorkspacesByDomain(domain, userId)
    return rows.map((row) => ({
      workspaceId: row.workspaceId,
      name: row.name,
      seatAvailable: row.maxMembers === null || row.memberCount < row.maxMembers,
    }))
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

  // ── auth providers (spec §3) ─────────────────────────────────────────────────

  /**
   * Providers are born DISABLED. OIDC/OAUTH require the full connection
   * (name, https issuer, client id, encrypted secret) up front so activation
   * never finds half a config; SAML_RESERVED honestly stores the NAME ONLY —
   * any connection fields are dropped, and activation is refused for good
   * (`FEATURE_RESERVED`, spec §7 invariant 6).
   */
  async createProvider(input: CreateProviderInput): Promise<AuthProviderDto> {
    const config = this.validateProviderConfig(input.type, input)
    return this.uow.transaction(async () => {
      const row = await this.repo.createProvider({
        workspaceId: input.workspaceId,
        type: input.type,
        name: config.name,
        issuerUrl: config.issuerUrl,
        clientId: config.clientId,
        clientSecretEnc: config.clientSecretEnc,
        createdById: input.actorId,
      })
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: IDENTITY_AUDIT_ACTIONS.providerCreated,
        metadata: { providerId: row.id, name: row.name, type: row.type },
      })
      return toProviderDto(row)
    })
  }

  /**
   * Partial update; an omitted `clientSecretEnc` keeps the stored secret
   * (write-only field semantics). The MERGED config is re-validated per type.
   * An ACTIVE registered provider syncs its plugin row through `port.update`
   * BEFORE persisting — a port failure aborts with state unchanged (lock-step,
   * sso.md).
   */
  async updateProvider(
    input: UpdateProviderInput,
    port: IdentitySsoPort,
  ): Promise<AuthProviderDto> {
    const row = await this.findProviderOrThrow(input.workspaceId, input.providerId)
    const secretRotated = input.clientSecretEnc !== undefined
    const config = this.validateProviderConfig(row.type, {
      name: input.name ?? row.name,
      issuerUrl: input.issuerUrl ?? row.issuerUrl ?? undefined,
      clientId: input.clientId ?? row.clientId ?? undefined,
      clientSecretEnc: secretRotated ? input.clientSecretEnc : (row.clientSecretEnc ?? undefined),
    })

    if (row.status === 'ACTIVE' && row.ssoProviderId) {
      await port.update(
        row.ssoProviderId,
        await this.ssoRegistrationData(row, config, row.domainId, input.actorId),
      )
    }

    return this.uow.transaction(async () => {
      const saved = await this.repo.updateProvider(row.id, {
        name: config.name,
        issuerUrl: config.issuerUrl,
        clientId: config.clientId,
        ...(secretRotated ? { clientSecretEnc: config.clientSecretEnc } : {}),
      })
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: IDENTITY_AUDIT_ACTIONS.providerUpdated,
        metadata: { providerId: row.id, name: saved.name, secretRotated },
      })
      return toProviderDto(saved)
    })
  }

  /**
   * The verified-domain gate (spec §7 invariant 2): `domainId` must point at a
   * VERIFIED `VerifiedEmailDomain` of the SAME workspace — missing, unverified,
   * and foreign rows all fail uniformly with `DOMAIN_NOT_VERIFIED`. On success
   * the sequence is validate → port.register (first activation) or port.update
   * (re-bind, keeps the registration id stable) → persist ACTIVE+ssoProviderId
   * → audit. The port call runs BEFORE the tx (it does discovery-fetch I/O); a
   * port failure leaves the provider untouched.
   */
  async activateProvider(
    input: ActivateProviderInput,
    port: IdentitySsoPort,
  ): Promise<AuthProviderDto> {
    const row = await this.findProviderOrThrow(input.workspaceId, input.providerId)
    if (row.type === 'SAML_RESERVED') throw identityError('FEATURE_RESERVED')
    const config = this.validateProviderConfig(row.type, {
      name: row.name,
      issuerUrl: row.issuerUrl ?? undefined,
      clientId: row.clientId ?? undefined,
      clientSecretEnc: row.clientSecretEnc ?? undefined,
    })
    const data = await this.ssoRegistrationData(row, config, input.domainId, input.actorId)

    let ssoProviderId = row.ssoProviderId
    if (ssoProviderId) await port.update(ssoProviderId, data)
    else ssoProviderId = (await port.register(data)).ssoProviderId

    return this.uow.transaction(async () => {
      const saved = await this.repo.updateProvider(row.id, {
        status: 'ACTIVE',
        domainId: input.domainId,
        ssoProviderId,
      })
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: IDENTITY_AUDIT_ACTIONS.providerActivated,
        metadata: { providerId: row.id, name: row.name, domain: data.domain },
      })
      return toProviderDto(saved)
    })
  }

  /**
   * Deregisters the plugin row first (port failure ⇒ throw, state unchanged),
   * then flips to DISABLED and clears `ssoProviderId`. Idempotent: an already
   * fully-disabled provider is a silent no-op (no port traffic, no audit).
   */
  async disableProvider(
    input: ProviderActionInput,
    port: IdentitySsoPort,
  ): Promise<AuthProviderDto> {
    const row = await this.findProviderOrThrow(input.workspaceId, input.providerId)
    if (row.status === 'DISABLED' && !row.ssoProviderId) return toProviderDto(row)

    if (row.ssoProviderId) await port.unregister(row.ssoProviderId)

    return this.uow.transaction(async () => {
      const saved = await this.repo.disableProvider(row.id)
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: IDENTITY_AUDIT_ACTIONS.providerDisabled,
        metadata: { providerId: row.id, name: row.name, reason: 'manual' },
      })
      return toProviderDto(saved)
    })
  }

  /**
   * Auto-unregister-then-delete in one flow: a live registration is removed
   * from the plugin first and a port failure aborts the deletion entirely
   * (spec §7 invariant 3 — provider deletion deregisters from better-auth).
   * Identity links cascade with the row.
   */
  async deleteProvider(input: ProviderActionInput, port: IdentitySsoPort): Promise<{ id: string }> {
    const row = await this.findProviderOrThrow(input.workspaceId, input.providerId)

    if (row.ssoProviderId) await port.unregister(row.ssoProviderId)

    await this.uow.transaction(async () => {
      await this.repo.deleteProvider(row.id)
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: IDENTITY_AUDIT_ACTIONS.providerDeleted,
        metadata: { providerId: row.id, name: row.name, type: row.type },
      })
    })
    return { id: row.id }
  }

  async listProviders(workspaceId: string): Promise<AuthProviderDto[]> {
    const rows = await this.repo.listProviders(workspaceId)
    return rows.map(toProviderDto)
  }

  async getProvider(workspaceId: string, providerId: string): Promise<AuthProviderDto> {
    return toProviderDto(await this.findProviderOrThrow(workspaceId, providerId))
  }

  // ── SSO resolution (spec §3) ─────────────────────────────────────────────────

  /**
   * Email domain → VERIFIED `VerifiedEmailDomain` → ACTIVE registered provider
   * ⇒ `{ssoProviderId}`. EVERY other case — malformed email, unknown domain,
   * unverified domain, disabled provider, missing registration — returns the
   * SAME `null` (spec §7 invariant 5: no oracle about which workspaces exist).
   */
  async resolveSsoProviderForEmail(email: string): Promise<{ ssoProviderId: string } | null> {
    const domain = emailDomainOf(email)
    if (!domain) return null
    return this.repo.findActiveSsoProviderForDomain(domain)
  }

  // ── enterprise requests (spec §3, honest — audit only) ──────────────────────

  /**
   * No fake connector: the request is an audit row plus a return payload the
   * ROUTER uses to notify the workspace owner (the domain emits nothing per
   * the architecture).
   */
  async requestEnterpriseFeature(
    input: RequestEnterpriseFeatureInput,
  ): Promise<RequestEnterpriseFeatureResult> {
    const requestedAt = new Date()
    await this.uow.transaction(async () => {
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: IDENTITY_AUDIT_ACTIONS.enterpriseRequested,
        metadata: { feature: input.feature },
      })
    })
    return {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      feature: input.feature,
      requestedAt,
    }
  }

  // ── external identity links (Task 6's SSO-callback consumer) ─────────────────

  /**
   * Upsert on (providerId, externalSubject). The FIRST link of a subject (or a
   * re-point to a different user) audits `sso.identity_linked`; re-linking the
   * same subject to the same user is a silent no-op — no duplicate audit.
   */
  async linkExternalIdentity(input: LinkExternalIdentityInput): Promise<ExternalIdentityLinkDto> {
    const provider = await this.repo.findProviderByIdGlobal(input.providerId)
    if (!provider) throw identityError('PROVIDER_NOT_FOUND')

    const existing = await this.repo.findIdentityLink(input.providerId, input.externalSubject)
    if (existing) return this.upsertExistingIdentityLink(provider, existing, input)

    try {
      return await this.uow.transaction(async () => {
        const saved = await this.repo.createIdentityLink({
          providerId: input.providerId,
          userId: input.userId,
          externalSubject: input.externalSubject,
          email: input.email ?? null,
        })
        await this.writeIdentityLinkedAudit(provider, input)
        return toLinkDto(saved)
      })
    } catch (e: unknown) {
      if ((e as { code?: string })?.code !== 'P2002') throw e
      // A concurrent link won the (providerId, externalSubject) unique race —
      // converge on the upsert path.
      const winner = await this.repo.findIdentityLink(input.providerId, input.externalSubject)
      if (!winner) throw e
      return this.upsertExistingIdentityLink(provider, winner, input)
    }
  }

  /** Same user ⇒ idempotent no-op; different user ⇒ re-point + fresh audit. */
  private async upsertExistingIdentityLink(
    provider: AuthProviderRow,
    existing: IdentityLinkRow,
    input: LinkExternalIdentityInput,
  ): Promise<ExternalIdentityLinkDto> {
    if (existing.userId === input.userId) return toLinkDto(existing)
    return this.uow.transaction(async () => {
      const saved = await this.repo.updateIdentityLink(existing.id, {
        userId: input.userId,
        email: input.email ?? null,
      })
      await this.writeIdentityLinkedAudit(provider, input)
      return toLinkDto(saved)
    })
  }

  private async writeIdentityLinkedAudit(
    provider: AuthProviderRow,
    input: LinkExternalIdentityInput,
  ): Promise<void> {
    await this.repo.writeAudit({
      workspaceId: provider.workspaceId,
      actorId: input.userId,
      action: IDENTITY_AUDIT_ACTIONS.identityLinked,
      targetUserId: input.userId,
      targetEmail: input.email,
      metadata: { providerId: provider.id, externalSubject: input.externalSubject },
    })
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private async findProviderOrThrow(
    workspaceId: string,
    providerId: string,
  ): Promise<AuthProviderRow> {
    const row = await this.repo.findProviderById(workspaceId, providerId)
    if (!row) throw identityError('PROVIDER_NOT_FOUND')
    return row
  }

  /**
   * Per-type config validation returning the normalized persistable shape.
   * OIDC/OAUTH: name + https issuer + client id + encrypted secret, all
   * required. SAML_RESERVED: name only — connection fields are DROPPED (the
   * type can never activate, storing half a config would only mislead).
   */
  private validateProviderConfig(
    type: CreateProviderInput['type'],
    raw: { name: string; issuerUrl?: string; clientId?: string; clientSecretEnc?: unknown },
  ): { name: string; issuerUrl: string | null; clientId: string | null; clientSecretEnc: unknown } {
    const name = raw.name.trim()
    if (name.length === 0 || name.length > 100) throw identityError('INVALID_PROVIDER_CONFIG')
    if (type === 'SAML_RESERVED') {
      return { name, issuerUrl: null, clientId: null, clientSecretEnc: null }
    }

    const issuerUrl = raw.issuerUrl?.trim() ?? ''
    let parsed: URL
    try {
      parsed = new URL(issuerUrl)
    } catch {
      throw identityError('INVALID_PROVIDER_CONFIG')
    }
    if (parsed.protocol !== 'https:' || issuerUrl.length > 500) {
      throw identityError('INVALID_PROVIDER_CONFIG')
    }
    const clientId = raw.clientId?.trim() ?? ''
    if (clientId.length === 0 || clientId.length > 255) {
      throw identityError('INVALID_PROVIDER_CONFIG')
    }
    if (raw.clientSecretEnc === undefined || raw.clientSecretEnc === null) {
      throw identityError('INVALID_PROVIDER_CONFIG')
    }
    return { name, issuerUrl, clientId, clientSecretEnc: raw.clientSecretEnc }
  }

  /**
   * Builds the secret-free payload for the SSO port. The domain binding is
   * re-resolved through the SAME gate as activation: a missing or unverified
   * row fails with `DOMAIN_NOT_VERIFIED` (uniformly — foreign-workspace rows
   * are invisible to the workspace-scoped lookup).
   */
  private async ssoRegistrationData(
    row: AuthProviderRow,
    config: { name: string; issuerUrl: string | null; clientId: string | null },
    domainId: string | null,
    actorId: string,
  ): Promise<SsoRegistrationData> {
    const domainRow = domainId
      ? await this.repo.findVerifiedDomainById(row.workspaceId, domainId)
      : null
    if (!domainRow || domainRow.status !== 'VERIFIED') throw identityError('DOMAIN_NOT_VERIFIED')
    return {
      providerId: row.id,
      workspaceId: row.workspaceId,
      name: config.name,
      // both are non-null after validateProviderConfig for activatable types
      issuerUrl: config.issuerUrl ?? '',
      clientId: config.clientId ?? '',
      domain: domainRow.domain,
      actorId,
    }
  }

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
