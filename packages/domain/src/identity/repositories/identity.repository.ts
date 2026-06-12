import type { Prisma, RoleType } from '@repo/db'

import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type {
  AuthProviderStatus,
  AuthProviderType,
  DomainVerificationStatus,
  IdentityAuditEntry,
} from '../dto/identity.dto.ts'

export interface AllowedDomainRow {
  id: string
  workspaceId: string
  domain: string
  addedById: string
  createdAt: Date
}

/**
 * Full `WorkspaceAuthProvider` row INCLUDING the opaque encrypted secret —
 * internal to the identity module; the service maps it to the secret-free
 * `AuthProviderDto` before anything leaves the domain.
 */
export interface AuthProviderRow {
  id: string
  workspaceId: string
  type: AuthProviderType
  name: string
  status: AuthProviderStatus
  domainId: string | null
  issuerUrl: string | null
  clientId: string | null
  clientSecretEnc: unknown
  ssoProviderId: string | null
  createdById: string
  createdAt: Date
  updatedAt: Date
}

export interface IdentityLinkRow {
  id: string
  providerId: string
  userId: string
  externalSubject: string
  email: string | null
  linkedAt: Date
}

export interface VerifiedDomainRow {
  id: string
  workspaceId: string
  domain: string
  status: DomainVerificationStatus
  verificationToken: string
  tokenExpiresAt: Date
  verifiedAt: Date | null
  lastCheckedAt: Date | null
  lastCheckError: string | null
  addedById: string
  createdAt: Date
  updatedAt: Date
}

export class IdentityRepository {
  private readonly uow: UnitOfWork
  constructor(uow: UnitOfWork) {
    this.uow = uow
  }

  // ── audit ───────────────────────────────────────────────────────────────────

  /** Runs on `uow.client()` — inside `uow.transaction()` this is the active tx. */
  async writeAudit(entry: IdentityAuditEntry): Promise<void> {
    await this.uow.client().workspaceAuditLog.create({
      data: {
        workspaceId: entry.workspaceId,
        actorId: entry.actorId,
        action: entry.action,
        targetUserId: entry.targetUserId ?? null,
        targetEmail: entry.targetEmail ?? null,
        metadata: entry.metadata,
      },
    })
  }

  // ── blocks / members / seats (the joinViaLink-mirroring arm) ─────────────────

  async findBlock(workspaceId: string, userId: string): Promise<{ id: string } | null> {
    return this.uow.client().workspaceBlockedUser.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true },
    })
  }

  async findMembership(workspaceId: string, userId: string): Promise<{ role: RoleType } | null> {
    return this.uow.client().workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    })
  }

  async countMembers(workspaceId: string): Promise<number> {
    return this.uow.client().workspaceMember.count({ where: { workspaceId } })
  }

  /**
   * The operative seat capacity: `WorkspaceLimit.maxMembers` (included) +
   * `WorkspaceSeatAddon.paidSeats` (purchased, 8D spec §3) — the SAME source
   * the people module enforces, mirrored here because the identity module owns
   * its own seat read. No limit row ⇒ unlimited (null).
   *
   * // keep in sync with src/people/repositories/people.repository.ts
   * // findSeatCapacity — parity pinned by the identity-suite
   * // "findSeatCapacity parity" test.
   */
  async findSeatCapacity(workspaceId: string): Promise<{ capacity: number } | null> {
    const limit = await this.uow.client().workspaceLimit.findUnique({
      where: { workspaceId },
      select: {
        maxMembers: true,
        workspace: { select: { seatAddon: { select: { paidSeats: true } } } },
      },
    })
    if (!limit) return null
    return { capacity: limit.maxMembers + (limit.workspace.seatAddon?.paidSeats ?? 0) }
  }

  async createMember(workspaceId: string, userId: string, role: RoleType): Promise<void> {
    await this.uow.client().workspaceMember.create({ data: { workspaceId, userId, role } })
  }

  /**
   * Billable-seat ledger write (`SeatBillingEvent`, 8D) for the domain-join
   * member create — a direct prisma write into the billing-owned table (the
   * `WorkspaceAuditLog` cross-module precedent; people-module parity). Runs on
   * `uow.client()`, so inside `uow.transaction()` it lands in the SAME tx as
   * the member row. This module only creates members, hence MEMBER_JOINED only.
   */
  async recordMemberJoined(entry: {
    workspaceId: string
    targetUserId: string
    actorId: string
  }): Promise<void> {
    await this.uow.client().seatBillingEvent.create({
      data: {
        workspaceId: entry.workspaceId,
        type: 'MEMBER_JOINED',
        targetUserId: entry.targetUserId,
        actorId: entry.actorId,
      },
    })
  }

  // ── allowed domains ─────────────────────────────────────────────────────────

  async findAllowedDomain(workspaceId: string, domain: string): Promise<AllowedDomainRow | null> {
    return this.uow.client().allowedEmailDomain.findUnique({
      where: { workspaceId_domain: { workspaceId, domain } },
    })
  }

  async findAllowedDomainById(workspaceId: string, id: string): Promise<AllowedDomainRow | null> {
    return this.uow.client().allowedEmailDomain.findFirst({ where: { id, workspaceId } })
  }

  async createAllowedDomain(data: {
    workspaceId: string
    domain: string
    addedById: string
  }): Promise<AllowedDomainRow> {
    return this.uow.client().allowedEmailDomain.create({ data })
  }

  async deleteAllowedDomain(id: string): Promise<void> {
    await this.uow.client().allowedEmailDomain.delete({ where: { id } })
  }

  async listAllowedDomains(workspaceId: string): Promise<AllowedDomainRow[]> {
    return this.uow.client().allowedEmailDomain.findMany({
      where: { workspaceId },
      orderBy: { domain: 'asc' },
    })
  }

  /**
   * Workspaces whose AllowedEmailDomain matches the (already lowercased) email
   * domain, excluding ones where the user is a member or blocked — the
   * join-prompt lookup arm of the `@@index([domain])`. The seat-preview inputs
   * (member count + capacity = `WorkspaceLimit.maxMembers` + purchased
   * `seatAddon.paidSeats`, the `findSeatCapacity` formula) come back inline,
   * so the lookup stays ONE query however many workspaces match.
   * `capacity: null` ⇔ no limit row ⇔ unlimited.
   */
  async listJoinableWorkspacesByDomain(
    domain: string,
    userId: string,
  ): Promise<
    Array<{ workspaceId: string; name: string; memberCount: number; capacity: number | null }>
  > {
    const rows = await this.uow.client().allowedEmailDomain.findMany({
      where: {
        domain,
        workspace: {
          members: { none: { userId } },
          blockedUsers: { none: { userId } },
        },
      },
      select: {
        workspaceId: true,
        workspace: {
          select: {
            name: true,
            limits: { select: { maxMembers: true } },
            seatAddon: { select: { paidSeats: true } },
            _count: { select: { members: true } },
          },
        },
      },
      orderBy: { workspace: { name: 'asc' } },
    })
    return rows.map((r) => ({
      workspaceId: r.workspaceId,
      name: r.workspace.name,
      memberCount: r.workspace._count.members,
      capacity: r.workspace.limits
        ? r.workspace.limits.maxMembers + (r.workspace.seatAddon?.paidSeats ?? 0)
        : null,
    }))
  }

  // ── verified domains ────────────────────────────────────────────────────────

  async findVerifiedDomainByName(
    workspaceId: string,
    domain: string,
  ): Promise<VerifiedDomainRow | null> {
    return this.uow.client().verifiedEmailDomain.findUnique({
      where: { workspaceId_domain: { workspaceId, domain } },
    })
  }

  async findVerifiedDomainById(workspaceId: string, id: string): Promise<VerifiedDomainRow | null> {
    return this.uow.client().verifiedEmailDomain.findFirst({ where: { id, workspaceId } })
  }

  async createVerifiedDomain(data: {
    workspaceId: string
    domain: string
    verificationToken: string
    tokenExpiresAt: Date
    addedById: string
  }): Promise<VerifiedDomainRow> {
    return this.uow.client().verifiedEmailDomain.create({ data })
  }

  async updateVerifiedDomain(
    id: string,
    data: Partial<{
      status: DomainVerificationStatus
      verificationToken: string
      tokenExpiresAt: Date
      verifiedAt: Date | null
      lastCheckedAt: Date
      lastCheckError: string | null
    }>,
  ): Promise<VerifiedDomainRow> {
    return this.uow.client().verifiedEmailDomain.update({ where: { id }, data })
  }

  async deleteVerifiedDomain(id: string): Promise<void> {
    await this.uow.client().verifiedEmailDomain.delete({ where: { id } })
  }

  async listVerifiedDomains(workspaceId: string): Promise<VerifiedDomainRow[]> {
    return this.uow.client().verifiedEmailDomain.findMany({
      where: { workspaceId },
      orderBy: { domain: 'asc' },
    })
  }

  // ── auth providers ──────────────────────────────────────────────────────────

  async listActiveProvidersBoundToDomain(
    domainId: string,
  ): Promise<Array<{ id: string; name: string; ssoProviderId: string | null }>> {
    return this.uow.client().workspaceAuthProvider.findMany({
      where: { domainId, status: 'ACTIVE' },
      select: { id: true, name: true, ssoProviderId: true },
      orderBy: { createdAt: 'asc' },
    })
  }

  /** Disabling always drops the sso registration key — the plugin row is gone. */
  async disableProvider(id: string): Promise<AuthProviderRow> {
    return this.uow.client().workspaceAuthProvider.update({
      where: { id },
      data: { status: 'DISABLED', ssoProviderId: null },
    })
  }

  async findProviderById(workspaceId: string, id: string): Promise<AuthProviderRow | null> {
    return this.uow.client().workspaceAuthProvider.findFirst({ where: { id, workspaceId } })
  }

  /** Unscoped lookup — the SSO-callback consumer has no workspace context. */
  async findProviderByIdGlobal(id: string): Promise<AuthProviderRow | null> {
    return this.uow.client().workspaceAuthProvider.findUnique({ where: { id } })
  }

  async createProvider(data: {
    workspaceId: string
    type: AuthProviderType
    name: string
    issuerUrl: string | null
    clientId: string | null
    clientSecretEnc: unknown
    createdById: string
  }): Promise<AuthProviderRow> {
    return this.uow.client().workspaceAuthProvider.create({
      data: {
        workspaceId: data.workspaceId,
        type: data.type,
        name: data.name,
        status: 'DISABLED',
        issuerUrl: data.issuerUrl,
        clientId: data.clientId,
        // opaque Json payload produced by the router (or absent)
        clientSecretEnc: (data.clientSecretEnc ?? undefined) as Prisma.InputJsonValue | undefined,
        createdById: data.createdById,
      },
    })
  }

  async updateProvider(
    id: string,
    data: Partial<{
      name: string
      issuerUrl: string | null
      clientId: string | null
      clientSecretEnc: unknown
      status: AuthProviderStatus
      domainId: string | null
      ssoProviderId: string | null
    }>,
  ): Promise<AuthProviderRow> {
    const { clientSecretEnc, ...rest } = data
    return this.uow.client().workspaceAuthProvider.update({
      where: { id },
      data: {
        ...rest,
        ...('clientSecretEnc' in data
          ? { clientSecretEnc: clientSecretEnc as Prisma.InputJsonValue }
          : {}),
      },
    })
  }

  async deleteProvider(id: string): Promise<void> {
    await this.uow.client().workspaceAuthProvider.delete({ where: { id } })
  }

  async listProviders(workspaceId: string): Promise<AuthProviderRow[]> {
    return this.uow.client().workspaceAuthProvider.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    })
  }

  /**
   * The sign-in resolution arm: an ACTIVE, registered provider bound to a
   * VERIFIED domain row matching the (lowercased) email domain. Deterministic
   * pick (oldest first) when several workspaces verified the same domain.
   */
  async findActiveSsoProviderForDomain(domain: string): Promise<{ ssoProviderId: string } | null> {
    const row = await this.uow.client().workspaceAuthProvider.findFirst({
      where: {
        status: 'ACTIVE',
        ssoProviderId: { not: null },
        domain: { domain, status: 'VERIFIED' },
      },
      select: { ssoProviderId: true },
      orderBy: { createdAt: 'asc' },
    })
    return row?.ssoProviderId ? { ssoProviderId: row.ssoProviderId } : null
  }

  // ── external identity links ─────────────────────────────────────────────────

  async findIdentityLink(
    providerId: string,
    externalSubject: string,
  ): Promise<IdentityLinkRow | null> {
    return this.uow.client().externalIdentityLink.findUnique({
      where: { providerId_externalSubject: { providerId, externalSubject } },
    })
  }

  async createIdentityLink(data: {
    providerId: string
    userId: string
    externalSubject: string
    email: string | null
  }): Promise<IdentityLinkRow> {
    return this.uow.client().externalIdentityLink.create({ data })
  }

  async updateIdentityLink(
    id: string,
    data: { userId: string; email: string | null },
  ): Promise<IdentityLinkRow> {
    return this.uow.client().externalIdentityLink.update({ where: { id }, data })
  }
}
