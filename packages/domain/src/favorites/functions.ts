import type { PrismaClient } from '@repo/db'

import { forbidden, notFound } from '../errors.ts'
import type { AddFavoriteInput, RemoveFavoriteInput, ReorderFavoritesInput } from './schemas.ts'

async function assertPageAccess(prisma: PrismaClient, userId: string, pageId: string) {
  const page = await prisma.page.findFirst({
    where: { id: pageId, workspace: { members: { some: { userId } } } },
  })
  if (!page) throw notFound('Страница не найдена')
  return page
}

export async function addFavorite(
  prisma: PrismaClient,
  actorUserId: string,
  input: AddFavoriteInput,
) {
  await assertPageAccess(prisma, actorUserId, input.pageId)
  return prisma.$transaction(async (tx) => {
    const maxResult = await tx.favoritePage.aggregate({
      where: { userId: actorUserId },
      _max: { position: true },
    })
    const nextPosition = (maxResult._max.position ?? -1) + 1
    return tx.favoritePage.upsert({
      where: { userId_pageId: { userId: actorUserId, pageId: input.pageId } },
      create: { userId: actorUserId, pageId: input.pageId, position: nextPosition },
      update: {},
    })
  })
}

export async function removeFavorite(
  prisma: PrismaClient,
  actorUserId: string,
  input: RemoveFavoriteInput,
): Promise<{ count: number }> {
  // No assertPageAccess: allow un-favoriting a page you've lost access to.
  return prisma.favoritePage.deleteMany({
    where: { userId: actorUserId, pageId: input.pageId },
  })
}

export async function reorderFavorites(
  prisma: PrismaClient,
  actorUserId: string,
  input: ReorderFavoritesInput,
): Promise<{ ok: true }> {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: actorUserId } },
  })
  if (!member) throw forbidden('Вы не являетесь участником воркспейса')

  await prisma.$transaction(
    input.orderedIds.map((pageId, index) =>
      prisma.favoritePage.updateMany({
        where: {
          userId: actorUserId,
          pageId,
          page: { workspaceId: input.workspaceId },
        },
        data: { position: index },
      }),
    ),
  )
  return { ok: true }
}
