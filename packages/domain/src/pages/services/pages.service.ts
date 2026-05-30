import { badRequest, forbidden, notFound } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { KanbanService } from '../../kanban/index.ts'
import type {
  CountResultDto,
  CreatePageExtra,
  CreatePageInput,
  CreateResultDto,
  DuplicatePageInput,
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
import type { PageRepository } from '../repositories/pages.repository.ts'

export class PageService {
  constructor(
    private readonly repo: PageRepository,
    private readonly uow: UnitOfWork,
    private readonly kanban: KanbanService,
  ) {}

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

    return this.uow.transaction(() =>
      this.repo.createPageTx(actorUserId, input, (pageId) => this.kanban.seedDefaults(pageId)),
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

    // reorderPage's original uses prisma.page.findFirst by id only (not workspace-filtered).
    // The UoW client() outside a transaction == base PrismaClient, preserving the original.
    const rawPage = await this.uow.client().page.findFirst({
      where: { id: input.pageId, deletedAt: null },
    })
    if (!rawPage) throw notFound('Страница не найдена')

    const member = await this.repo.findMembership(actorUserId, rawPage.workspaceId)
    if (!member) throw forbidden('Вы не являетесь участником воркспейса')

    // Short-circuit: no-op when position is unchanged
    if (rawPage.parentId === input.newParentId && rawPage.prevPageId === input.newPrevPageId) {
      return { id: input.pageId }
    }

    // Cycle check: newParentId must not be a descendant of pageId
    await this.repo.assertNotReorderingIntoOwnDescendantPreTx(input.pageId, input.newParentId)

    // Map raw page to PageRowDto for the repo method
    const pageRow: PageRowDto = {
      id: rawPage.id,
      workspaceId: rawPage.workspaceId,
      createdById: rawPage.createdById,
      parentId: rawPage.parentId,
      prevPageId: rawPage.prevPageId,
      title: rawPage.title,
      icon: rawPage.icon,
      type: rawPage.type,
      content: rawPage.content,
      contentYjs: rawPage.contentYjs,
      deletedAt: rawPage.deletedAt,
    }

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
