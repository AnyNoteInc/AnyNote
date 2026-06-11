import { TRPCError } from '@trpc/server'
import type { PrismaClient } from '@repo/db'
import { createHash } from 'node:crypto'

import { findGrantOnPageOrAncestors } from './page-access'

export type EffectiveRole = 'OWNER' | 'EDITOR' | 'COMMENTER' | 'READER'
export type CommentAuthor = { userId?: string; anonId?: string; name: string }

type Ctx = { prisma: PrismaClient; user: { id: string } | null }
type Input = { pageId?: string; shareId?: string; anonId?: string }

export function canWriteComment(role: EffectiveRole | null): boolean {
  return role === 'OWNER' || role === 'EDITOR' || role === 'COMMENTER'
}

function mapMemberRole(role: string): EffectiveRole {
  switch (role) {
    case 'OWNER':
      return 'OWNER'
    case 'ADMIN':
    case 'EDITOR':
      return 'EDITOR'
    case 'COMMENTER':
      return 'COMMENTER'
    default:
      return 'READER'
  }
}

function displayName(u: { firstName: string | null; lastName: string | null; email: string }): string {
  return [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email
}

const GUEST_NAMES = ['Лис', 'Сокол', 'Клен', 'Ирис', 'Оникс', 'Север', 'Луч', 'Нота'] as const

function normalizeAnonId(anonId: string | undefined): string | undefined {
  const trimmed = anonId?.trim()
  return trimmed ? trimmed : undefined
}

function guestDisplayName(anonId: string | undefined): string {
  if (!anonId) return 'Гость'
  const digest = createHash('sha256').update(anonId).digest()
  return `Гость · ${GUEST_NAMES[(digest[0] ?? 0) % GUEST_NAMES.length]}`
}

export type CommentContext = {
  pageId: string
  workspaceId: string
  page: { createdById: string | null }
  role: EffectiveRole | null
  author: CommentAuthor
}

export async function resolveCommentContext(ctx: Ctx, input: Input): Promise<CommentContext> {
  const share = input.shareId
    ? await ctx.prisma.pageShare.findUnique({
        where: { shareId: input.shareId },
        select: {
          id: true,
          access: true,
          linkRole: true,
          pageId: true,
          page: { select: { id: true, workspaceId: true, createdById: true } },
        },
      })
    : null
  const page = input.pageId
    ? await ctx.prisma.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true, createdById: true },
      })
    : (share?.page ?? null)
  if (!page) throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })

  const shareForPage = share?.pageId === page.id ? share : null
  const base = {
    pageId: page.id,
    workspaceId: page.workspaceId,
    page: { createdById: page.createdById },
  }

  if (ctx.user) {
    const self = await ctx.prisma.user.findUnique({
      where: { id: ctx.user.id },
      select: { firstName: true, lastName: true, email: true },
    })
    const author: CommentAuthor = {
      userId: ctx.user.id,
      name: self ? displayName(self) : 'Пользователь',
    }

    // A workspace block kills the member AND grant arms — the blocked user keeps
    // only anonymous-level access via genuinely public links (mirrors
    // share-access; canonical semantics: PeopleService.isWorkspaceBlocked).
    const blocked = await ctx.prisma.workspaceBlockedUser.findUnique({
      where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: ctx.user.id } },
      select: { id: true },
    })

    if (!blocked) {
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: ctx.user.id } },
        select: { role: true },
      })
      if (member) return { ...base, role: mapMemberRole(member.role), author }

      // Grant arm with ancestor inheritance (people spec §3): a guest's grant
      // on the page OR any ancestor carries its role down the subtree, in line
      // with the page read-path (`findGrantOnPageOrAncestors`).
      const grant = await findGrantOnPageOrAncestors(ctx.prisma, ctx.user.id, page.id)
      if (grant) return { ...base, role: grant.role as EffectiveRole, author }
    }

    const pageShare =
      shareForPage ??
      (await ctx.prisma.pageShare.findUnique({
        where: { pageId: page.id },
        select: { id: true, access: true, linkRole: true, pageId: true },
      }))
    if (pageShare?.access === 'PUBLIC') {
      return { ...base, role: pageShare.linkRole as EffectiveRole, author }
    }
    return { ...base, role: null, author }
  }

  const anonId = normalizeAnonId(input.anonId)
  const author: CommentAuthor = { name: guestDisplayName(anonId), ...(anonId ? { anonId } : {}) }
  if (shareForPage?.access === 'PUBLIC') return { ...base, role: shareForPage.linkRole as EffectiveRole, author }
  return { ...base, role: null, author }
}
