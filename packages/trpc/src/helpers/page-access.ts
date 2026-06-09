import { TRPCError } from '@trpc/server'
import type { PrismaClient } from '@repo/db'

type Ctx = { prisma: PrismaClient; user: { id: string } }

export async function assertWorkspaceMember(ctx: Ctx, workspaceId: string) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (!member) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Вы не являетесь участником воркспейса' })
  }
  return member
}

export async function assertPageAccess(ctx: Ctx, pageId: string) {
  const page = await ctx.prisma.page.findFirst({
    where: {
      id: pageId,
      workspace: { members: { some: { userId: ctx.user.id } } },
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
      workspace: { members: { some: { userId: ctx.user.id } } },
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
      workspace: { members: { some: { userId: ctx.user.id } } },
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
      workspace: { members: { some: { userId: ctx.user.id } } },
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
