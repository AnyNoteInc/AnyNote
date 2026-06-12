import type { RoleType } from '@repo/db'

import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { DomainVerificationStatus, IdentityAuditEntry } from '../dto/identity.dto.ts'

export interface AllowedDomainRow {
  id: string
  workspaceId: string
  domain: string
  addedById: string
  createdAt: Date
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

  async findWorkspaceLimit(workspaceId: string): Promise<{ maxMembers: number } | null> {
    return this.uow.client().workspaceLimit.findUnique({
      where: { workspaceId },
      select: { maxMembers: true },
    })
  }

  async createMember(workspaceId: string, userId: string, role: RoleType): Promise<void> {
    await this.uow.client().workspaceMember.create({ data: { workspaceId, userId, role } })
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
   * join-prompt lookup arm of the `@@index([domain])`.
   */
  async listJoinableWorkspacesByDomain(
    domain: string,
    userId: string,
  ): Promise<Array<{ workspaceId: string; name: string }>> {
    const rows = await this.uow.client().allowedEmailDomain.findMany({
      where: {
        domain,
        workspace: {
          members: { none: { userId } },
          blockedUsers: { none: { userId } },
        },
      },
      select: { workspaceId: true, workspace: { select: { name: true } } },
      orderBy: { workspace: { name: 'asc' } },
    })
    return rows.map((r) => ({ workspaceId: r.workspaceId, name: r.workspace.name }))
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

  // ── auth providers (the domain-removal disable arm; lifecycle lives in Task 4) ─

  async listActiveProvidersBoundToDomain(
    domainId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.uow.client().workspaceAuthProvider.findMany({
      where: { domainId, status: 'ACTIVE' },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    })
  }

  async disableProvider(id: string): Promise<void> {
    await this.uow.client().workspaceAuthProvider.update({
      where: { id },
      data: { status: 'DISABLED' },
    })
  }
}
