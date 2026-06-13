import { PageType, enqueueOutboxEvent } from '@repo/db'
import type { Prisma } from '@repo/db'

import type { UnitOfWork } from '../../shared/unit-of-work.ts'

/** Source page projection needed to deep-copy it (content + metadata). */
export interface SourcePageRow {
  id: string
  workspaceId: string
  parentId: string | null
  title: string | null
  icon: string | null
  type: PageType
  content: Prisma.JsonValue | null
  contentYjs: Uint8Array<ArrayBuffer> | null
}

/** Fields the service maps into a new copy. */
export interface CreateCopiedPageInput {
  workspaceId: string
  collectionId: string | null
  parentId: string | null
  title: string | null
  icon: string | null
  type: PageType
  content: Prisma.JsonValue | null
  contentYjs: Uint8Array<ArrayBuffer> | null
  copiedFromShareId: string | null
  copiedFromPageId: string
  copiedAt: Date
}

export class ShareCopyRepository {
  private readonly uow: UnitOfWork
  constructor(uow: UnitOfWork) {
    this.uow = uow
  }

  /** Live-fetch a single page's content + metadata for copying. Returns null
   *  when the page is archived, deleted, or does not exist — so the root must
   *  itself be a currently-visible page. */
  async findSourcePage(pageId: string): Promise<SourcePageRow | null> {
    const row = await this.uow.client().page.findFirst({
      where: { id: pageId, archivedAt: null, deletedAt: null },
      select: {
        id: true,
        workspaceId: true,
        parentId: true,
        title: true,
        icon: true,
        type: true,
        content: true,
        contentYjs: true,
      },
    })
    if (!row) return null
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      parentId: row.parentId,
      title: row.title,
      icon: row.icon,
      type: row.type,
      content: row.content,
      contentYjs: row.contentYjs as Uint8Array<ArrayBuffer> | null,
    }
  }

  /** One BFS level: children of the given parents that are copyable, i.e. not
   *  archived, not deleted, and not in *another* user's PERSONAL collection.
   *  TEAM / SITE collections and the actor's own PERSONAL collection pass. */
  async findCopyableChildren(parentIds: string[], actorUserId: string): Promise<SourcePageRow[]> {
    if (parentIds.length === 0) return []
    const rows = await this.uow.client().page.findMany({
      where: {
        parentId: { in: parentIds },
        archivedAt: null,
        deletedAt: null,
        // Exclude pages sitting in someone else's PERSONAL collection. A null
        // collection, a TEAM/SITE collection, or the actor's own PERSONAL one
        // are all allowed.
        NOT: {
          collection: {
            kind: 'PERSONAL',
            ownerId: { not: actorUserId },
          },
        },
      },
      select: {
        id: true,
        workspaceId: true,
        parentId: true,
        title: true,
        icon: true,
        type: true,
        content: true,
        contentYjs: true,
      },
    })
    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      parentId: row.parentId,
      title: row.title,
      icon: row.icon,
      type: row.type,
      content: row.content,
      contentYjs: row.contentYjs as Uint8Array<ArrayBuffer> | null,
    }))
  }

  /** Create one independent copy of a source page in the target workspace and
   *  enqueue its indexing event. Does NOT copy comments, share grants, or
   *  files — only the renderable content + provenance. */
  async createCopiedPage(
    actorUserId: string,
    input: CreateCopiedPageInput,
  ): Promise<{ id: string }> {
    const created = await this.uow.client().page.create({
      data: {
        workspaceId: input.workspaceId,
        collectionId: input.collectionId,
        parentId: input.parentId,
        type: input.type ?? PageType.TEXT,
        title: input.title,
        icon: input.icon,
        ...(input.content === null ? {} : { content: input.content }),
        ...(input.contentYjs === null ? {} : { contentYjs: input.contentYjs }),
        copiedFromShareId: input.copiedFromShareId,
        copiedFromPageId: input.copiedFromPageId,
        copiedAt: input.copiedAt,
        prevPageId: null,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
      select: { id: true },
    })

    await enqueueOutboxEvent(this.uow.client() as Prisma.TransactionClient, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: created.id,
      workspaceId: input.workspaceId,
    })

    return created
  }
}
