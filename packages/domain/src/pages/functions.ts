import { PageType, enqueueOutboxEvent } from '@repo/db'
import type { Prisma, PrismaClient } from '@repo/db'

import { notFound } from '../errors.ts'
import { assertPageOwnership } from '../kanban/access.ts'
import { seedKanbanDefaults } from '../kanban/seed.ts'
import type { CreatePageInput, RenamePageInput, UpdatePageInput } from './schemas.ts'

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
