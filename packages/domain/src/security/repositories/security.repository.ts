import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type {
  GuestRequestStatus,
  GuestShareRole,
  SecurityAuditEntry,
  SecurityPolicyDto,
  SecurityPolicyPatch,
} from '../dto/security.dto.ts'

const policySelect = {
  workspaceId: true,
  disableGuestInvites: true,
  allowGuestInviteRequests: true,
  disablePublicLinksSitesForms: true,
  disableExport: true,
  disableMoveDuplicateOutsideWorkspace: true,
  adminContentSearchAcknowledgedAt: true,
  adminContentSearchAcknowledgedById: true,
} as const

export interface GuestInviteRequestRow {
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

export interface GuestInviteRequestContextRow extends GuestInviteRequestRow {
  /** Null mirrors the nullable `Page.title` — the UI renders its own placeholder. */
  pageTitle: string | null
  requesterName: string | null
  requesterEmail: string
}

export class SecurityRepository {
  private readonly uow: UnitOfWork
  constructor(uow: UnitOfWork) {
    this.uow = uow
  }

  // ── audit ───────────────────────────────────────────────────────────────────

  /** Runs on `uow.client()` — inside `uow.transaction()` this is the active tx. */
  async writeAudit(entry: SecurityAuditEntry): Promise<void> {
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

  // ── policy ──────────────────────────────────────────────────────────────────

  async findPolicy(workspaceId: string): Promise<SecurityPolicyDto | null> {
    return this.uow.client().workspaceSecurityPolicy.findUnique({
      where: { workspaceId },
      select: policySelect,
    })
  }

  /** Lazy-create-or-patch — the row exists only after the first real change. */
  async upsertPolicy(
    workspaceId: string,
    patch: SecurityPolicyPatch,
    configuredById: string,
  ): Promise<SecurityPolicyDto> {
    return this.uow.client().workspaceSecurityPolicy.upsert({
      where: { workspaceId },
      create: { workspaceId, configuredById, ...patch },
      update: { configuredById, ...patch },
      select: policySelect,
    })
  }

  // ── pages / members (lookups the request flows need) ────────────────────────

  async findPage(
    pageId: string,
  ): Promise<{ id: string; workspaceId: string; deletedAt: Date | null } | null> {
    return this.uow.client().page.findUnique({
      where: { id: pageId },
      select: { id: true, workspaceId: true, deletedAt: true },
    })
  }

  /** Workspace OWNER member userIds — for the router's guest-request notification. */
  async listOwnerIds(workspaceId: string): Promise<string[]> {
    const owners = await this.uow.client().workspaceMember.findMany({
      where: { workspaceId, role: 'OWNER' },
      select: { userId: true },
    })
    return owners.map((m) => m.userId)
  }

  // ── guest invite requests ───────────────────────────────────────────────────

  async findPendingRequest(pageId: string, email: string): Promise<GuestInviteRequestRow | null> {
    return this.uow.client().pageGuestInviteRequest.findFirst({
      where: { pageId, email, status: 'PENDING' },
    })
  }

  async createRequest(data: {
    pageId: string
    workspaceId: string
    email: string
    role: GuestShareRole
    requesterId: string
  }): Promise<GuestInviteRequestRow> {
    return this.uow.client().pageGuestInviteRequest.create({ data })
  }

  /** Refresh-PENDING: role + `updatedAt` (via @updatedAt); the first requester stays. */
  async refreshRequest(id: string, data: { role: GuestShareRole }): Promise<GuestInviteRequestRow> {
    return this.uow.client().pageGuestInviteRequest.update({ where: { id }, data })
  }

  async findRequestById(workspaceId: string, id: string): Promise<GuestInviteRequestRow | null> {
    return this.uow.client().pageGuestInviteRequest.findFirst({ where: { id, workspaceId } })
  }

  /**
   * Atomically decide a PENDING request; returns the decided row, or null when
   * the guard lost. The conditional `updateMany` is the concurrency guard: the
   * losing transaction of a double-decide blocks on the row lock, re-evaluates
   * `status = PENDING` against the winner's committed row, and matches nothing
   * — no decided request is ever decided twice.
   */
  async markRequestDecided(
    id: string,
    status: Extract<GuestRequestStatus, 'APPROVED' | 'REJECTED'>,
    decidedById: string,
  ): Promise<GuestInviteRequestRow | null> {
    const result = await this.uow.client().pageGuestInviteRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status, decidedById, decidedAt: new Date() },
    })
    if (result.count !== 1) return null
    return this.uow.client().pageGuestInviteRequest.findUniqueOrThrow({ where: { id } })
  }

  /** All requests of the workspace with page + requester context (newest first; service orders PENDING first). */
  async listRequestsWithContext(workspaceId: string): Promise<GuestInviteRequestContextRow[]> {
    const rows = await this.uow.client().pageGuestInviteRequest.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      include: { page: { select: { title: true } } },
    })
    // No requester relation on the model — resolve the users in one batch.
    const requesterIds = [...new Set(rows.map((r) => r.requesterId))]
    const users = await this.uow.client().user.findMany({
      where: { id: { in: requesterIds } },
      select: { id: true, name: true, email: true },
    })
    const byId = new Map(users.map((u) => [u.id, u]))
    return rows.map(({ page, ...row }) => ({
      ...row,
      pageTitle: page.title,
      requesterName: byId.get(row.requesterId)?.name ?? null,
      requesterEmail: byId.get(row.requesterId)?.email ?? '',
    }))
  }

  async listRequestsByRequester(
    pageId: string,
    requesterId: string,
  ): Promise<GuestInviteRequestRow[]> {
    return this.uow.client().pageGuestInviteRequest.findMany({
      where: { pageId, requesterId },
      orderBy: { createdAt: 'desc' },
    })
  }
}
