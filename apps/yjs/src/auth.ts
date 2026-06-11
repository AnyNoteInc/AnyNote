import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader, type JWTPayload } from 'jose'
import { prisma, PageType } from '@repo/db'

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

export async function canAccessPage(userId: string, pageId: string): Promise<PageAccess | null> {
  // Member arm — ACTIVE members only: a workspace_blocked_users row kills
  // access (inline mirror of @repo/domain `PeopleService.isWorkspaceBlocked`).
  const memberPage = await prisma.page.findFirst({
    where: {
      id: pageId,
      deletedAt: null,
      workspace: {
        members: { some: { userId } },
        blockedUsers: { none: { userId } },
      },
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
