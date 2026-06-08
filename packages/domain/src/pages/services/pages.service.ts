import { badRequest, forbidden, notFound } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { KanbanService } from '../../kanban/index.ts'
import type { DatabaseService } from '../../database/index.ts'
import type {
  ArchivePageInput,
  CountResultDto,
  CreatePageExtra,
  CreatePageInput,
  CreateResultDto,
  DuplicatePageInput,
  EmptyTrashInput,
  HardDeletePageInput,
  MovePageInput,
  MoveToCollectionInput,
  PageRowDto,
  RenamePageInput,
  RenameResultDto,
  ReorderPageInput,
  RestorePageInput,
  SoftDeletePageInput,
  UnarchivePageInput,
  UpdatePageInput,
} from '../dto/pages.dto.ts'
import type { PageRepository } from '../repositories/pages.repository.ts'

export class PageService {
  private readonly repo: PageRepository
  private readonly uow: UnitOfWork
  private readonly kanban: KanbanService
  private readonly database: DatabaseService
  constructor(
    repo: PageRepository,
    uow: UnitOfWork,
    kanban: KanbanService,
    database: DatabaseService,
  ) {
    this.repo = repo
    this.uow = uow
    this.kanban = kanban
    this.database = database
  }

  // ── Access helpers ────────────────────────────────────────────────────────────

  private async assertAccess(userId: string, pageId: string): Promise<PageRowDto> {
    const page = await this.repo.findAccessiblePage(userId, pageId)
    if (!page) throw notFound('Страница не найдена')
    return page
  }

  private async assertOwnership(userId: string, pageId: string): Promise<PageRowDto> {
    const page = await this.repo.findAccessiblePage(userId, pageId)
    if (!page) throw notFound('Страница не найдена')
    if (page.createdById === userId) return page
    const m = await this.repo.findMembership(userId, page.workspaceId)
    if (m?.role !== 'OWNER') throw forbidden('Недостаточно прав')
    return page
  }

  // ── Service methods ───────────────────────────────────────────────────────────

  async create(
    actorUserId: string,
    input: CreatePageInput & CreatePageExtra,
  ): Promise<CreateResultDto> {
    // Pre-tx: if parent is a page, verify it exists and belongs to the same workspace
    if (input.parentId) {
      const parentPage = await this.repo.findParentPage(input.parentId, input.workspaceId)
      if (!parentPage) {
        throw notFound('Родительская страница не найдена')
      }
    }

    const resolvedCollectionId = await this.resolveCollectionId(actorUserId, input)

    return this.uow.transaction(() =>
      this.repo.createPageTx(
        actorUserId,
        { ...input, resolvedCollectionId },
        {
          onKanban: (pageId) => this.kanban.seedDefaults(pageId),
          onDatabase: (pageId, wsId) => this.database.seedDefaults(pageId, wsId),
        },
      ),
    )
  }

  /**
   * Resolve which collection a new page belongs to:
   * 1. an explicit collectionId always wins;
   * 2. otherwise inherit the parent page's collection;
   * 3. otherwise honour an explicit location ('team');
   * 4. default (and location 'private'): the actor's personal collection,
   *    falling back to the workspace team collection.
   */
  private async resolveCollectionId(
    actorUserId: string,
    input: CreatePageInput & CreatePageExtra,
  ): Promise<string | null> {
    if (input.collectionId !== undefined && input.collectionId !== null) return input.collectionId
    if (input.parentId) {
      const parentCol = await this.repo.getPageCollectionId(input.parentId)
      if (parentCol) return parentCol
    }
    if (input.location === 'team') {
      return this.repo.findTeamCollectionId(input.workspaceId)
    }
    // default + location 'private': actor's personal collection, fall back to team
    const personal = await this.repo.findPersonalCollectionId(input.workspaceId, actorUserId)
    if (personal) return personal
    return this.repo.findTeamCollectionId(input.workspaceId)
  }

  async moveToCollection(
    actorUserId: string,
    input: MoveToCollectionInput,
  ): Promise<CreateResultDto> {
    await this.assertOwnership(actorUserId, input.pageId)
    const target =
      input.target === 'team'
        ? await this.repo.findTeamCollectionId(input.workspaceId)
        : await this.repo.findPersonalCollectionId(input.workspaceId, actorUserId)
    return this.uow.transaction(() =>
      this.repo.moveToCollectionTx(actorUserId, input.pageId, target, input.workspaceId),
    )
  }

  async archive(
    actorUserId: string,
    input: ArchivePageInput,
  ): Promise<CreateResultDto> {
    await this.assertOwnership(actorUserId, input.id)
    return this.uow.transaction(() =>
      this.repo.archivePageTx(actorUserId, input.id, input.workspaceId),
    )
  }

  async unarchive(
    actorUserId: string,
    input: UnarchivePageInput,
  ): Promise<CreateResultDto> {
    await this.assertOwnership(actorUserId, input.id)
    return this.uow.transaction(() =>
      this.repo.unarchivePageTx(actorUserId, input.id, input.workspaceId),
    )
  }

  async rename(
    actorUserId: string,
    input: RenamePageInput,
  ): Promise<RenameResultDto> {
    await this.assertOwnership(actorUserId, input.id)
    return this.uow.transaction(() => this.repo.renamePageTx(actorUserId, input))
  }

  async update(
    actorUserId: string,
    input: UpdatePageInput,
  ): Promise<RenameResultDto> {
    await this.assertOwnership(actorUserId, input.id)
    return this.uow.transaction(() => this.repo.updatePageTx(actorUserId, input))
  }

  async duplicate(
    actorUserId: string,
    input: DuplicatePageInput,
  ): Promise<CreateResultDto> {
    const page = await this.assertAccess(actorUserId, input.pageId)
    return this.uow.transaction(() => this.repo.duplicatePageTx(actorUserId, page))
  }

  async move(
    actorUserId: string,
    input: MovePageInput,
  ): Promise<CreateResultDto> {
    const page = await this.assertAccess(actorUserId, input.pageId)
    // Ownership: must be creator or workspace OWNER
    await this.assertOwnership(actorUserId, input.pageId)
    return this.uow.transaction(() => this.repo.movePageTx(actorUserId, page, input))
  }

  async reorder(
    actorUserId: string,
    input: ReorderPageInput,
  ): Promise<CreateResultDto> {
    // Top-level self-reference check (matches original: before any I/O)
    if (input.newPrevPageId === input.pageId) {
      throw badRequest('Страница не может ссылаться на себя')
    }

    // reorderPage's original looks up by id only (not workspace-filtered).
    const pageRow = await this.repo.findActivePageById(input.pageId)
    if (!pageRow) throw notFound('Страница не найдена')

    const member = await this.repo.findMembership(actorUserId, pageRow.workspaceId)
    if (!member) throw forbidden('Вы не являетесь участником воркспейса')

    // Short-circuit: no-op when position is unchanged
    if (pageRow.parentId === input.newParentId && pageRow.prevPageId === input.newPrevPageId) {
      return { id: input.pageId }
    }

    // Cycle check (before opening the tx): newParentId must not be a descendant of pageId
    await this.repo.assertNotReorderingIntoOwnDescendant(input.pageId, input.newParentId)

    return this.uow.transaction(() => this.repo.reorderPageTx(actorUserId, pageRow, input))
  }

  async softDelete(
    actorUserId: string,
    input: SoftDeletePageInput,
  ): Promise<CreateResultDto> {
    const page = await this.assertOwnership(actorUserId, input.id)
    return this.uow.transaction(() => this.repo.softDeletePageTx(actorUserId, page, input))
  }

  async restore(
    actorUserId: string,
    input: RestorePageInput,
  ): Promise<CreateResultDto> {
    await this.assertOwnership(actorUserId, input.id)
    return this.uow.transaction(() => this.repo.restorePageTx(actorUserId, input))
  }

  async hardDelete(
    actorUserId: string,
    input: HardDeletePageInput,
  ): Promise<CreateResultDto> {
    await this.assertOwnership(actorUserId, input.id)
    return this.uow.transaction(() => this.repo.hardDeletePageTx(input))
  }

  async emptyTrash(
    actorUserId: string,
    input: EmptyTrashInput,
  ): Promise<CountResultDto> {
    const member = await this.repo.findMembership(actorUserId, input.workspaceId)
    if (!member) throw forbidden('Вы не являетесь участником воркспейса')
    if (member.role !== 'OWNER') {
      throw forbidden('Только владелец может очистить корзину')
    }
    return this.uow.transaction(() => this.repo.emptyTrashTx(input))
  }
}
