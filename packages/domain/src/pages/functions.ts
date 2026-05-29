import { PageType, enqueueOutboxEvent } from '@repo/db'
import type { Prisma, PrismaClient } from '@repo/db'

import { badRequest, forbidden, notFound } from '../errors.ts'
import { assertPageAccess, assertPageOwnership } from '../kanban/access.ts'
import { seedKanbanDefaults } from '../kanban/seed.ts'
import {
  assertNotMovingIntoOwnDescendant,
  assertNotReorderingIntoOwnDescendant,
} from './ordering.ts'
import type {
  CreatePageInput,
  DuplicatePageInput,
  EmptyTrashInput,
  HardDeletePageInput,
  MovePageInput,
  RenamePageInput,
  ReorderPageInput,
  RestorePageInput,
  SoftDeletePageInput,
  UpdatePageInput,
} from './schemas.ts'

/**
 * Engines passes ownership/content/contentYjs; tRPC passes only the schema subset.
 * createPage accepts the superset so both consumers share one positioning + outbox path.
 */
export type CreatePageExtra = {
  ownership?: 'TEXT' | 'SKILL' | 'AGENT'
  content?: Prisma.InputJsonValue
  contentYjs?: Uint8Array<ArrayBuffer>
}

export async function createPage(
  prisma: PrismaClient,
  actorUserId: string,
  input: CreatePageInput & CreatePageExtra,
): Promise<{ id: string }> {
  // If parent is a page, verify it exists and belongs to the same workspace.
  if (input.parentId) {
    const parentPage = await prisma.page.findFirst({
      where: { id: input.parentId, workspaceId: input.workspaceId, deletedAt: null },
    })
    if (!parentPage) {
      throw notFound('Родительская страница не найдена')
    }
  }

  return prisma.$transaction(async (tx) => {
    const newPage = await tx.page.create({
      data: {
        workspaceId: input.workspaceId,
        parentId: input.parentId,
        title: input.title ?? null,
        icon: input.icon ?? null,
        type: input.type ?? PageType.TEXT,
        ...(input.ownership ? { ownership: input.ownership } : {}),
        ...(input.content === undefined ? {} : { content: input.content }),
        ...(input.contentYjs === undefined ? {} : { contentYjs: input.contentYjs }),
        prevPageId: null,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
    })

    // Insert at tail of linked list: find the sibling whose id is not
    // referenced as prevPageId by any other sibling (= the last one).
    const siblings = await tx.page.findMany({
      where: {
        workspaceId: input.workspaceId,
        parentId: input.parentId,
        id: { not: newPage.id },
        deletedAt: null,
      },
      select: { id: true, prevPageId: true },
    })
    if (siblings.length > 0) {
      const prevPageIds = new Set(
        siblings.map((s) => s.prevPageId).filter((id): id is string => id !== null),
      )
      const tail = siblings.find((s) => !prevPageIds.has(s.id))
      if (tail) {
        await tx.page.update({
          where: { id: newPage.id },
          data: { prevPageId: tail.id },
        })
      }
    }

    await enqueueOutboxEvent(tx, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: newPage.id,
      workspaceId: input.workspaceId,
    })

    if (newPage.type === PageType.KANBAN) {
      await seedKanbanDefaults(tx, newPage.id)
    }

    return { id: newPage.id }
  })
}

export async function renamePage(
  prisma: PrismaClient,
  actorUserId: string,
  input: RenamePageInput,
): Promise<{ id: string; title: string | null; icon: string | null; updatedAt: Date }> {
  await assertPageOwnership(prisma, actorUserId, input.id)
  const data: { title: string; icon?: string | null; updatedById: string } = {
    title: input.title,
    updatedById: actorUserId,
  }
  if (input.icon !== undefined) data.icon = input.icon
  return prisma.$transaction(async (tx) => {
    const updated = await tx.page.update({
      where: { id: input.id },
      data,
      select: { id: true, title: true, icon: true, updatedAt: true },
    })
    await enqueueOutboxEvent(tx, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: updated.id,
      workspaceId: input.workspaceId,
    })
    return updated
  })
}

export async function updatePage(
  prisma: PrismaClient,
  actorUserId: string,
  input: UpdatePageInput,
): Promise<{ id: string; title: string | null; icon: string | null; updatedAt: Date }> {
  await assertPageOwnership(prisma, actorUserId, input.id)
  const data: {
    title?: string
    icon?: string | null
    type?: PageType
    updatedById: string
  } = { updatedById: actorUserId }
  if (input.title !== undefined) data.title = input.title
  if (input.icon !== undefined) data.icon = input.icon
  if (input.type !== undefined) data.type = input.type
  return prisma.$transaction(async (tx) => {
    const updated = await tx.page.update({
      where: { id: input.id },
      data,
      select: { id: true, title: true, icon: true, updatedAt: true },
    })
    await enqueueOutboxEvent(tx, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: updated.id,
      workspaceId: input.workspaceId,
    })
    return updated
  })
}

export async function duplicatePage(
  prisma: PrismaClient,
  actorUserId: string,
  input: DuplicatePageInput,
): Promise<{ id: string }> {
  const page = await assertPageAccess(prisma, actorUserId, input.pageId)

  return prisma.$transaction(async (tx) => {
    // 1. Detach old next sibling first (prevPageId is unique)
    const oldNext = await tx.page.findFirst({
      where: { prevPageId: page.id, deletedAt: null },
    })
    if (oldNext) {
      await tx.page.update({
        where: { id: oldNext.id },
        data: { prevPageId: null },
      })
    }

    // 2. Create copy with same parent, inserted after original. Copy both
    // the JSON snapshot AND the authoritative contentYjs bytes — the editor
    // loads from contentYjs, so without it the duplicate renders empty.
    const copy = await tx.page.create({
      data: {
        workspaceId: page.workspaceId,
        parentId: page.parentId,
        type: page.type,
        title: `${page.title ?? ''} (копия)`.trim(),
        icon: page.icon,
        content: page.content ?? undefined,
        contentYjs: page.contentYjs ?? undefined,
        prevPageId: page.id,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
    })

    // 3. Reattach old next sibling to point to copy
    if (oldNext) {
      await tx.page.update({
        where: { id: oldNext.id },
        data: { prevPageId: copy.id },
      })
    }

    await enqueueOutboxEvent(tx, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: copy.id,
      workspaceId: page.workspaceId,
    })

    return { id: copy.id }
  })
}

export async function movePage(
  prisma: PrismaClient,
  actorUserId: string,
  input: MovePageInput,
): Promise<{ id: string }> {
  const page = await assertPageAccess(prisma, actorUserId, input.pageId)
  // Ownership: must be creator or workspace OWNER.
  await assertPageOwnership(prisma, actorUserId, input.pageId)

  return prisma.$transaction(async (tx) => {
    // 1. Remove from old linked-list (detach first to avoid unique constraint)
    const nextSibling = await tx.page.findFirst({
      where: { prevPageId: page.id, deletedAt: null },
    })
    if (nextSibling) {
      await tx.page.update({
        where: { id: nextSibling.id },
        data: { prevPageId: null },
      })
    }

    // 2. Prevent moving into own descendant
    await assertNotMovingIntoOwnDescendant(tx, input.pageId, input.newParentId)

    // 3. Set new parentId
    await tx.page.update({
      where: { id: page.id },
      data: {
        parentId: input.newParentId,
        prevPageId: null,
        updatedById: actorUserId,
      },
    })

    // Reattach next sibling to previous in old list
    if (nextSibling) {
      await tx.page.update({
        where: { id: nextSibling.id },
        data: { prevPageId: page.prevPageId },
      })
    }

    // 4. Insert at head of new parent's linked-list
    const existingFirst = await tx.page.findFirst({
      where: {
        workspaceId: page.workspaceId,
        parentId: input.newParentId,
        prevPageId: null,
        id: { not: page.id },
        deletedAt: null,
      },
    })
    if (existingFirst) {
      await tx.page.update({
        where: { id: existingFirst.id },
        data: { prevPageId: page.id },
      })
    }

    await enqueueOutboxEvent(tx, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: page.id,
      workspaceId: page.workspaceId,
    })

    return { id: page.id }
  })
}

export async function reorderPage(
  prisma: PrismaClient,
  actorUserId: string,
  input: ReorderPageInput,
): Promise<{ id: string }> {
  if (input.newPrevPageId === input.pageId) {
    throw badRequest('Страница не может ссылаться на себя')
  }

  const page = await prisma.page.findFirst({
    where: { id: input.pageId, deletedAt: null },
  })
  if (!page) throw notFound('Страница не найдена')

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: actorUserId } },
  })
  if (!member) throw forbidden('Вы не являетесь участником воркспейса')

  if (page.parentId === input.newParentId && page.prevPageId === input.newPrevPageId) {
    return { id: input.pageId }
  }

  // Cycle check: newParentId must not be a descendant of pageId
  await assertNotReorderingIntoOwnDescendant(prisma, input.pageId, input.newParentId)

  return prisma.$transaction(async (tx) => {
    // Step 0: Lift the moved page out so its prev_page_id doesn't clash
    // with the next sibling adopting the same value in step 1
    // (prev_page_id is UNIQUE — two rows can't hold the same value).
    if (page.prevPageId !== null) {
      await tx.page.update({
        where: { id: input.pageId },
        data: { prevPageId: null },
      })
    }

    // Step 1: Detach — fix next sibling's back-pointer
    const nextSibling = await tx.page.findFirst({
      where: { prevPageId: input.pageId, deletedAt: null },
    })
    if (nextSibling) {
      await tx.page.update({
        where: { id: nextSibling.id },
        data: { prevPageId: page.prevPageId },
      })
    }

    // Step 2: Plug the gap at insert point
    const pageAtInsertPoint = await tx.page.findFirst({
      where: {
        prevPageId: input.newPrevPageId,
        workspaceId: page.workspaceId,
        parentId: input.newParentId,
        deletedAt: null,
        id: { not: input.pageId },
      },
    })
    if (pageAtInsertPoint) {
      await tx.page.update({
        where: { id: pageAtInsertPoint.id },
        data: { prevPageId: input.pageId },
      })
    }

    // Step 3: Update the moved page to its final position
    await tx.page.update({
      where: { id: input.pageId },
      data: {
        parentId: input.newParentId,
        prevPageId: input.newPrevPageId,
        updatedById: actorUserId,
      },
    })

    await enqueueOutboxEvent(tx, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: input.pageId,
      workspaceId: page.workspaceId,
    })

    return { id: input.pageId }
  })
}

export async function softDeletePage(
  prisma: PrismaClient,
  actorUserId: string,
  input: SoftDeletePageInput,
): Promise<{ id: string }> {
  const page = await assertPageOwnership(prisma, actorUserId, input.id)
  const now = new Date()

  return prisma.$transaction(async (tx) => {
    // Remove page from linked list (detach first to avoid unique constraint)
    const nextSibling = await tx.page.findFirst({
      where: { prevPageId: page.id, deletedAt: null },
    })
    if (nextSibling) {
      await tx.page.update({
        where: { id: nextSibling.id },
        data: { prevPageId: null },
      })
    }

    // Soft-delete this page
    await tx.page.update({
      where: { id: page.id },
      data: { deletedAt: now, prevPageId: null, updatedById: actorUserId },
    })

    // Reattach next sibling to previous
    if (nextSibling) {
      await tx.page.update({
        where: { id: nextSibling.id },
        data: { prevPageId: page.prevPageId },
      })
    }

    // Soft-delete all descendants recursively
    // Use a loop to walk the tree breadth-first
    let parentIds: string[] = [page.id]
    while (parentIds.length > 0) {
      const children = await tx.page.findMany({
        where: {
          parentId: { in: parentIds },
          deletedAt: null,
        },
        select: { id: true },
      })
      if (children.length === 0) break
      const childIds = children.map((c) => c.id)
      await tx.page.updateMany({
        where: { id: { in: childIds } },
        data: { deletedAt: now, updatedById: actorUserId },
      })
      parentIds = childIds
    }

    await enqueueOutboxEvent(tx, {
      eventType: 'page.deleted',
      aggregateType: 'page',
      aggregateId: page.id,
      workspaceId: input.workspaceId,
    })

    return { id: page.id }
  })
}

export async function restorePage(
  prisma: PrismaClient,
  actorUserId: string,
  input: RestorePageInput,
): Promise<{ id: string }> {
  await assertPageOwnership(prisma, actorUserId, input.id)

  return prisma.$transaction(async (tx) => {
    const page = await tx.page.findFirst({
      where: { id: input.id, workspaceId: input.workspaceId },
    })
    if (!page || !page.deletedAt) {
      throw notFound('Страница не найдена в корзине')
    }

    // Determine restore location: if parent is deleted, move to workspace root
    let restoreParentId = page.parentId

    if (page.parentId) {
      const parentPage = await tx.page.findFirst({
        where: { id: page.parentId, deletedAt: null },
      })
      if (!parentPage) {
        // Parent is still deleted — move to workspace root
        restoreParentId = null
      }
    }

    // Restore the page
    await tx.page.update({
      where: { id: page.id },
      data: {
        deletedAt: null,
        parentId: restoreParentId,
        prevPageId: null,
        updatedById: actorUserId,
      },
    })

    // Insert at start of linked list
    const existingFirst = await tx.page.findFirst({
      where: {
        workspaceId: input.workspaceId,
        parentId: restoreParentId,
        prevPageId: null,
        id: { not: page.id },
        deletedAt: null,
      },
    })
    if (existingFirst) {
      await tx.page.update({
        where: { id: existingFirst.id },
        data: { prevPageId: page.id },
      })
    }

    // Restore all descendants recursively
    let parentIds: string[] = [page.id]
    while (parentIds.length > 0) {
      const children = await tx.page.findMany({
        where: {
          parentId: { in: parentIds },
          deletedAt: { not: null },
        },
        select: { id: true },
      })
      if (children.length === 0) break
      const childIds = children.map((c) => c.id)
      await tx.page.updateMany({
        where: { id: { in: childIds } },
        data: { deletedAt: null, updatedById: actorUserId },
      })
      parentIds = childIds
    }

    await enqueueOutboxEvent(tx, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: page.id,
      workspaceId: input.workspaceId,
    })

    return { id: page.id }
  })
}

export async function hardDeletePage(
  prisma: PrismaClient,
  actorUserId: string,
  input: HardDeletePageInput,
): Promise<{ id: string }> {
  await assertPageOwnership(prisma, actorUserId, input.id)

  return prisma.$transaction(async (tx) => {
    const page = await tx.page.findFirst({
      where: { id: input.id, workspaceId: input.workspaceId },
    })
    if (!page) {
      throw notFound('Страница не найдена')
    }

    // Remove from linked list if still linked
    const nextSibling = await tx.page.findFirst({
      where: { prevPageId: page.id },
    })
    if (nextSibling) {
      await tx.page.update({
        where: { id: nextSibling.id },
        data: { prevPageId: page.prevPageId },
      })
    }

    // Delete the page (cascade handles related rows)
    await tx.page.delete({ where: { id: page.id } })

    await enqueueOutboxEvent(tx, {
      eventType: 'page.deleted',
      aggregateType: 'page',
      aggregateId: page.id,
      workspaceId: input.workspaceId,
    })

    return { id: page.id }
  })
}

export async function emptyTrash(
  prisma: PrismaClient,
  actorUserId: string,
  input: EmptyTrashInput,
): Promise<{ count: number }> {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: actorUserId } },
  })
  if (!member) throw forbidden('Вы не являетесь участником воркспейса')
  if (member.role !== 'OWNER') {
    throw forbidden('Только владелец может очистить корзину')
  }
  return prisma.$transaction(async (tx) => {
    const trashed = await tx.page.findMany({
      where: { workspaceId: input.workspaceId, deletedAt: { not: null } },
      select: { id: true },
    })
    const deleted = await tx.page.deleteMany({
      where: { workspaceId: input.workspaceId, deletedAt: { not: null } },
    })
    for (const { id } of trashed) {
      await enqueueOutboxEvent(tx, {
        eventType: 'page.deleted',
        aggregateType: 'page',
        aggregateId: id,
        workspaceId: input.workspaceId,
      })
    }
    return { count: deleted.count }
  })
}
