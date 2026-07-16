import { PageType, enqueueOutboxEvent, enqueueIntegrationEvents } from '@repo/db'
import type { Prisma } from '@repo/db'

import { badRequest, notFound } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import { buildPageVisibilityWhere } from '../page-visibility.ts'
import type {
  CountResultDto,
  CreatePageExtra,
  CreatePageInput,
  CreateResultDto,
  EmptyTrashInput,
  HardDeletePageInput,
  MovePageInput,
  PageRowDto,
  RenamePageInput,
  RenameResultDto,
  ReorderPageInput,
  RestorePageInput,
  SoftDeletePageInput,
  UpdatePageInput,
} from '../dto/pages.dto.ts'

/**
 * Per-type provisioning hooks dispatched after a page is created (inside the same
 * transaction). Each runs only for its matching `Page.type`.
 */
export interface PageProvisioning {
  onKanban: (pageId: string) => Promise<void>
  onDatabase: (pageId: string, workspaceId: string) => Promise<void>
}

export class PageRepository {
  private readonly uow: UnitOfWork
  constructor(uow: UnitOfWork) {
    this.uow = uow
  }

  // ── Access queries ────────────────────────────────────────────────────────────

  async findAccessiblePage(userId: string, pageId: string): Promise<PageRowDto | null> {
    const row = await this.uow.client().page.findFirst({
      where: {
        id: pageId,
        workspace: { members: { some: { userId } } },
        AND: [buildPageVisibilityWhere(userId)],
      },
      select: {
        id: true,
        workspaceId: true,
        createdById: true,
        parentId: true,
        collectionId: true,
        prevPageId: true,
        title: true,
        icon: true,
        type: true,
        content: true,
        contentYjs: true,
        archivedAt: true,
        deletedAt: true,
      },
    })
    if (!row) return null
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      createdById: row.createdById,
      parentId: row.parentId,
      collectionId: row.collectionId,
      prevPageId: row.prevPageId,
      title: row.title,
      icon: row.icon,
      type: row.type,
      content: row.content,
      contentYjs: row.contentYjs,
      archivedAt: row.archivedAt,
      deletedAt: row.deletedAt,
    }
  }

  // Lookup by id only (not workspace-filtered) — matches reorderPage's original semantics.
  async findActivePageById(pageId: string): Promise<PageRowDto | null> {
    const row = await this.uow.client().page.findFirst({
      where: { id: pageId, deletedAt: null },
      select: {
        id: true,
        workspaceId: true,
        createdById: true,
        parentId: true,
        collectionId: true,
        prevPageId: true,
        title: true,
        icon: true,
        type: true,
        content: true,
        contentYjs: true,
        archivedAt: true,
        deletedAt: true,
      },
    })
    if (!row) return null
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      createdById: row.createdById,
      parentId: row.parentId,
      collectionId: row.collectionId,
      prevPageId: row.prevPageId,
      title: row.title,
      icon: row.icon,
      type: row.type,
      content: row.content,
      contentYjs: row.contentYjs,
      archivedAt: row.archivedAt,
      deletedAt: row.deletedAt,
    }
  }

  async findMembership(userId: string, workspaceId: string): Promise<{ role: string } | null> {
    return this.uow.client().workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    })
  }

  // ── Cycle-detection helpers (private; moved wholesale from ordering.ts) ───────

  /**
   * `move` cycle-detection: walk up from `newParentId` through `parentId` links.
   * If we reach `pageId`, the move would nest a page inside its own descendant.
   */
  private async assertNotMovingIntoOwnDescendant(
    pageId: string,
    newParentId: string | null,
  ): Promise<void> {
    if (!newParentId) return
    let currentId: string | null = newParentId
    while (currentId) {
      if (currentId === pageId) {
        throw badRequest('Невозможно переместить страницу в собственного потомка')
      }
      const ancestor: { parentId: string | null } | null = await this.uow.client().page.findFirst({
        where: { id: currentId, deletedAt: null },
        select: { parentId: true },
      })
      currentId = ancestor?.parentId ?? null
    }
  }

  /**
   * `reorder` cycle-detection: BFS down the descendant tree of `pageId`.
   * If `newParentId` appears anywhere below `pageId`, reject the reorder.
   * Pure read over `uow.client()` — the service runs it before opening the tx.
   */
  async assertNotReorderingIntoOwnDescendant(
    pageId: string,
    newParentId: string | null,
  ): Promise<void> {
    if (newParentId === null) return
    let queue = [pageId]
    while (queue.length > 0) {
      const children = await this.uow.client().page.findMany({
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

  // ── Coarse operation methods (each = original tx body, tx → uow.client()) ────

  async createPageTx(
    actorUserId: string,
    input: CreatePageInput & CreatePageExtra,
    provision: PageProvisioning,
  ): Promise<CreateResultDto> {
    const newPage = await this.uow.client().page.create({
      data: {
        workspaceId: input.workspaceId,
        parentId: input.parentId,
        title: input.title ?? null,
        icon: input.icon ?? null,
        type: input.type ?? PageType.TEXT,
        collectionId: input.resolvedCollectionId ?? null,
        ...(input.ownership ? { ownership: input.ownership } : {}),
        ...(input.content === undefined ? {} : { content: input.content }),
        ...(input.contentYjs === undefined ? {} : { contentYjs: input.contentYjs }),
        ...(input.isTemplate === undefined ? {} : { isTemplate: input.isTemplate }),
        ...(input.templateKey === undefined ? {} : { templateKey: input.templateKey }),
        ...(input.templateMeta === undefined ? {} : { templateMeta: input.templateMeta }),
        prevPageId: null,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
    })

    // Insert at tail of linked list: find the sibling whose id is not
    // referenced as prevPageId by any other sibling (= the last one).
    const siblings = await this.uow.client().page.findMany({
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
        await this.uow.client().page.update({
          where: { id: newPage.id },
          data: { prevPageId: tail.id },
        })
      }
    }

    await enqueueOutboxEvent(this.uow.client() as Prisma.TransactionClient, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: newPage.id,
      workspaceId: input.workspaceId,
    })
    await enqueueIntegrationEvents(this.uow.client() as Prisma.TransactionClient, {
      event: 'page.created',
      resourceType: 'page',
      resourceId: newPage.id,
      workspaceId: input.workspaceId,
      actorId: actorUserId,
      hints: {},
    })

    if (newPage.type === PageType.KANBAN) {
      await provision.onKanban(newPage.id)
    } else if (newPage.type === PageType.DATABASE) {
      await provision.onDatabase(newPage.id, newPage.workspaceId)
    }

    return { id: newPage.id }
  }

  /**
   * Create a database item page: a child TEXT page of the DATABASE page. Unlike
   * `createPageTx`, this deliberately does NOT run the kanban/database provisioning
   * dispatch (the new page is plain TEXT, and re-dispatching DATABASE provisioning
   * would recurse). It still enqueues the indexing outbox event and does tail
   * linked-list insertion so item pages behave like real pages everywhere else.
   *
   * The item page inherits the source page's workspaceId (cross-workspace guard).
   * Caller is responsible for opening the transaction.
   */
  async createItemPageTx(
    parentPageId: string,
    workspaceId: string,
    actorUserId: string | null,
  ): Promise<CreateResultDto> {
    const newPage = await this.uow.client().page.create({
      data: {
        workspaceId,
        parentId: parentPageId,
        title: null,
        type: PageType.TEXT,
        collectionId: null,
        prevPageId: null,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
    })

    // Insert at tail of the parent's linked list (same logic as createPageTx).
    const siblings = await this.uow.client().page.findMany({
      where: {
        workspaceId,
        parentId: parentPageId,
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
        await this.uow.client().page.update({
          where: { id: newPage.id },
          data: { prevPageId: tail.id },
        })
      }
    }

    await enqueueOutboxEvent(this.uow.client() as Prisma.TransactionClient, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: newPage.id,
      workspaceId,
    })
    // Deliberately NO webhook_event here: database item pages are internal rows
    // of a DATABASE page — the fan-out's visibility gate excludes them anyway,
    // and emitting would only create dead outbox rows per row insert.

    return { id: newPage.id }
  }

  async archivePageTx(
    actorUserId: string,
    pageId: string,
    workspaceId: string,
  ): Promise<CreateResultDto> {
    await this.uow.client().page.update({
      where: { id: pageId },
      data: { archivedAt: new Date(), archivedById: actorUserId, updatedById: actorUserId },
    })
    await enqueueOutboxEvent(this.uow.client() as Prisma.TransactionClient, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: pageId,
      workspaceId,
    })
    await enqueueIntegrationEvents(this.uow.client() as Prisma.TransactionClient, {
      event: 'page.properties_updated',
      resourceType: 'page',
      resourceId: pageId,
      workspaceId,
      actorId: actorUserId,
      hints: { changed: ['archivedAt'] },
    })
    return { id: pageId }
  }

  async unarchivePageTx(
    actorUserId: string,
    pageId: string,
    workspaceId: string,
  ): Promise<CreateResultDto> {
    await this.uow.client().page.update({
      where: { id: pageId },
      data: { archivedAt: null, archivedById: null, updatedById: actorUserId },
    })
    await enqueueOutboxEvent(this.uow.client() as Prisma.TransactionClient, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: pageId,
      workspaceId,
    })
    await enqueueIntegrationEvents(this.uow.client() as Prisma.TransactionClient, {
      event: 'page.properties_updated',
      resourceType: 'page',
      resourceId: pageId,
      workspaceId,
      actorId: actorUserId,
      hints: { changed: ['archivedAt'] },
    })
    return { id: pageId }
  }

  async findTeamCollectionId(workspaceId: string): Promise<string | null> {
    const c = await this.uow.client().collection.findFirst({
      where: { workspaceId, kind: 'TEAM', ownerId: null },
      select: { id: true },
    })
    return c?.id ?? null
  }

  async findPersonalCollectionId(workspaceId: string, userId: string): Promise<string | null> {
    const c = await this.uow.client().collection.findFirst({
      where: { workspaceId, kind: 'PERSONAL', ownerId: userId },
      select: { id: true },
    })
    return c?.id ?? null
  }

  async getPageCollectionId(pageId: string): Promise<string | null> {
    const p = await this.uow.client().page.findUnique({
      where: { id: pageId },
      select: { collectionId: true },
    })
    return p?.collectionId ?? null
  }

  async moveToCollectionTx(
    actorUserId: string,
    pageId: string,
    collectionId: string | null,
    workspaceId: string,
    position?: { newParentId: string | null; newPrevPageId: string | null },
  ): Promise<CreateResultDto> {
    const moved = await this.uow.client().page.findUnique({
      where: { id: pageId },
      select: { prevPageId: true, parentId: true },
    })
    const oldPrevPageId = moved?.prevPageId ?? null
    const oldParentId = moved?.parentId ?? null

    // Step 0: lift the moved page out so its prev_page_id UNIQUE slot is free
    // (two rows can't hold the same prev_page_id during the relink shuffle).
    if (oldPrevPageId !== null) {
      await this.uow.client().page.update({ where: { id: pageId }, data: { prevPageId: null } })
    }

    // Step 1: detach — the moved page's old next sibling adopts its old prev,
    // closing the gap the move leaves in the SOURCE collection's list.
    const oldNext = await this.uow.client().page.findFirst({
      where: { prevPageId: pageId, deletedAt: null },
    })
    if (oldNext) {
      await this.uow.client().page.update({
        where: { id: oldNext.id },
        data: { prevPageId: oldPrevPageId },
      })
    }

    // No-position move keeps the page in its CURRENT parent subtree (only the
    // collection changes); a positioned DnD drop explicitly sets the target
    // parent. Defaulting to null here would orphan a nested page to the root.
    const newParentId = position ? (position.newParentId ?? null) : oldParentId
    // No-position head-insert lands at prevPageId=null; positioned uses the drop point.
    const newPrevPageId = position?.newPrevPageId ?? null
    if (!position) {
      // Head insert: the current head of (collection, parent) re-points at us.
      const head = await this.uow.client().page.findFirst({
        where: {
          workspaceId,
          collectionId,
          parentId: newParentId,
          prevPageId: null,
          id: { not: pageId },
          deletedAt: null,
        },
      })
      if (head) {
        await this.uow
          .client()
          .page.update({ where: { id: head.id }, data: { prevPageId: pageId } })
      }
    } else {
      // Positioned insert: the row currently at newPrevPageId re-points to us.
      const pageAtInsertPoint = await this.uow.client().page.findFirst({
        where: {
          prevPageId: newPrevPageId,
          workspaceId,
          collectionId,
          parentId: newParentId,
          deletedAt: null,
          id: { not: pageId },
        },
      })
      if (pageAtInsertPoint) {
        await this.uow.client().page.update({
          where: { id: pageAtInsertPoint.id },
          data: { prevPageId: pageId },
        })
      }
    }

    // Final: set collection + position on the moved page.
    await this.uow.client().page.update({
      where: { id: pageId },
      data: {
        collectionId,
        parentId: newParentId,
        prevPageId: newPrevPageId,
        updatedById: actorUserId,
      },
    })
    await enqueueOutboxEvent(this.uow.client() as Prisma.TransactionClient, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: pageId,
      workspaceId,
    })
    await enqueueIntegrationEvents(this.uow.client() as Prisma.TransactionClient, {
      event: 'page.moved',
      resourceType: 'page',
      resourceId: pageId,
      workspaceId,
      actorId: actorUserId,
      hints: { scope: 'collection' },
    })
    return { id: pageId }
  }

  async renamePageTx(actorUserId: string, input: RenamePageInput): Promise<RenameResultDto> {
    const data: { title: string; icon?: string | null; updatedById: string } = {
      title: input.title,
      updatedById: actorUserId,
    }
    if (input.icon !== undefined) data.icon = input.icon
    const updated = await this.uow.client().page.update({
      where: { id: input.id },
      data,
      select: { id: true, title: true, icon: true, updatedAt: true },
    })
    await enqueueOutboxEvent(this.uow.client() as Prisma.TransactionClient, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: updated.id,
      workspaceId: input.workspaceId,
    })
    await enqueueIntegrationEvents(this.uow.client() as Prisma.TransactionClient, {
      event: 'page.properties_updated',
      resourceType: 'page',
      resourceId: updated.id,
      workspaceId: input.workspaceId,
      actorId: actorUserId,
      hints: { changed: input.icon !== undefined ? ['title', 'icon'] : ['title'] },
    })
    return updated
  }

  async updatePageTx(actorUserId: string, input: UpdatePageInput): Promise<RenameResultDto> {
    const data: {
      title?: string
      icon?: string | null
      type?: PageType
      coverUrl?: string | null
      coverPreset?: string | null
      updatedById: string
    } = { updatedById: actorUserId }
    if (input.title !== undefined) data.title = input.title
    if (input.icon !== undefined) data.icon = input.icon
    if (input.type !== undefined) data.type = input.type
    if (input.coverUrl !== undefined) data.coverUrl = input.coverUrl
    if (input.coverPreset !== undefined) data.coverPreset = input.coverPreset
    // Load the current values so the `changed` hint lists only real changes —
    // e.g. clearing an already-null cover must not advertise coverUrl/coverPreset.
    const current = await this.uow.client().page.findUnique({
      where: { id: input.id },
      select: { title: true, icon: true, type: true, coverUrl: true, coverPreset: true },
    })
    const updated = await this.uow.client().page.update({
      where: { id: input.id },
      data,
      select: { id: true, title: true, icon: true, updatedAt: true },
    })
    await enqueueOutboxEvent(this.uow.client() as Prisma.TransactionClient, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: updated.id,
      workspaceId: input.workspaceId,
    })
    const changed = (['title', 'icon', 'type', 'coverUrl', 'coverPreset'] as const).filter(
      (k) => input[k] !== undefined && (current === null || input[k] !== current[k]),
    )
    if (changed.length > 0) {
      await enqueueIntegrationEvents(this.uow.client() as Prisma.TransactionClient, {
        event: 'page.properties_updated',
        resourceType: 'page',
        resourceId: updated.id,
        workspaceId: input.workspaceId,
        actorId: actorUserId,
        hints: { changed },
      })
    }
    return updated
  }

  async duplicatePageTx(actorUserId: string, page: PageRowDto): Promise<CreateResultDto> {
    // 1. Detach old next sibling first (prevPageId is unique)
    const oldNext = await this.uow.client().page.findFirst({
      where: { prevPageId: page.id, deletedAt: null },
    })
    if (oldNext) {
      await this.uow.client().page.update({
        where: { id: oldNext.id },
        data: { prevPageId: null },
      })
    }

    // 2. Create copy with same parent, inserted after original. Copy both
    // the JSON snapshot AND the authoritative contentYjs bytes — the editor
    // loads from contentYjs, so without it the duplicate renders empty.
    const copy = await this.uow.client().page.create({
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
      await this.uow.client().page.update({
        where: { id: oldNext.id },
        data: { prevPageId: copy.id },
      })
    }

    await enqueueOutboxEvent(this.uow.client() as Prisma.TransactionClient, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: copy.id,
      workspaceId: page.workspaceId,
    })
    await enqueueIntegrationEvents(this.uow.client() as Prisma.TransactionClient, {
      event: 'page.created',
      resourceType: 'page',
      resourceId: copy.id,
      workspaceId: page.workspaceId,
      actorId: actorUserId,
      hints: { duplicatedFrom: page.id },
    })

    return { id: copy.id }
  }

  async movePageTx(
    actorUserId: string,
    page: PageRowDto,
    input: MovePageInput,
  ): Promise<CreateResultDto> {
    // 1. Remove from old linked-list (detach first to avoid unique constraint)
    const nextSibling = await this.uow.client().page.findFirst({
      where: { prevPageId: page.id, deletedAt: null },
    })
    if (nextSibling) {
      await this.uow.client().page.update({
        where: { id: nextSibling.id },
        data: { prevPageId: null },
      })
    }

    // 2. Prevent moving into own descendant
    await this.assertNotMovingIntoOwnDescendant(input.pageId, input.newParentId)

    // 3. Set new parentId
    await this.uow.client().page.update({
      where: { id: page.id },
      data: {
        parentId: input.newParentId,
        prevPageId: null,
        updatedById: actorUserId,
      },
    })

    // Reattach next sibling to previous in old list
    if (nextSibling) {
      await this.uow.client().page.update({
        where: { id: nextSibling.id },
        data: { prevPageId: page.prevPageId },
      })
    }

    // 4. Insert at head of new parent's linked-list
    const existingFirst = await this.uow.client().page.findFirst({
      where: {
        workspaceId: page.workspaceId,
        parentId: input.newParentId,
        prevPageId: null,
        id: { not: page.id },
        deletedAt: null,
      },
    })
    if (existingFirst) {
      await this.uow.client().page.update({
        where: { id: existingFirst.id },
        data: { prevPageId: page.id },
      })
    }

    await enqueueOutboxEvent(this.uow.client() as Prisma.TransactionClient, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: page.id,
      workspaceId: page.workspaceId,
    })
    await enqueueIntegrationEvents(this.uow.client() as Prisma.TransactionClient, {
      event: 'page.moved',
      resourceType: 'page',
      resourceId: page.id,
      workspaceId: page.workspaceId,
      actorId: actorUserId,
      hints: { to: input.newParentId ?? null },
    })

    return { id: page.id }
  }

  async reorderPageTx(
    actorUserId: string,
    page: PageRowDto,
    input: ReorderPageInput,
  ): Promise<CreateResultDto> {
    // Step 0: Lift the moved page out so its prev_page_id doesn't clash
    // with the next sibling adopting the same value in step 1
    // (prev_page_id is UNIQUE — two rows can't hold the same value).
    if (page.prevPageId !== null) {
      await this.uow.client().page.update({
        where: { id: input.pageId },
        data: { prevPageId: null },
      })
    }

    // Step 1: Detach — fix next sibling's back-pointer
    const nextSibling = await this.uow.client().page.findFirst({
      where: { prevPageId: input.pageId, deletedAt: null },
    })
    if (nextSibling) {
      await this.uow.client().page.update({
        where: { id: nextSibling.id },
        data: { prevPageId: page.prevPageId },
      })
    }

    // Step 2: Plug the gap at insert point
    const pageAtInsertPoint = await this.uow.client().page.findFirst({
      where: {
        prevPageId: input.newPrevPageId,
        workspaceId: page.workspaceId,
        parentId: input.newParentId,
        deletedAt: null,
        id: { not: input.pageId },
      },
    })
    if (pageAtInsertPoint) {
      await this.uow.client().page.update({
        where: { id: pageAtInsertPoint.id },
        data: { prevPageId: input.pageId },
      })
    }

    // Step 3: Update the moved page to its final position
    await this.uow.client().page.update({
      where: { id: input.pageId },
      data: {
        parentId: input.newParentId,
        prevPageId: input.newPrevPageId,
        updatedById: actorUserId,
      },
    })

    await enqueueOutboxEvent(this.uow.client() as Prisma.TransactionClient, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: input.pageId,
      workspaceId: page.workspaceId,
    })
    await enqueueIntegrationEvents(this.uow.client() as Prisma.TransactionClient, {
      event: 'page.moved',
      resourceType: 'page',
      resourceId: input.pageId,
      workspaceId: page.workspaceId,
      actorId: actorUserId,
      hints: { to: input.newParentId ?? null },
    })

    return { id: input.pageId }
  }

  async softDeletePageTx(
    actorUserId: string,
    page: PageRowDto,
    input: SoftDeletePageInput,
  ): Promise<CreateResultDto> {
    const now = new Date()

    // Remove page from linked list (detach first to avoid unique constraint)
    const nextSibling = await this.uow.client().page.findFirst({
      where: { prevPageId: page.id, deletedAt: null },
    })
    if (nextSibling) {
      await this.uow.client().page.update({
        where: { id: nextSibling.id },
        data: { prevPageId: null },
      })
    }

    // Soft-delete this page
    await this.uow.client().page.update({
      where: { id: page.id },
      data: { deletedAt: now, prevPageId: null, updatedById: actorUserId },
    })

    // Reattach next sibling to previous
    if (nextSibling) {
      await this.uow.client().page.update({
        where: { id: nextSibling.id },
        data: { prevPageId: page.prevPageId },
      })
    }

    // Soft-delete all descendants recursively
    // Use a loop to walk the tree breadth-first
    let parentIds: string[] = [page.id]
    while (parentIds.length > 0) {
      const children = await this.uow.client().page.findMany({
        where: {
          parentId: { in: parentIds },
          deletedAt: null,
        },
        select: { id: true },
      })
      if (children.length === 0) break
      const childIds = children.map((c) => c.id)
      await this.uow.client().page.updateMany({
        where: { id: { in: childIds } },
        data: { deletedAt: now, updatedById: actorUserId },
      })
      parentIds = childIds
    }

    await enqueueOutboxEvent(this.uow.client() as Prisma.TransactionClient, {
      eventType: 'page.deleted',
      aggregateType: 'page',
      aggregateId: page.id,
      workspaceId: input.workspaceId,
    })
    await enqueueIntegrationEvents(this.uow.client() as Prisma.TransactionClient, {
      event: 'page.deleted',
      resourceType: 'page',
      resourceId: page.id,
      workspaceId: input.workspaceId,
      actorId: actorUserId,
      hints: {},
    })

    return { id: page.id }
  }

  async restorePageTx(actorUserId: string, input: RestorePageInput): Promise<CreateResultDto> {
    // Interleaved check: must be inside the tx (woven into the I/O sequence)
    const page = await this.uow.client().page.findFirst({
      where: { id: input.id, workspaceId: input.workspaceId },
    })
    if (!page || !page.deletedAt) {
      throw notFound('Страница не найдена в корзине')
    }

    // Determine restore location: if parent is deleted, move to workspace root
    let restoreParentId = page.parentId

    if (page.parentId) {
      const parentPage = await this.uow.client().page.findFirst({
        where: { id: page.parentId, deletedAt: null },
      })
      if (!parentPage) {
        // Parent is still deleted — move to workspace root
        restoreParentId = null
      }
    }

    // Restore the page
    await this.uow.client().page.update({
      where: { id: page.id },
      data: {
        deletedAt: null,
        parentId: restoreParentId,
        prevPageId: null,
        updatedById: actorUserId,
      },
    })

    // Insert at start of linked list
    const existingFirst = await this.uow.client().page.findFirst({
      where: {
        workspaceId: input.workspaceId,
        parentId: restoreParentId,
        prevPageId: null,
        id: { not: page.id },
        deletedAt: null,
      },
    })
    if (existingFirst) {
      await this.uow.client().page.update({
        where: { id: existingFirst.id },
        data: { prevPageId: page.id },
      })
    }

    // Restore all descendants recursively
    let parentIds: string[] = [page.id]
    while (parentIds.length > 0) {
      const children = await this.uow.client().page.findMany({
        where: {
          parentId: { in: parentIds },
          deletedAt: { not: null },
        },
        select: { id: true },
      })
      if (children.length === 0) break
      const childIds = children.map((c) => c.id)
      await this.uow.client().page.updateMany({
        where: { id: { in: childIds } },
        data: { deletedAt: null, updatedById: actorUserId },
      })
      parentIds = childIds
    }

    await enqueueOutboxEvent(this.uow.client() as Prisma.TransactionClient, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: page.id,
      workspaceId: input.workspaceId,
    })
    await enqueueIntegrationEvents(this.uow.client() as Prisma.TransactionClient, {
      event: 'page.undeleted',
      resourceType: 'page',
      resourceId: page.id,
      workspaceId: input.workspaceId,
      actorId: actorUserId,
      hints: {},
    })

    return { id: page.id }
  }

  async hardDeletePageTx(input: HardDeletePageInput): Promise<CreateResultDto> {
    // Interleaved check: must be inside the tx (woven into the I/O sequence).
    // deletedAt guard: hard-delete is only reachable from the trash — a live
    // page must be soft-deleted first (the UI contract).
    const page = await this.uow.client().page.findFirst({
      where: { id: input.id, workspaceId: input.workspaceId, deletedAt: { not: null } },
    })
    if (!page) {
      throw notFound('Страница не найдена')
    }

    // Remove from linked list if still linked
    const nextSibling = await this.uow.client().page.findFirst({
      where: { prevPageId: page.id },
    })
    if (nextSibling) {
      await this.uow.client().page.update({
        where: { id: nextSibling.id },
        data: { prevPageId: page.prevPageId },
      })
    }

    // Prune the page's hidden INLINE_AI ephemeral chats (Phase 9D) and its
    // PAGE chats (page chat panel). The FKs are SetNull (orphan-tolerant for
    // the soft cases), but a permanent purge must remove them outright — they
    // have no meaning without their page.
    await this.uow.client().chat.deleteMany({
      where: {
        OR: [
          { kind: 'INLINE_AI', inlineAiPageId: page.id },
          { kind: 'PAGE', pageId: page.id },
        ],
      },
    })

    // Delete the page (cascade handles related rows)
    await this.uow.client().page.delete({ where: { id: page.id } })

    await enqueueOutboxEvent(this.uow.client() as Prisma.TransactionClient, {
      eventType: 'page.deleted',
      aggregateType: 'page',
      aggregateId: page.id,
      workspaceId: input.workspaceId,
    })
    // No webhook emission: the page row is gone by fan-out time (soft-delete already emitted page.deleted; purge is silent).

    return { id: page.id }
  }

  async emptyTrashTx(input: EmptyTrashInput): Promise<CountResultDto> {
    const trashed = await this.uow.client().page.findMany({
      where: { workspaceId: input.workspaceId, deletedAt: { not: null } },
      select: { id: true },
    })
    // Prune the trashed pages' hidden INLINE_AI ephemeral chats (Phase 9D) and
    // their PAGE chats (page chat panel) — same permanent-purge semantics as
    // the single-page hard delete; the FK SetNull must not be relied on to
    // leave orphans.
    if (trashed.length > 0) {
      const trashedIds = trashed.map((p) => p.id)
      await this.uow.client().chat.deleteMany({
        where: {
          OR: [
            { kind: 'INLINE_AI', inlineAiPageId: { in: trashedIds } },
            { kind: 'PAGE', pageId: { in: trashedIds } },
          ],
        },
      })
    }
    const deleted = await this.uow.client().page.deleteMany({
      where: { workspaceId: input.workspaceId, deletedAt: { not: null } },
    })
    for (const { id } of trashed) {
      await enqueueOutboxEvent(this.uow.client() as Prisma.TransactionClient, {
        eventType: 'page.deleted',
        aggregateType: 'page',
        aggregateId: id,
        workspaceId: input.workspaceId,
      })
      // No webhook emission: the page row is gone by fan-out time (soft-delete already emitted page.deleted; purge is silent).
    }
    return { count: deleted.count }
  }

  // ── Pre-tx check: parent exists (used by service before opening tx) ─────────

  async findParentPage(parentId: string, workspaceId: string): Promise<{ id: string } | null> {
    return this.uow.client().page.findFirst({
      where: { id: parentId, workspaceId, deletedAt: null },
      select: { id: true },
    })
  }
}
