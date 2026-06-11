import type { RoleType } from '@repo/db'

import { ACTIVE_SUBSCRIPTION_STATUSES } from '../../billing/index.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { PeopleAuditEntry } from '../dto/people.dto.ts'

/** The invitation fields the service works with (prisma rows carry a superset). */
export interface InvitationRow {
  id: string
  workspaceId: string
  email: string
  role: RoleType
  inviterId: string
  expiresAt: Date
  acceptedAt: Date | null
  acceptedById: string | null
  revokedAt: Date | null
  createdAt: Date
}

export class PeopleRepository {
  private readonly uow: UnitOfWork
  constructor(uow: UnitOfWork) {
    this.uow = uow
  }

  // ── blocks ──────────────────────────────────────────────────────────────────

  async findBlock(workspaceId: string, userId: string): Promise<{ id: string } | null> {
    return this.uow.client().workspaceBlockedUser.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true },
    })
  }

  // ── audit ───────────────────────────────────────────────────────────────────

  /** Runs on `uow.client()` — inside `uow.transaction()` this is the active tx. */
  async writeAudit(entry: PeopleAuditEntry): Promise<void> {
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

  // ── members & seats ─────────────────────────────────────────────────────────

  async findMembership(workspaceId: string, userId: string): Promise<{ role: RoleType } | null> {
    return this.uow.client().workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    })
  }

  async findMemberByEmail(workspaceId: string, email: string): Promise<{ userId: string } | null> {
    return this.uow.client().workspaceMember.findFirst({
      where: { workspaceId, user: { email: { equals: email, mode: 'insensitive' } } },
      select: { userId: true },
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

  /** `currentPeriodEnd` of the workspace owner's latest active subscription, for the invite preview. */
  async findOwnerPeriodEnd(workspaceId: string): Promise<Date | null> {
    const workspace = await this.uow.client().workspace.findUnique({
      where: { id: workspaceId },
      select: { createdById: true },
    })
    if (!workspace?.createdById) return null
    const subscription = await this.uow.client().subscription.findFirst({
      where: { userId: workspace.createdById, status: { in: ACTIVE_SUBSCRIPTION_STATUSES } },
      orderBy: { createdAt: 'desc' },
      select: { currentPeriodEnd: true },
    })
    return subscription?.currentPeriodEnd ?? null
  }

  // ── invitations ─────────────────────────────────────────────────────────────

  async findActiveInvitation(workspaceId: string, email: string): Promise<InvitationRow | null> {
    return this.uow.client().workspaceInvitation.findFirst({
      where: { workspaceId, email, acceptedAt: null, revokedAt: null },
    })
  }

  async createInvitation(data: {
    workspaceId: string
    email: string
    role: RoleType
    tokenHash: string
    inviterId: string
    expiresAt: Date
  }): Promise<InvitationRow> {
    return this.uow.client().workspaceInvitation.create({ data })
  }

  async refreshInvitation(
    id: string,
    data: { tokenHash: string; expiresAt: Date; role: RoleType; inviterId: string },
  ): Promise<InvitationRow> {
    return this.uow.client().workspaceInvitation.update({ where: { id }, data })
  }

  async findInvitationById(workspaceId: string, id: string): Promise<InvitationRow | null> {
    return this.uow.client().workspaceInvitation.findFirst({ where: { id, workspaceId } })
  }

  async findInvitationByTokenHash(tokenHash: string): Promise<InvitationRow | null> {
    return this.uow.client().workspaceInvitation.findUnique({ where: { tokenHash } })
  }

  async markInvitationAccepted(id: string, acceptedById: string): Promise<void> {
    await this.uow.client().workspaceInvitation.update({
      where: { id },
      data: { acceptedAt: new Date(), acceptedById },
    })
  }

  async markInvitationRevoked(id: string, revokedById: string): Promise<void> {
    await this.uow.client().workspaceInvitation.update({
      where: { id },
      data: { revokedAt: new Date(), revokedById },
    })
  }

  async listOpenInvitations(workspaceId: string): Promise<InvitationRow[]> {
    return this.uow.client().workspaceInvitation.findMany({
      where: { workspaceId, acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    })
  }
}
