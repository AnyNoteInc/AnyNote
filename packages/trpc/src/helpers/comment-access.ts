import { TRPCError } from '@trpc/server'
import type { PrismaClient } from '@repo/db'

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

export type CommentContext = {
  pageId: string
  workspaceId: string
  page: { createdById: string | null }
  role: EffectiveRole | null
  author: CommentAuthor
}

/**
 * Resolve the viewer's effective role on a page for commenting, plus their
 * author identity. Signed-in: member ▸ named grant. (The public-link /
 * anonymous branch is added in Task 11.) Throws NOT_FOUND if `pageId` does not
 * resolve to a page.
 */
export async function resolveCommentContext(ctx: Ctx, input: Input): Promise<CommentContext> {
  const page = input.pageId
    ? await ctx.prisma.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true, createdById: true },
      })
    : null
  if (!page) throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })

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

    const member = await ctx.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: ctx.user.id } },
      select: { role: true },
    })
    if (member) return { ...base, role: mapMemberRole(member.role), author }

    const share = await ctx.prisma.pageShare.findUnique({
      where: { pageId: page.id },
      select: { id: true },
    })
    if (share) {
      const grant = await ctx.prisma.pageShareUser.findFirst({
        where: { pageShareId: share.id, userId: ctx.user.id },
        select: { role: true },
      })
      if (grant) return { ...base, role: grant.role as EffectiveRole, author }
    }
    return { ...base, role: null, author }
  }

  // Anonymous handled in Task 11.
  return { ...base, role: null, author: { name: 'Гость' } }
}
