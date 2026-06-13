import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader, type JWTPayload } from 'jose'
import { prisma, PageType } from '@repo/db'
// Deep-import the PURE visibility leaf (it depends only on @repo/db) so the live
// nested-doc gate reuses the SAME "can this user see this page" predicate the
// tRPC read gate (`syncedBlock.getById` → `resolveOriginAccess`) uses, and the
// two layers can't drift. The leaf carries no inversify/DI weight — we never
// import the `@repo/domain` barrel here.
import { buildPageVisibilityWhere } from '@repo/domain/pages/page-visibility.ts'

import { log } from './logger.js'

let jwksFetcher: ReturnType<typeof createRemoteJWKSet> | null = null

export function initJwks(jwksUrl: string): void {
  jwksFetcher = createRemoteJWKSet(new URL(jwksUrl))
  log.info('JWKS fetcher initialized', { jwksUrl })
}

export async function verifyJwt(
  token: string,
  audience: string | undefined,
): Promise<{ userId: string }> {
  if (!jwksFetcher) throw new Error('JWKS not initialized; call initJwks first')
  const { payload } = await jwtVerify(token, jwksFetcher, {
    audience,
  })
  const userId = pickUserId(payload)
  if (!userId) throw new Error('JWT missing subject (userId)')
  return { userId }
}

function pickUserId(payload: JWTPayload): string | undefined {
  if (typeof payload.sub === 'string') return payload.sub
  if (typeof (payload as { userId?: unknown }).userId === 'string') {
    return (payload as { userId: string }).userId
  }
  return undefined
}

export type PageAccess = {
  pageType: PageType
  workspaceId: string
  access: 'member' | 'guest'
  /** PageShareUser grant role when access === 'guest'; null for members. */
  role: 'READER' | 'COMMENTER' | 'EDITOR' | null
}

/**
 * The shared origin-page access check (member arm + guest-grant arm, both
 * blocked-user-excluded). EXTRACTED so page documents and synced-block documents
 * resolve access through the SAME logic and can't drift: `canAccessPage` calls
 * it against the page id; `canAccessSyncedBlock` calls it against the block's
 * origin page id. Returns the canonical {@link PageAccess} shape so
 * `isReadOnlyAccess` maps the connection mode identically for both.
 */
export async function resolvePageAccess(
  userId: string,
  pageId: string,
): Promise<PageAccess | null> {
  // Member arm — ACTIVE members only, AND the page must be VISIBLE to this user.
  //   - membership: a workspace_blocked_users row kills access (inline mirror of
  //     @repo/domain `PeopleService.isWorkspaceBlocked`).
  //   - visibility: `buildPageVisibilityWhere` (the @repo/domain source of truth,
  //     deep-imported above) ANDs in the collection-privacy predicate — TEAM /
  //     null-collection pages are member-visible, but a PERSONAL-collection page
  //     is visible only to its owner (or via an explicit share grant). Without
  //     this a workspace member could open the live `syncedBlock:<id>` doc whose
  //     origin is a FOREIGN PERSONAL page and stream the canonical content,
  //     bypassing the tRPC read gate (spec §8.1/§8.2 require the gate at BOTH
  //     layers). This mirrors tRPC `resolveOriginAccess` exactly — they must not
  //     drift.
  const memberPage = await prisma.page.findFirst({
    where: {
      id: pageId,
      deletedAt: null,
      workspace: {
        members: { some: { userId } },
        blockedUsers: { none: { userId } },
      },
      AND: [buildPageVisibilityWhere(userId)],
    },
    select: { type: true, workspaceId: true },
  })
  if (memberPage) {
    return {
      pageType: memberPage.type,
      workspaceId: memberPage.workspaceId,
      access: 'member',
      role: null,
    }
  }

  // Guest arm — a named PageShareUser grant on THIS page admits collaboration
  // with the grant role; a blocked user's grant is dead too.
  const guestPage = await prisma.page.findFirst({
    where: {
      id: pageId,
      deletedAt: null,
      share: { users: { some: { userId } } },
      workspace: { blockedUsers: { none: { userId } } },
    },
    select: {
      type: true,
      workspaceId: true,
      share: { select: { users: { where: { userId }, select: { role: true }, take: 1 } } },
    },
  })
  if (!guestPage) return null
  return {
    pageType: guestPage.type,
    workspaceId: guestPage.workspaceId,
    access: 'guest',
    role: (guestPage.share?.users[0]?.role as PageAccess['role']) ?? 'READER',
  }
}

export async function canAccessPage(userId: string, pageId: string): Promise<PageAccess | null> {
  return resolvePageAccess(userId, pageId)
}

/**
 * Access for a synced-block document (Phase 9C). Resolves the SyncedBlock (NOT
 * deleted), then inherits access from its origin page via {@link resolvePageAccess}
 * — so a workspace member who cannot see a PERSONAL-collection origin page gets
 * denied here too. An orphaned block (originPageId null, e.g. the origin page was
 * deleted → SetNull) or a deleted/missing block ⇒ deny. Returns the SAME
 * {@link PageAccess} shape as `canAccessPage` so index.ts maps `readOnly`
 * (VIEWER/COMMENTER origin grants ⇒ read-only) identically.
 */
export async function canAccessSyncedBlock(
  userId: string,
  blockId: string,
): Promise<PageAccess | null> {
  const block = await prisma.syncedBlock.findFirst({
    where: { id: blockId, deletedAt: null },
    select: { originPageId: true },
  })
  // Deleted/missing block, or an orphan (no origin page) ⇒ no live access.
  if (!block || !block.originPageId) return null
  return resolvePageAccess(userId, block.originPageId)
}

/** Grant-role → connection mode: READER/COMMENTER collaborate read-only, EDITOR writes; members keep full write. */
export function isReadOnlyAccess(access: PageAccess): boolean {
  return access.access === 'guest' && access.role !== 'EDITOR'
}

export type ShareTokenClaims = {
  userId: string
  pageId: string
  shareId: string
  role: 'READER' | 'COMMENTER' | 'EDITOR'
  name: string
}

/** Returns claims if `token` is one of our HS256 share tokens, else null. */
export async function verifyShareToken(
  token: string,
  secret: string,
): Promise<ShareTokenClaims | null> {
  let alg: string | undefined
  try {
    alg = decodeProtectedHeader(token).alg
  } catch {
    return null
  }
  if (alg !== 'HS256') return null
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret))
  if ((payload as { typ?: string }).typ !== 'share') return null
  const sub = typeof payload.sub === 'string' ? payload.sub : undefined
  const pageId = (payload as { pageId?: string }).pageId
  const shareId = (payload as { shareId?: string }).shareId
  const role = (payload as { role?: ShareTokenClaims['role'] }).role
  const name = (payload as { name?: string }).name ?? 'Гость'
  if (!sub || !pageId || !shareId || !role) throw new Error('Malformed share token')
  return { userId: sub, pageId, shareId, role, name }
}

/** Page meta for persistence; no membership check (the share token is the authority). */
export async function loadPageMeta(
  pageId: string,
): Promise<{ pageType: PageType; workspaceId: string } | null> {
  const page = await prisma.page.findFirst({
    where: { id: pageId, deletedAt: null },
    select: { type: true, workspaceId: true },
  })
  return page ? { pageType: page.type, workspaceId: page.workspaceId } : null
}
