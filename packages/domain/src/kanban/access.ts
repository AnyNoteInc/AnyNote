import type { PrismaClient } from '@repo/db'

import { forbidden, notFound } from '../errors.ts'

export async function assertPageAccess(prisma: PrismaClient, userId: string, pageId: string) {
  const page = await prisma.page.findFirst({
    where: { id: pageId, workspace: { members: { some: { userId } } } },
  })
  if (!page) throw notFound('Страница не найдена')
  return page
}

export async function assertPageOwnership(prisma: PrismaClient, userId: string, pageId: string) {
  const page = await prisma.page.findFirst({
    where: { id: pageId, workspace: { members: { some: { userId } } } },
  })
  if (!page) throw notFound('Страница не найдена')
  if (page.createdById === userId) return page
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: page.workspaceId, userId } },
  })
  if (member?.role !== 'OWNER') throw forbidden('Недостаточно прав')
  return page
}
