import { TRPCError } from '@trpc/server'
import type { PrismaClient } from '@repo/db'

import { assertNotBlocked } from './membership'

type Ctx = { prisma: PrismaClient; user: { id: string } }

// ── Guest read-path: member-OR-grant (people spec §3) ────────────────────────

export type MemberOrGrantAccess =
  | { kind: 'member'; role: string }
  | { kind: 'guest'; role: string }

// Walk cap — defensive only; the move/parenting code already prevents cycles.
const MAX_PAGE_DEPTH = 100

/**
 * A `PageShareUser` grant on the page itself or on ANY ancestor admits the
 * holder to the page (Notion semantics: sharing a page shares its subtree),
 * mirroring how public share-token access already inherits
 * (`ShareAccessService.checkChild`). Differences from the public walk are
 * deliberate: explicit person-scoped grants beat collection privacy (the
 * precedent is the grant arm of `buildPageVisibilityWhere`), and archived
 * pages stay readable (they are readable for members too — archive is not an
 * access boundary). A trashed node anywhere on the path breaks the chain:
 * guests must never read trash. The NEAREST grant wins (most specific role).
 */
export async function findGrantOnPageOrAncestors(
  prisma: PrismaClient,
  userId: string,
  pageId: string,
): Promise<{ role: string; grantedPageId: string } | null> {
  const path: string[] = []
  const seen = new Set<string>()
  let current: string | null = pageId
  // Intentionally O(depth) sequential PK lookups: the cycle guard (`seen`)
  // must inspect each parent before deciding whether to continue, so the walk
  // can't be collapsed into one query. Bounded by MAX_PAGE_DEPTH.
  while (current && path.length < MAX_PAGE_DEPTH) {
    if (seen.has(current)) return null
    seen.add(current)
    const row: { id: string; parentId: string | null; deletedAt: Date | null } | null =
      await prisma.page.findUnique({
        where: { id: current },
        select: { id: true, parentId: true, deletedAt: true },
      })
    if (!row || row.deletedAt) return null
    path.push(row.id)
    current = row.parentId
  }
  if (path.length === 0) return null
  const grants = await prisma.pageShareUser.findMany({
    where: { userId, pageShare: { pageId: { in: path } } },
    select: { role: true, pageShare: { select: { pageId: true } } },
  })
  if (grants.length === 0) return null
  const byPage = new Map(grants.map((g) => [g.pageShare.pageId, g.role]))
  for (const id of path) {
    const role = byPage.get(id)
    if (role) return { role, grantedPageId: id }
  }
  return null
}

/**
 * Member-OR-grant resolution for page READ surfaces. Member (any role) wins
 * with full member semantics; otherwise a grant on the page or an ancestor
 * admits the user as a guest. Blocked users are FORBIDDEN on BOTH arms
 * (canonical semantics: `PeopleService.isWorkspaceBlocked`) — but the block
 * check runs only AFTER a member row or grant is found: a blocked outsider
 * (no relationship at all) must fall through to the uniform null denial
 * rather than learn they are blocked (no oracle). Returns null for users with
 * no relationship at all so callers can keep their object-hiding NOT_FOUND
 * contract.
 */
export async function resolveMemberOrPageGrant(
  ctx: Ctx,
  workspaceId: string,
  pageId: string,
): Promise<MemberOrGrantAccess | null> {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
    select: { role: true },
  })
  if (member) {
    await assertNotBlocked(ctx, workspaceId)
    return { kind: 'member', role: member.role }
  }
  const grant = await findGrantOnPageOrAncestors(ctx.prisma, ctx.user.id, pageId)
  if (!grant) return null
  await assertNotBlocked(ctx, workspaceId)
  return { kind: 'guest', role: grant.role }
}

/** Like `resolveMemberOrPageGrant` but FORBIDDEN when there is no access. */
export async function assertWorkspaceMemberOrPageGrant(
  ctx: Ctx,
  workspaceId: string,
  pageId: string,
): Promise<MemberOrGrantAccess> {
  const access = await resolveMemberOrPageGrant(ctx, workspaceId, pageId)
  if (!access) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
  }
  return access
}

/**
 * Workspace-level member-OR-grant: a member (block-aware) OR the holder of at
 * least one grant on a live page of the workspace. Used where a guest selects
 * the workspace itself (workspace.setActive) rather than a specific page.
 * Same no-oracle ordering as `resolveMemberOrPageGrant`: the block check runs
 * only once a member row or grant exists, so a blocked outsider gets the same
 * uniform FORBIDDEN as a plain outsider.
 */
export async function assertWorkspaceMemberOrAnyGrant(
  ctx: Ctx,
  workspaceId: string,
): Promise<{ kind: 'member' | 'guest' }> {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
    select: { id: true },
  })
  if (member) {
    await assertNotBlocked(ctx, workspaceId)
    return { kind: 'member' }
  }
  const grant = await ctx.prisma.pageShareUser.findFirst({
    where: { userId: ctx.user.id, pageShare: { page: { workspaceId, deletedAt: null } } },
    select: { id: true },
  })
  if (!grant) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
  }
  await assertNotBlocked(ctx, workspaceId)
  return { kind: 'guest' }
}

// Workspace-blocked users are denied everywhere (people spec §7.1). The page
// queries below carry the `blockedUsers: { none: … }` condition so block
// enforcement costs no extra roundtrip; the canonical semantics live in
// `PeopleService.isWorkspaceBlocked` (@repo/domain).
function memberAccessibleWorkspace(userId: string) {
  return {
    members: { some: { userId } },
    blockedUsers: { none: { userId } },
  }
}

export async function assertWorkspaceMember(ctx: Ctx, workspaceId: string) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (!member) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Вы не являетесь участником воркспейса' })
  }
  await assertNotBlocked(ctx, workspaceId)
  return member
}

export async function assertPageAccess(ctx: Ctx, pageId: string) {
  const page = await ctx.prisma.page.findFirst({
    where: {
      id: pageId,
      workspace: memberAccessibleWorkspace(ctx.user.id),
    },
  })
  if (!page) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })
  }
  return page
}

export async function assertPageOwnership(ctx: Ctx, pageId: string) {
  const page = await ctx.prisma.page.findFirst({
    where: {
      id: pageId,
      workspace: memberAccessibleWorkspace(ctx.user.id),
    },
  })
  if (!page) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })
  }
  if (page.createdById === ctx.user.id) {
    return page
  }
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: ctx.user.id } },
  })
  if (member?.role !== 'OWNER') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
  }
  return page
}

export async function assertPageEditAccess(ctx: Ctx, pageId: string) {
  const page = await ctx.prisma.page.findFirst({
    where: {
      id: pageId,
      workspace: memberAccessibleWorkspace(ctx.user.id),
    },
  })
  if (!page) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })
  }
  if (page.createdById === ctx.user.id) return page
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: ctx.user.id } },
  })
  if (member?.role !== 'OWNER' && member?.role !== 'ADMIN' && member?.role !== 'EDITOR') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав на редактирование' })
  }
  return page
}

// Like assertPageEditAccess but also rejects soft-deleted (trashed) pages.
// Used where exposing a trashed page's data would be wrong — e.g. page history
// snapshots: a member must not be able to read revision content of a page that
// has been moved to trash.
export async function assertActivePageEditAccess(ctx: Ctx, pageId: string) {
  const page = await assertPageEditAccess(ctx, pageId)
  if (page.deletedAt) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })
  }
  return page
}

export async function assertCanManageShare(ctx: Ctx, pageId: string) {
  const page = await ctx.prisma.page.findFirst({
    where: {
      id: pageId,
      workspace: memberAccessibleWorkspace(ctx.user.id),
    },
  })
  if (!page) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })
  }
  if (page.createdById === ctx.user.id) return page
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: ctx.user.id } },
  })
  if (member?.role !== 'OWNER' && member?.role !== 'ADMIN') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
  }
  return page
}
