import 'server-only'

import type { PrismaClient, PageType } from '@repo/db'
import { ShareAccessService, ShareAccessRepository } from '@repo/domain'
import type { PublicUnavailableReason, ResolvedShareMeta } from '@repo/domain'

export type EffectiveRole = 'OWNER' | 'EDITOR' | 'COMMENTER' | 'READER'

type SessionLike = { user: { id: string } } | null

export type SharePage = {
  id: string
  type: PageType
  title: string | null
  icon: string | null
  coverUrl: string | null
  coverPreset: string | null
  contentYjs: Uint8Array | Buffer | null
  workspaceId: string
  createdById: string | null
}

/**
 * Discriminated result of viewing-resolution:
 *   - `member` / `grant`: the visitor is a workspace member or a named grant —
 *     these win and are NOT subject to publish / expiry / password gating.
 *   - `public`: access granted via the public link/site (gated by the domain
 *     ShareAccessService — publish state, expiry, schedule, password, subtree).
 *   - `unavailable`: a share exists but the public path denies it (with reason).
 *   - `not_found`: no share for this id (caller should 404).
 */
export type ShareAccessResult =
  | { kind: 'member' | 'grant' | 'public'; role: EffectiveRole; page: SharePage; share: ResolvedShareMeta }
  | { kind: 'unavailable'; reason: PublicUnavailableReason }
  | { kind: 'not_found' }

type ResolveOpts = { pageId?: string; password?: string }

const sharePageSelect = {
  id: true,
  type: true,
  title: true,
  icon: true,
  // Page appearance (Phase 9A): covers/icons render for anonymous visitors —
  // every share render path (member/grant fast-paths AND the public re-load)
  // flows through this select.
  coverUrl: true,
  coverPreset: true,
  contentYjs: true,
  workspaceId: true,
  createdById: true,
} as const

export function mapMemberRole(role: string): EffectiveRole {
  switch (role) {
    case 'OWNER':
      return 'OWNER'
    case 'ADMIN':
    case 'EDITOR':
      return 'EDITOR'
    case 'COMMENTER':
      return 'COMMENTER'
    default:
      return 'READER' // VIEWER, GUEST
  }
}

/**
 * Single viewing-resolution authority. Priority:
 *   workspace member ▸ named grant ▸ public link/site (domain authority) ▸ deny.
 *
 * The member/grant fast-paths bypass publish/expiry/password gating. The public
 * path defers entirely to `ShareAccessService.resolve`, the one place that
 * encodes the publish-state / expiry / schedule / password / subtree rules.
 */
export async function resolveShareAccess(
  prisma: PrismaClient,
  shareId: string,
  session: SessionLike,
  opts?: ResolveOpts,
): Promise<ShareAccessResult> {
  const share = await prisma.pageShare.findUnique({
    where: { shareId },
    select: {
      id: true,
      mode: true,
      allowCopy: true,
      allowIndexing: true,
      publishSubpages: true,
      analyticsGoogleId: true,
      analyticsYandexMetricaId: true,
      page: { select: sharePageSelect },
    },
  })
  if (!share) return { kind: 'not_found' }

  const rootPage = share.page as SharePage
  const shareMeta: ResolvedShareMeta = {
    shareId,
    mode: share.mode as 'LINK' | 'SITE',
    allowCopy: share.allowCopy,
    allowIndexing: share.allowIndexing,
    publishSubpages: share.publishSubpages,
    analyticsGoogleId: share.analyticsGoogleId,
    analyticsYandexMetricaId: share.analyticsYandexMetricaId,
  }

  // Member / grant fast-paths win and bypass all public gating. A workspace
  // block (one indexed lookup — inline mirror of @repo/domain
  // `PeopleService.isWorkspaceBlocked`) kills BOTH fast-paths: the blocked
  // visitor falls through to the public path, i.e. keeps only the
  // anonymous-level access a genuinely public link would give anyone.
  if (session?.user) {
    const blocked = await prisma.workspaceBlockedUser.findUnique({
      where: { workspaceId_userId: { workspaceId: rootPage.workspaceId, userId: session.user.id } },
      select: { id: true },
    })

    if (!blocked) {
      const member = await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: rootPage.workspaceId, userId: session.user.id },
        },
        select: { role: true },
      })
      if (member) {
        const page = await pageForRequest(prisma, rootPage, opts?.pageId)
        if (page) return { kind: 'member', role: mapMemberRole(member.role), page, share: shareMeta }
      }

      const grant = await prisma.pageShareUser.findFirst({
        where: { pageShareId: share.id, userId: session.user.id },
        select: { role: true },
      })
      if (grant) {
        const page = await pageForRequest(prisma, rootPage, opts?.pageId)
        if (page) return { kind: 'grant', role: grant.role as EffectiveRole, page, share: shareMeta }
      }
    }
  }

  // Public path — domain authority decides availability.
  const service = new ShareAccessService(new ShareAccessRepository(prisma))
  const result = await service.resolve({
    shareId,
    requestedPageId: opts?.pageId,
    password: opts?.password,
    now: new Date(),
  })
  if (result.status === 'unavailable') return { kind: 'unavailable', reason: result.reason }

  // The resolver validated visibility but returns a lean page (no contentYjs);
  // load the full row for rendering.
  const page = await prisma.page.findUnique({
    where: { id: result.page.id },
    select: sharePageSelect,
  })
  if (!page) return { kind: 'unavailable', reason: 'restricted_child' }
  return {
    kind: 'public',
    role: result.role as EffectiveRole,
    page: page as SharePage,
    share: result.share,
  }
}

// For members/grants honouring an optional requested child page id. Members see
// any page in their workspace; we only allow the requested page if it belongs to
// the same workspace as the share root.
async function pageForRequest(
  prisma: PrismaClient,
  rootPage: SharePage,
  requestedPageId?: string,
): Promise<SharePage | null> {
  if (!requestedPageId || requestedPageId === rootPage.id) return rootPage
  const page = await prisma.page.findFirst({
    where: { id: requestedPageId, workspaceId: rootPage.workspaceId },
    select: sharePageSelect,
  })
  return (page as SharePage) ?? null
}
