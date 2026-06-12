import { notFound } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import {
  CONTENT_SEARCH_DEFAULT_PAGE_SIZE,
  CONTENT_SEARCH_MAX_PAGE_SIZE,
  CONTENT_SEARCH_MAX_QUERY_LENGTH,
  CONTENT_SEARCH_MIN_QUERY_LENGTH,
  SECURITY_AUDIT_ACTIONS,
  SECURITY_POLICY_FLAGS,
  canRequestGuestInvite,
  decodeBrowseCursor,
  encodeBrowseCursor,
  findFirstMatchingContentBlock,
  isCrossWorkspaceCopyDisabled,
  isExportDisabled,
  isGuestInviteDisabled,
  isPublicSharingDisabled,
  securityError,
  zeroSecurityPolicy,
} from '../dto/security.dto.ts'
import type {
  AcknowledgeContentSearchInput,
  AdminContentSearchInput,
  AdminContentSearchResult,
  AdminContentSearchRow,
  ApproveGuestInviteRequestResult,
  ContentSearchAudience,
  ContentSearchMode,
  CreateGuestInviteRequestInput,
  CreateGuestInviteRequestResult,
  DecideGuestInviteRequestInput,
  GuestInviteRequestDto,
  GuestInviteRequestListItem,
  SecurityGuestInviteCreator,
  SecurityPolicyDto,
  SecurityPolicyPatch,
  UpdateSecurityPolicyInput,
} from '../dto/security.dto.ts'
import type {
  ContentSearchContext,
  ContentSearchPageRow,
  GuestInviteRequestRow,
  SecurityRepository,
} from '../repositories/security.repository.ts'

/** Requests store emails lowercased (the invite precedent) — comparisons stay case-insensitive. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Mirrors page-search's normalizeQuery (keep in sync with
 * packages/trpc/src/services/page-search.ts): trim, cap at 200 chars, and
 * treat anything shorter than 2 chars as "no query" — which here means browse
 * mode rather than an empty result.
 */
function normalizeSearchQuery(raw: string | undefined): string | null {
  if (!raw) return null
  const query = raw.trim().slice(0, CONTENT_SEARCH_MAX_QUERY_LENGTH)
  return query.length < CONTENT_SEARCH_MIN_QUERY_LENGTH ? null : query
}

function toRequestDto(row: GuestInviteRequestRow): GuestInviteRequestDto {
  return {
    id: row.id,
    pageId: row.pageId,
    workspaceId: row.workspaceId,
    email: row.email,
    role: row.role,
    requesterId: row.requesterId,
    status: row.status,
    decidedById: row.decidedById,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export class SecurityService {
  private readonly repo: SecurityRepository
  private readonly uow: UnitOfWork
  private readonly people: SecurityGuestInviteCreator

  constructor(repo: SecurityRepository, uow: UnitOfWork, people: SecurityGuestInviteCreator) {
    this.repo = repo
    this.uow = uow
    this.people = people
  }

  // ── policy ──────────────────────────────────────────────────────────────────

  /** Zero-value default when no row exists (spec §2) — absence is never an error. */
  async getPolicy(workspaceId: string): Promise<SecurityPolicyDto> {
    return (await this.repo.findPolicy(workspaceId)) ?? zeroSecurityPolicy(workspaceId)
  }

  /**
   * Lazy-create + partial patch. Audits `security.policy_changed` with the
   * exact changed-flags diff `{changed: {flag: [old, new]}}` in the same tx.
   * A no-op patch changes nothing: no row is created, no audit is written.
   */
  async updatePolicy(input: UpdateSecurityPolicyInput): Promise<SecurityPolicyDto> {
    const current = await this.getPolicy(input.workspaceId)
    const changed: Partial<Record<string, [boolean, boolean]>> = {}
    const patch: SecurityPolicyPatch = {}
    for (const flag of SECURITY_POLICY_FLAGS) {
      const next = input.patch[flag]
      if (next === undefined || next === current[flag]) continue
      changed[flag] = [current[flag], next]
      patch[flag] = next
    }
    if (Object.keys(changed).length === 0) return current

    return this.uow.transaction(async () => {
      const row = await this.repo.upsertPolicy(input.workspaceId, patch, input.actorId)
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: SECURITY_AUDIT_ACTIONS.policyChanged,
        metadata: { changed },
      })
      return row
    })
  }

  // ── enforcement assert helpers (spec §3/§4) ─────────────────────────────────
  // Each is one cheap policy read; callers (tRPC procedures, routes, services)
  // invoke them at the chokepoints. Honest errors that name the policy.

  async assertGuestInvitesAllowed(workspaceId: string): Promise<void> {
    if (isGuestInviteDisabled(await this.getPolicy(workspaceId))) {
      throw securityError('POLICY_GUEST_INVITES_DISABLED')
    }
  }

  async assertPublicSharingAllowed(workspaceId: string): Promise<void> {
    if (isPublicSharingDisabled(await this.getPolicy(workspaceId))) {
      throw securityError('POLICY_PUBLIC_SHARING_DISABLED')
    }
  }

  async assertExportAllowed(workspaceId: string): Promise<void> {
    if (isExportDisabled(await this.getPolicy(workspaceId))) {
      throw securityError('POLICY_EXPORT_DISABLED')
    }
  }

  async assertCrossWorkspaceCopyAllowed(workspaceId: string): Promise<void> {
    if (isCrossWorkspaceCopyDisabled(await this.getPolicy(workspaceId))) {
      throw securityError('POLICY_CROSS_WORKSPACE_DISABLED')
    }
  }

  // ── guest invite requests ───────────────────────────────────────────────────

  /**
   * Gate (spec §3): requests exist only in the gap the policy opens — invites
   * disabled AND requests allowed. Both other directions are
   * POLICY_REQUESTS_DISABLED; with invites ENABLED the message says so
   * honestly (invites are available directly, a request is pointless).
   * Edit access of the requester is the ROUTER's check.
   */
  async createGuestInviteRequest(
    input: CreateGuestInviteRequestInput,
  ): Promise<CreateGuestInviteRequestResult> {
    const email = normalizeEmail(input.email)
    const page = await this.repo.findPage(input.pageId)
    if (!page || page.deletedAt) throw notFound('Страница не найдена')

    const policy = await this.getPolicy(page.workspaceId)
    if (!canRequestGuestInvite(policy)) {
      throw isGuestInviteDisabled(policy)
        ? securityError('POLICY_REQUESTS_DISABLED')
        : securityError(
            'POLICY_REQUESTS_DISABLED',
            'Запрос не требуется — гостевые приглашения доступны напрямую',
          )
    }

    const run = () =>
      this.uow.transaction(async () => {
        // Refresh-PENDING (pinned): a repeat request for the same (page, email)
        // refreshes role + updatedAt but KEEPS the first requester — the queue
        // shows who originally asked. The partial unique index forbids a
        // duplicate PENDING row anyway.
        const pending = await this.repo.findPendingRequest(input.pageId, email)
        const saved = pending
          ? await this.repo.refreshRequest(pending.id, { role: input.role })
          : await this.repo.createRequest({
              pageId: input.pageId,
              workspaceId: page.workspaceId,
              email,
              role: input.role,
              requesterId: input.requesterId,
            })
        await this.repo.writeAudit({
          workspaceId: page.workspaceId,
          actorId: input.requesterId,
          action: SECURITY_AUDIT_ACTIONS.guestRequestCreated,
          targetEmail: email,
          metadata: {
            requestId: saved.id,
            pageId: input.pageId,
            role: input.role,
            refreshed: pending !== null,
          },
        })
        return saved
      })

    let saved: GuestInviteRequestRow
    try {
      saved = await run()
    } catch (e: unknown) {
      if ((e as { code?: string })?.code !== 'P2002') throw e
      // A concurrent request won the partial-unique race after our PENDING
      // pre-check; Postgres aborts the losing tx. One clean re-run converges
      // onto the winner's row via the refresh arm.
      saved = await run()
    }

    const ownerIds = await this.repo.listOwnerIds(page.workspaceId)
    return { request: toRequestDto(saved), ownerIds }
  }

  /**
   * The OWNER approval path — the ONLY sanctioned bypass of
   * `disableGuestInvites` (spec §7.4). One transaction: mark APPROVED, audit
   * `guest_request.approved`, then `people.createGuestInvite` with
   * `bypassPolicy: true` (its own `guest.invited` audit and token fire inside
   * the same tx via the ALS join). The plaintext token is returned so the
   * ROUTER can send the usual guest-invitation mail.
   */
  async approveGuestInviteRequest(
    input: DecideGuestInviteRequestInput,
  ): Promise<ApproveGuestInviteRequestResult> {
    const request = await this.repo.findRequestById(input.workspaceId, input.id)
    if (!request) throw securityError('REQUEST_NOT_FOUND')
    if (request.status !== 'PENDING') throw securityError('REQUEST_ALREADY_DECIDED')

    const run = () =>
      this.uow.transaction(async () => {
        const decided = await this.repo.markRequestDecided(request.id, 'APPROVED', input.actorId)
        if (!decided) throw securityError('REQUEST_ALREADY_DECIDED')
        await this.repo.writeAudit({
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          action: SECURITY_AUDIT_ACTIONS.guestRequestApproved,
          targetEmail: request.email,
          metadata: {
            requestId: request.id,
            pageId: request.pageId,
            role: request.role,
            requesterId: request.requesterId,
          },
        })
        const created = await this.people.createGuestInvite(
          {
            pageId: request.pageId,
            actorId: input.actorId,
            email: request.email,
            role: request.role,
          },
          { bypassPolicy: true },
        )
        return { decided, created }
      })

    let result: Awaited<ReturnType<typeof run>>
    try {
      result = await run()
    } catch (e: unknown) {
      if ((e as { code?: string })?.code !== 'P2002') throw e
      // A concurrent direct invite won the page_guest_invites partial-unique
      // race; our whole tx (incl. the APPROVED mark) rolled back. One clean
      // re-run converges: the invite arm now refreshes the winner's row. A
      // concurrent APPROVE loses at markRequestDecided instead (conflict).
      result = await run()
    }

    return {
      request: toRequestDto(result.decided),
      invite: result.created.invite,
      token: result.created.token,
    }
  }

  async rejectGuestInviteRequest(
    input: DecideGuestInviteRequestInput,
  ): Promise<GuestInviteRequestDto> {
    const request = await this.repo.findRequestById(input.workspaceId, input.id)
    if (!request) throw securityError('REQUEST_NOT_FOUND')
    if (request.status !== 'PENDING') throw securityError('REQUEST_ALREADY_DECIDED')

    return this.uow.transaction(async () => {
      const decided = await this.repo.markRequestDecided(request.id, 'REJECTED', input.actorId)
      if (!decided) throw securityError('REQUEST_ALREADY_DECIDED')
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: SECURITY_AUDIT_ACTIONS.guestRequestRejected,
        targetEmail: request.email,
        metadata: {
          requestId: request.id,
          pageId: request.pageId,
          role: request.role,
          requesterId: request.requesterId,
        },
      })
      return toRequestDto(decided)
    })
  }

  /** The settings queue: PENDING first, newest first within a status group. */
  async listGuestInviteRequests(workspaceId: string): Promise<GuestInviteRequestListItem[]> {
    const rows = await this.repo.listRequestsWithContext(workspaceId)
    // Stable sort over the createdAt-desc rows keeps recency within each group.
    return rows.sort((a, b) => {
      if (a.status === b.status) return 0
      if (a.status === 'PENDING') return -1
      return b.status === 'PENDING' ? 1 : 0
    })
  }

  /** Requester-facing state for the share dialog — own requests only, newest first. */
  async listMyRequestsForPage(
    pageId: string,
    requesterId: string,
  ): Promise<GuestInviteRequestDto[]> {
    const rows = await this.repo.listRequestsByRequester(pageId, requesterId)
    return rows.map(toRequestDto)
  }

  // ── admin content search (spec §3, Task 3) ──────────────────────────────────

  /**
   * The one-time privacy-warning acknowledgment (spec §3.1). PINNED: once
   * acknowledged STAYS acknowledged — a repeat call is a no-op success that
   * keeps the original timestamp/actor and writes NO second audit row.
   * Lazy-creates the policy row when absent; on an existing row only the two
   * ack fields move (flags and configuredById untouched).
   */
  async acknowledgeContentSearch(input: AcknowledgeContentSearchInput): Promise<SecurityPolicyDto> {
    return this.uow.transaction(async () => {
      const existing = await this.repo.findPolicy(input.workspaceId)
      if (existing?.adminContentSearchAcknowledgedAt) return existing
      const row = await this.repo.setSearchAcknowledged(input.workspaceId, input.actorId)
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: SECURITY_AUDIT_ACTIONS.searchAcknowledged,
      })
      return row
    })
  }

  /**
   * OWNER-only audited workspace-wide content search (spec §3.2-3.6; the
   * caller enforces the OWNER role). NO visibility filter — finding other
   * users' PERSONAL pages is the feature, which is why every call is gated on
   * the acknowledgment and writes a `content_search.performed` audit row with
   * the VERBATIM query. Result/cursor contract: see AdminContentSearchResult.
   */
  async adminContentSearch(input: AdminContentSearchInput): Promise<AdminContentSearchResult> {
    const policy = await this.getPolicy(input.workspaceId)
    if (!policy.adminContentSearchAcknowledgedAt) throw securityError('SEARCH_ACK_REQUIRED')

    const pageSize = Math.min(
      Math.max(input.pageSize ?? CONTENT_SEARCH_DEFAULT_PAGE_SIZE, 1),
      CONTENT_SEARCH_MAX_PAGE_SIZE,
    )
    const query = normalizeSearchQuery(input.query)
    const mode: ContentSearchMode = query ? 'fts' : 'browse'
    const filters = {
      creatorId: input.creatorId,
      createdFrom: input.createdFrom,
      createdTo: input.createdTo,
    }

    // Fetch pageSize+1 candidates to detect truncation without a COUNT query.
    let window: { id: string; updatedAt: Date }[]
    let hasMore: boolean
    let nextCursor: string | null = null
    if (query) {
      const raw = await this.repo.ftsSearchPages(input.workspaceId, query, filters, pageSize + 1)
      hasMore = raw.length > pageSize
      window = raw.slice(0, pageSize)
    } else {
      const cursor = input.cursor ? decodeBrowseCursor(input.cursor) : null
      const raw = await this.repo.browsePages(input.workspaceId, filters, cursor, pageSize + 1)
      hasMore = raw.length > pageSize
      window = raw.slice(0, pageSize)
      const last = window.at(-1)
      if (hasMore && last) nextCursor = encodeBrowseCursor(last)
    }

    const context = await this.repo.loadContentSearchContext(
      input.workspaceId,
      window.map((row) => row.id),
    )
    const pageById = new Map(context.pages.map((page) => [page.id, page]))
    const allRows: AdminContentSearchRow[] = []
    for (const candidate of window) {
      const page = pageById.get(candidate.id)
      if (!page) continue // deleted between the candidate query and the join batch
      allRows.push(toContentSearchRow(page, context, query))
    }
    // The audience filter runs post-computation over the scanned window (the
    // state needs the joins) — rows may undershoot pageSize; the cursor above
    // already advanced over the RAW window, so nothing is skipped.
    const rows = input.audience
      ? allRows.filter((row) => row.audienceState === input.audience)
      : allRows

    await this.repo.writeAudit({
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action: SECURITY_AUDIT_ACTIONS.contentSearchPerformed,
      metadata: {
        // The QUERY is audited VERBATIM — that is the point (spec §2).
        query: input.query ?? null,
        filters: {
          creatorId: input.creatorId ?? null,
          createdFrom: input.createdFrom?.toISOString() ?? null,
          createdTo: input.createdTo?.toISOString() ?? null,
          audience: input.audience ?? null,
        },
        resultCount: rows.length, // what the owner actually saw (post audience filter)
        mode,
      },
    })

    return { mode, rows, nextCursor, hasMore }
  }
}

// ── content-search row assembly (pure) ────────────────────────────────────────

/**
 * audienceState first-match (spec §3.4): public (PUBLIC link OR published
 * SITE) → external (guest grants or active invites) → internal (TEAM/null
 * collection or member grants) → private.
 */
function computeAudience(args: {
  linkPublic: boolean
  sitePublished: boolean
  guestCount: number
  activeInviteCount: number
  memberGrantCount: number
  collectionKind: 'TEAM' | 'PERSONAL' | 'SITE' | null
}): ContentSearchAudience {
  if (args.linkPublic || args.sitePublished) return 'public'
  if (args.guestCount + args.activeInviteCount > 0) return 'external'
  if (args.collectionKind === 'TEAM' || args.collectionKind === null || args.memberGrantCount > 0) {
    return 'internal'
  }
  return 'private'
}

function toContentSearchRow(
  page: ContentSearchPageRow,
  context: ContentSearchContext,
  query: string | null,
): AdminContentSearchRow {
  const share = page.share
  const grantUserIds = share?.grantUserIds ?? []
  const memberGrantCount = grantUserIds.filter((id) => context.memberGrantUserIds.has(id)).length
  const guestCount = grantUserIds.length - memberGrantCount
  const activeInviteCount = context.activeInviteCounts.get(page.id) ?? 0
  // Site-published mirrors ShareAccessService.checkSite: publishedAt set and
  // not superseded by a later unpublishedAt (re-publish flips it back).
  const sitePublished = Boolean(
    share &&
    share.mode === 'SITE' &&
    share.publishedAt &&
    (!share.unpublishedAt || share.unpublishedAt.getTime() < share.publishedAt.getTime()),
  )
  const linkPublic = share?.access === 'PUBLIC'

  // FTS mode only; mirrors searchPg — TEXT pages with a content snapshot.
  const excerpt =
    query && page.type === 'TEXT' && page.content
      ? (findFirstMatchingContentBlock(page.content, query)?.excerpt ?? null)
      : null

  return {
    pageId: page.id,
    title: page.title,
    icon: page.icon,
    excerpt,
    location: {
      collectionId: page.collection?.id ?? null,
      collectionTitle: page.collection?.title ?? null,
      collectionKind: page.collection?.kind ?? null,
    },
    audienceState: computeAudience({
      linkPublic,
      sitePublished,
      guestCount,
      activeInviteCount,
      memberGrantCount,
      collectionKind: page.collection?.kind ?? null,
    }),
    createdBy: page.createdBy,
    createdAt: page.createdAt,
    lastEditor: page.updatedBy,
    updatedAt: page.updatedAt,
    accessSummary: {
      memberGrantCount,
      guestCount,
      activeInviteCount,
      publicMode: sitePublished ? 'SITE' : linkPublic ? 'LINK' : null,
    },
  }
}
