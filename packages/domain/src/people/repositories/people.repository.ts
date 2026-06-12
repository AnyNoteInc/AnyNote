import { randomBytes } from 'node:crypto'

import type { RoleType } from '@repo/db'

import { ACTIVE_SUBSCRIPTION_STATUSES } from '../../billing/index.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { PageShareRole, PeopleAuditEntry } from '../dto/people.dto.ts'

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

/** Join-link state without token material — the hash never leaves the repository. */
export interface InviteLinkRow {
  id: string
  workspaceId: string
  role: RoleType
  enabled: boolean
  rotatedAt: Date | null
  createdAt: Date
}

const inviteLinkSelect = {
  id: true,
  workspaceId: true,
  role: true,
  enabled: true,
  rotatedAt: true,
  createdAt: true,
} as const

export interface GuestInviteRow {
  id: string
  pageId: string
  workspaceId: string
  email: string
  role: PageShareRole
  inviterId: string
  expiresAt: Date
  acceptedAt: Date | null
  acceptedById: string | null
  revokedAt: Date | null
  createdAt: Date
}

/** Same shape as the page-share router's `newShareId` — 64 hex chars, 256-bit entropy. */
function newShareId(): string {
  return randomBytes(32).toString('hex')
}

/**
 * The member-event slice of the billable-seat ledger this module writes (8D).
 * `MEMBER_JOINED` accompanies every member-row CREATE, `MEMBER_REMOVED` every
 * delete — informational rows: removal frees capacity, never money.
 */
export interface MemberSeatEventEntry {
  workspaceId: string
  type: 'MEMBER_JOINED' | 'MEMBER_REMOVED'
  targetUserId: string
  actorId: string
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

  /**
   * The operative seat capacity: `WorkspaceLimit.maxMembers` (included) +
   * `WorkspaceSeatAddon.paidSeats` (purchased, 8D spec §3) — one query via the
   * workspace join. Every join path (invite accept, link join, conversion,
   * the invite-time pre-check, the preview) inherits the addon through this
   * single read. No limit row ⇒ unlimited (null).
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
   * Billable-seat ledger write (`SeatBillingEvent`, 8D) — a direct prisma
   * write into the billing-owned table from the member-owning module (the
   * `WorkspaceAuditLog` cross-module precedent). Runs on `uow.client()`, so
   * inside `uow.transaction()` it lands in the SAME tx as the member row.
   */
  async recordMemberEvent(entry: MemberSeatEventEntry): Promise<void> {
    await this.uow.client().seatBillingEvent.create({
      data: {
        workspaceId: entry.workspaceId,
        type: entry.type,
        targetUserId: entry.targetUserId,
        actorId: entry.actorId,
      },
    })
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

  // ── invite link ─────────────────────────────────────────────────────────────

  async findInviteLink(workspaceId: string): Promise<InviteLinkRow | null> {
    return this.uow.client().workspaceInviteLink.findUnique({
      where: { workspaceId },
      select: inviteLinkSelect,
    })
  }

  async findInviteLinkByTokenHash(tokenHash: string): Promise<InviteLinkRow | null> {
    return this.uow.client().workspaceInviteLink.findUnique({
      where: { tokenHash },
      select: inviteLinkSelect,
    })
  }

  /** Create-or-enable: every enable lands a FRESH token (the old one dies with the upsert). */
  async enableInviteLink(
    workspaceId: string,
    data: { role: RoleType; tokenHash: string; createdById: string },
  ): Promise<InviteLinkRow> {
    return this.uow.client().workspaceInviteLink.upsert({
      where: { workspaceId },
      create: { workspaceId, ...data, enabled: true },
      update: { role: data.role, tokenHash: data.tokenHash, enabled: true },
      select: inviteLinkSelect,
    })
  }

  async disableInviteLink(workspaceId: string): Promise<InviteLinkRow> {
    return this.uow.client().workspaceInviteLink.update({
      where: { workspaceId },
      data: { enabled: false },
      select: inviteLinkSelect,
    })
  }

  async rotateInviteLinkToken(workspaceId: string, tokenHash: string): Promise<InviteLinkRow> {
    return this.uow.client().workspaceInviteLink.update({
      where: { workspaceId },
      data: { tokenHash, rotatedAt: new Date() },
      select: inviteLinkSelect,
    })
  }

  // ── pages & users (lookups the guest flows need) ────────────────────────────

  async findPage(
    pageId: string,
  ): Promise<{ id: string; workspaceId: string; deletedAt: Date | null } | null> {
    return this.uow.client().page.findUnique({
      where: { id: pageId },
      select: { id: true, workspaceId: true, deletedAt: true },
    })
  }

  async findUserById(
    userId: string,
  ): Promise<{ id: string; email: string; name: string | null } | null> {
    return this.uow.client().user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    })
  }

  /** The 8C security-policy flag gating guest invites; no row = invites allowed. */
  async findSecurityPolicy(workspaceId: string): Promise<{ disableGuestInvites: boolean } | null> {
    return this.uow.client().workspaceSecurityPolicy.findUnique({
      where: { workspaceId },
      select: { disableGuestInvites: true },
    })
  }

  // ── guest invites ───────────────────────────────────────────────────────────

  async findActiveGuestInvite(pageId: string, email: string): Promise<GuestInviteRow | null> {
    return this.uow.client().pageGuestInvite.findFirst({
      where: { pageId, email, acceptedAt: null, revokedAt: null },
    })
  }

  async createGuestInvite(data: {
    pageId: string
    workspaceId: string
    email: string
    role: PageShareRole
    tokenHash: string
    inviterId: string
    expiresAt: Date
  }): Promise<GuestInviteRow> {
    return this.uow.client().pageGuestInvite.create({ data })
  }

  async refreshGuestInvite(
    id: string,
    data: { tokenHash: string; expiresAt: Date; role: PageShareRole; inviterId: string },
  ): Promise<GuestInviteRow> {
    return this.uow.client().pageGuestInvite.update({ where: { id }, data })
  }

  async findGuestInviteById(workspaceId: string, id: string): Promise<GuestInviteRow | null> {
    return this.uow.client().pageGuestInvite.findFirst({ where: { id, workspaceId } })
  }

  async findGuestInviteByTokenHash(tokenHash: string): Promise<GuestInviteRow | null> {
    return this.uow.client().pageGuestInvite.findUnique({ where: { tokenHash } })
  }

  async markGuestInviteAccepted(id: string, acceptedById: string): Promise<void> {
    await this.uow.client().pageGuestInvite.update({
      where: { id },
      data: { acceptedAt: new Date(), acceptedById },
    })
  }

  async markGuestInviteRevoked(id: string, revokedById: string): Promise<void> {
    await this.uow.client().pageGuestInvite.update({
      where: { id },
      data: { revokedAt: new Date(), revokedById },
    })
  }

  async listOpenGuestInvites(workspaceId: string): Promise<GuestInviteRow[]> {
    return this.uow.client().pageGuestInvite.findMany({
      where: { workspaceId, acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    })
  }

  /** Revoke every open guest invite addressed to the email in this workspace; returns the count. */
  async revokeOpenGuestInvitesByEmail(
    workspaceId: string,
    email: string,
    revokedById: string,
  ): Promise<number> {
    const result = await this.uow.client().pageGuestInvite.updateMany({
      where: { workspaceId, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date(), revokedById },
    })
    return result.count
  }

  // ── page shares (the `ensureShare` + grant logic the trpc router uses) ───────

  /**
   * Lazily create-or-return the PageShare row, mirroring the page-share router's
   * `ensureShare` — as a single upsert on the unique `pageId` (not read-then-create),
   * so concurrent guest accepts can't race each other into a P2002.
   */
  async ensureShareForPage(pageId: string, createdById: string): Promise<{ id: string }> {
    return this.uow.client().pageShare.upsert({
      where: { pageId },
      create: { pageId, shareId: newShareId(), createdById },
      update: {},
      select: { id: true },
    })
  }

  async upsertShareGrant(pageShareId: string, userId: string, role: PageShareRole): Promise<void> {
    await this.uow.client().pageShareUser.upsert({
      where: { pageShareId_userId: { pageShareId, userId } },
      create: { pageShareId, userId, role },
      update: { role },
    })
  }

  /**
   * One row per grant held by a non-member on a live page of this workspace —
   * the service aggregates per user. Deleted pages don't count.
   */
  async listGuestGrants(
    workspaceId: string,
  ): Promise<Array<{ userId: string; name: string | null; email: string }>> {
    const grants = await this.uow.client().pageShareUser.findMany({
      where: {
        pageShare: { page: { workspaceId, deletedAt: null } },
        user: { workspaceMemberships: { none: { workspaceId } } },
      },
      select: { userId: true, user: { select: { name: true, email: true } } },
    })
    return grants.map((g) => ({ userId: g.userId, name: g.user.name, email: g.user.email }))
  }

  /** Delete every grant the user holds on this workspace's pages (deleted pages included). */
  async deleteGuestGrants(workspaceId: string, userId: string): Promise<number> {
    const result = await this.uow.client().pageShareUser.deleteMany({
      where: { userId, pageShare: { page: { workspaceId } } },
    })
    return result.count
  }

  // ── members (role matrix) ───────────────────────────────────────────────────

  async updateMemberRole(workspaceId: string, userId: string, role: RoleType): Promise<void> {
    await this.uow.client().workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId } },
      data: { role },
    })
  }

  async deleteMember(workspaceId: string, userId: string): Promise<void> {
    await this.uow.client().workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId } },
    })
  }

  async countOwners(workspaceId: string): Promise<number> {
    return this.uow.client().workspaceMember.count({ where: { workspaceId, role: 'OWNER' } })
  }

  // ── blocks (mutations) ──────────────────────────────────────────────────────

  async createBlock(
    workspaceId: string,
    userId: string,
    blockedById: string,
    reason?: string,
  ): Promise<void> {
    await this.uow.client().workspaceBlockedUser.create({
      data: { workspaceId, userId, blockedById, reason: reason ?? null },
    })
  }

  async deleteBlock(workspaceId: string, userId: string): Promise<number> {
    const result = await this.uow.client().workspaceBlockedUser.deleteMany({
      where: { workspaceId, userId },
    })
    return result.count
  }
}
