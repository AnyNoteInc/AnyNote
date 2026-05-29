import type { Prisma } from '@repo/db'

import { badRequest } from '../errors.ts'

/**
 * `move` cycle-detection: walk up from `newParentId` through `parentId` links.
 * If we reach `pageId`, the move would nest a page inside its own descendant.
 * Ported verbatim from tRPC page.move (the ancestor walk).
 */
export async function assertNotMovingIntoOwnDescendant(
  tx: Prisma.TransactionClient,
  pageId: string,
  newParentId: string | null,
): Promise<void> {
  if (!newParentId) return
  let currentId: string | null = newParentId
  while (currentId) {
    if (currentId === pageId) {
      throw badRequest('Невозможно переместить страницу в собственного потомка')
    }
    const ancestor: { parentId: string | null } | null = await tx.page.findFirst({
      where: { id: currentId, deletedAt: null },
      select: { parentId: true },
    })
    currentId = ancestor?.parentId ?? null
  }
}

/**
 * `reorder` cycle-detection: BFS down the descendant tree of `pageId`.
 * If `newParentId` appears anywhere below `pageId`, reject the reorder.
 * Ported verbatim from tRPC page.reorder (the BFS).
 */
export async function assertNotReorderingIntoOwnDescendant(
  tx: Prisma.TransactionClient,
  pageId: string,
  newParentId: string | null,
): Promise<void> {
  if (newParentId === null) return
  let queue = [pageId]
  while (queue.length > 0) {
    const children = await tx.page.findMany({
      where: { parentId: { in: queue }, deletedAt: null },
      select: { id: true },
    })
    const childIds = children.map((c) => c.id)
    if (childIds.includes(newParentId)) {
      throw badRequest('Нельзя вложить страницу в собственного потомка')
    }
    queue = childIds
  }
}
