import { Prisma } from '@repo/db'

import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import { excludeDatabaseRowPages } from '../../pages/index.ts'
import type {
  BrowseCursor,
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
  /** null = пользователь удалён. */
  requesterEmail: string | null
}

// ── admin content search (spec §3, Task 3) ────────────────────────────────────

export interface ContentSearchFilters {
  creatorId?: string
  createdFrom?: Date
  createdTo?: Date
}

/** A candidate page in result order — id plus the keyset key for the cursor. */
export interface ContentSearchCandidateRow {
  id: string
  updatedAt: Date
}

export interface ContentSearchPageRow {
  id: string
  title: string | null
  icon: string | null
  type: string
  content: unknown
  createdAt: Date
  updatedAt: Date
  collection: { id: string; title: string | null; kind: 'TEAM' | 'PERSONAL' | 'SITE' } | null
  createdBy: { id: string; name: string | null } | null
  updatedBy: { id: string; name: string | null } | null
  share: {
    access: 'RESTRICTED' | 'PUBLIC'
    mode: 'LINK' | 'SITE'
    publishedAt: Date | null
    unpublishedAt: Date | null
    grantUserIds: string[]
  } | null
}

export interface ContentSearchContext {
  /** UNORDERED — the service re-orders by the candidate id list. */
  pages: ContentSearchPageRow[]
  /** Grant-holder userIds that have a WorkspaceMember row (everyone else is a guest). */
  memberGrantUserIds: Set<string>
  /** Active (acceptedAt/revokedAt null) PageGuestInvite count per pageId. */
  activeInviteCounts: Map<string, number>
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

  /**
   * Sets ONLY the two ack fields. `configuredById` belongs to policy
   * configuration and is stamped on the lazy CREATE arm only — acknowledging
   * the search warning must not claim authorship of someone else's flags.
   *
   * `acknowledged` is true only when THIS call performed the first ack — the
   * service's exactly-one-audit guard. The conditional `updateMany` is the
   * concurrency guard (the markRequestDecided precedent): under READ COMMITTED
   * the losing transaction of a double-ack blocks on the row lock,
   * re-evaluates `adminContentSearchAcknowledgedAt IS NULL` against the
   * winner's committed row, matches nothing, and converges onto the winner's
   * timestamp/actor instead of overwriting them. A lazy-create race surfaces
   * as P2002, which the SERVICE converges by re-running the transaction.
   */
  async setSearchAcknowledged(
    workspaceId: string,
    actorId: string,
  ): Promise<{ policy: SecurityPolicyDto; acknowledged: boolean }> {
    const ack = {
      adminContentSearchAcknowledgedAt: new Date(),
      adminContentSearchAcknowledgedById: actorId,
    }
    const updated = await this.uow.client().workspaceSecurityPolicy.updateMany({
      where: { workspaceId, adminContentSearchAcknowledgedAt: null },
      data: ack,
    })
    if (updated.count === 1) {
      const policy = await this.uow.client().workspaceSecurityPolicy.findUniqueOrThrow({
        where: { workspaceId },
        select: policySelect,
      })
      return { policy, acknowledged: true }
    }
    const existing = await this.uow.client().workspaceSecurityPolicy.findUnique({
      where: { workspaceId },
      select: policySelect,
    })
    // Row present but unmatched ⇒ already acknowledged — the no-op success arm.
    if (existing) return { policy: existing, acknowledged: false }
    const policy = await this.uow.client().workspaceSecurityPolicy.create({
      data: { workspaceId, configuredById: actorId, ...ack },
      select: policySelect,
    })
    return { policy, acknowledged: true }
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
      requesterEmail: byId.get(row.requesterId)?.email ?? null, // null = пользователь удалён
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

  // ── admin content search (spec §3, Task 3) ──────────────────────────────────

  /**
   * The FTS arm of the owner-only admin search.
   *
   * Keep in sync with packages/trpc/src/services/page-search.ts (searchPg):
   * the same websearch_to_tsquery('russian') match and the same four
   * exclusions (deleted / archived / templates / database-row pages) — but
   * deliberately WITHOUT the buildPageVisibilityWhere post-filter (the whole
   * point of the audited owner search, spec §3.2), WITH optional creator /
   * created-at SQL filters, and WITH a deterministic (updated_at, id) tiebreak
   * after the rank.
   */
  async ftsSearchPages(
    workspaceId: string,
    query: string,
    filters: ContentSearchFilters,
    limit: number,
  ): Promise<ContentSearchCandidateRow[]> {
    const creator = filters.creatorId
      ? Prisma.sql`AND "created_by_id" = ${filters.creatorId}::uuid`
      : Prisma.empty
    const from = filters.createdFrom
      ? Prisma.sql`AND "created_at" >= ${filters.createdFrom}`
      : Prisma.empty
    const to = filters.createdTo
      ? Prisma.sql`AND "created_at" <= ${filters.createdTo}`
      : Prisma.empty
    return this.uow.client().$queryRaw<ContentSearchCandidateRow[]>`
      SELECT id, "updated_at" AS "updatedAt"
      FROM "pages"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "deleted_at" IS NULL
        AND "archived_at" IS NULL
        AND "is_template" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "pages" p2
          WHERE p2.id = "pages".parent_id AND p2.type = 'DATABASE'
        )
        AND "search_vector" @@ websearch_to_tsquery('russian', ${query})
        ${creator}
        ${from}
        ${to}
      ORDER BY ts_rank("search_vector", websearch_to_tsquery('russian', ${query})) DESC,
        "updated_at" DESC, id DESC
      LIMIT ${limit}
    `
  }

  /**
   * The browse arm (no query): workspace pages newest-edited first with the
   * SAME exclusions as the FTS arm, keyset-paged on (updatedAt DESC, id DESC).
   */
  async browsePages(
    workspaceId: string,
    filters: ContentSearchFilters,
    cursor: BrowseCursor | null,
    limit: number,
  ): Promise<ContentSearchCandidateRow[]> {
    return this.uow.client().page.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        archivedAt: null,
        isTemplate: null,
        ...(filters.creatorId ? { createdById: filters.creatorId } : {}),
        ...(filters.createdFrom || filters.createdTo
          ? {
              createdAt: {
                ...(filters.createdFrom ? { gte: filters.createdFrom } : {}),
                ...(filters.createdTo ? { lte: filters.createdTo } : {}),
              },
            }
          : {}),
        AND: [
          excludeDatabaseRowPages(),
          ...(cursor
            ? [
                {
                  OR: [
                    { updatedAt: { lt: cursor.updatedAt } },
                    { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: { id: true, updatedAt: true },
    })
  }

  /**
   * The per-row joins for a candidate window, batched — no N+1 (Task 3 step 4):
   * one findMany over the page ids (collection / createdBy / updatedBy / share
   * incl. grant userIds), one grants-with-membership query, one active-invites
   * query.
   */
  async loadContentSearchContext(
    workspaceId: string,
    pageIds: string[],
  ): Promise<ContentSearchContext> {
    if (pageIds.length === 0) {
      return { pages: [], memberGrantUserIds: new Set(), activeInviteCounts: new Map() }
    }
    const pages = await this.uow.client().page.findMany({
      where: { id: { in: pageIds } },
      select: {
        id: true,
        title: true,
        icon: true,
        type: true,
        content: true,
        createdAt: true,
        updatedAt: true,
        collection: { select: { id: true, title: true, kind: true } },
        createdBy: { select: { id: true, name: true } },
        updatedBy: { select: { id: true, name: true } },
        share: {
          select: {
            access: true,
            mode: true,
            publishedAt: true,
            unpublishedAt: true,
            users: { select: { userId: true } },
          },
        },
      },
    })

    const grantUserIds = [
      ...new Set(pages.flatMap((page) => page.share?.users.map((u) => u.userId) ?? [])),
    ]
    const members =
      grantUserIds.length > 0
        ? await this.uow.client().workspaceMember.findMany({
            where: { workspaceId, userId: { in: grantUserIds } },
            select: { userId: true },
          })
        : []

    const invites = await this.uow.client().pageGuestInvite.findMany({
      where: { pageId: { in: pageIds }, acceptedAt: null, revokedAt: null },
      select: { pageId: true },
    })
    const activeInviteCounts = new Map<string, number>()
    for (const invite of invites) {
      activeInviteCounts.set(invite.pageId, (activeInviteCounts.get(invite.pageId) ?? 0) + 1)
    }

    return {
      pages: pages.map(({ share, ...page }) => ({
        ...page,
        content: page.content as unknown,
        share: share
          ? {
              access: share.access,
              mode: share.mode,
              publishedAt: share.publishedAt,
              unpublishedAt: share.unpublishedAt,
              grantUserIds: share.users.map((u) => u.userId),
            }
          : null,
      })),
      memberGrantUserIds: new Set(members.map((m) => m.userId)),
      activeInviteCounts,
    }
  }
}
