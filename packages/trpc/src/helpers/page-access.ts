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

export async function assertPageOwnership(ctx: Ctx, pageId: string, workspaceId: string) {
  const [page, member] = await Promise.all([
    ctx.prisma.page.findFirst({
      where: {
        id: pageId,
        workspaceId,
        workspace: { members: { some: { userId: ctx.user.id } } },
      },
    }),
    ctx.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
    }),
  ])
  if (!page) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })
  }
  if (!member) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Вы не являетесь участником воркспейса' })
  }
  const isOwner = member.role === 'OWNER'
  const isCreator = page.createdById === ctx.user.id
  if (!isOwner && !isCreator) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
  }
  return page
}
