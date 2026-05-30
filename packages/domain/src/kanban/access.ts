/**
 * Compat shim — pages/functions.ts still imports assertPageAccess/assertPageOwnership
 * with the old (prisma, userId, pageId) → page signature. The layered module
 * handles access internally via KanbanService, but pages is migrated in a later
 * cycle and must continue to compile against this file in the meantime.
 */
import type { PrismaClient } from '@repo/db'

import { forbidden, notFound } from '../shared/errors.ts'

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
