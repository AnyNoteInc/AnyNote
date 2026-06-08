import { forbidden, notFound, badRequest } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type {
  CreatePageFromTemplateInput,
  CreatePageFromTemplateResultDto,
  CreateTemplateFromPageInput,
  CreateTemplateResultDto,
  DeleteTemplateInput,
  DeleteTemplateResultDto,
  GetTemplateInput,
  ListMarketplaceInput,
  MarketplaceResultDto,
  TemplateDetailDto,
  TemplateTagDto,
  UpdateTemplateInput,
} from '../dto/templates.dto.ts'
import type {
  TemplateDetailRow,
  TemplateRepository,
} from '../repositories/templates.repository.ts'
import {
  canCreateGlobalTemplate,
  canCreateWorkspaceTemplate,
  canEditGlobalTemplate,
  canEditWorkspaceTemplate,
} from '../templates.helpers.ts'
import { extractFileIdsFromContent } from '../templates.files.ts'

export class TemplateService {
  private readonly repo: TemplateRepository
  private readonly uow: UnitOfWork
  constructor(repo: TemplateRepository, uow: UnitOfWork) {
    this.repo = repo
    this.uow = uow
  }

  private async assertMembership(userId: string, workspaceId: string): Promise<{ role: string }> {
    const member = await this.repo.findMembership(userId, workspaceId)
    if (!member) throw forbidden('Вы не являетесь участником воркспейса')
    return member
  }

  private async assertTagsExist(tagIds: string[]): Promise<void> {
    if (tagIds.length === 0) return
    const found = await this.repo.countExistingTags(tagIds)
    if (found !== tagIds.length) throw badRequest('Указан несуществующий тег')
  }

  /**
   * Authorise read access to a template + compute `canEdit`.
   * - WORKSPACE: requires membership of its workspace; canEdit by creator/role.
   * - GLOBAL: viewable by any authenticated user (no membership of the system
   *   workspace required); canEdit only by its creator.
   */
  private async authorizeTemplate(
    actorUserId: string,
    detail: TemplateDetailRow,
  ): Promise<boolean> {
    if (detail.scope === 'GLOBAL') {
      return canEditGlobalTemplate({ actorUserId, createdById: detail.createdById })
    }
    const member = await this.assertMembership(actorUserId, detail.workspaceId)
    return canEditWorkspaceTemplate({
      actorUserId,
      createdById: detail.createdById,
      role: member.role,
    })
  }

  // ── Reads ─────────────────────────────────────────────────────────────────────

  async listTags(): Promise<TemplateTagDto[]> {
    return this.repo.listTags()
  }

  async listMarketplace(
    actorUserId: string,
    input: ListMarketplaceInput,
  ): Promise<MarketplaceResultDto> {
    await this.assertMembership(actorUserId, input.workspaceId)
    const limit = input.sectionLimit ?? 8
    const [tags, candidates] = await Promise.all([
      this.repo.listTags(),
      this.repo.marketplaceCandidates({
        workspaceId: input.workspaceId,
        tagId: input.tagId,
        query: input.query,
      }),
    ])
    const workspaceTemplates = candidates.filter((t) => t.scope === 'WORKSPACE').slice(0, limit)
    const popularTemplates = [...candidates]
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, limit)
    const allTemplates = candidates.slice(0, limit)
    return { tags, workspaceTemplates, popularTemplates, allTemplates }
  }

  async getTemplate(actorUserId: string, input: GetTemplateInput): Promise<TemplateDetailDto> {
    const detail = await this.repo.findTemplateDetail(input.templateId)
    if (!detail) throw notFound('Шаблон не найден')
    const canEdit = await this.authorizeTemplate(actorUserId, detail)
    return {
      id: detail.id,
      workspaceId: detail.workspaceId,
      scope: detail.scope,
      title: detail.title ?? '',
      description: detail.description,
      icon: detail.icon,
      type: detail.type,
      contentYjs: detail.contentYjs
        ? Buffer.from(detail.contentYjs).toString('base64')
        : null,
      createdById: detail.createdById,
      canEdit,
    }
  }

  // ── Writes ──────────────────────────────────────────────────────────────────

  /** Publish an existing page AS a template: deep-copy its content into a new
   *  template page (WORKSPACE: same workspace; GLOBAL: the system workspace). */
  async createFromPage(
    actorUserId: string,
    input: CreateTemplateFromPageInput,
  ): Promise<CreateTemplateResultDto> {
    const page = await this.repo.findAccessiblePage(actorUserId, input.pageId)
    if (!page) throw notFound('Страница не найдена')
    if (page.workspaceId !== input.workspaceId) {
      throw badRequest('Страница не принадлежит этому воркспейсу')
    }
    await this.assertTagsExist(input.tagIds ?? [])

    const member = await this.repo.findMembership(actorUserId, input.workspaceId)
    const isPageCreator = page.createdById === actorUserId

    if (input.scope === 'GLOBAL') {
      if (!canCreateGlobalTemplate({ role: member?.role })) {
        throw forbidden('Недостаточно прав для создания шаблона')
      }
    } else if (!canCreateWorkspaceTemplate({ isPageCreator, role: member?.role })) {
      throw forbidden('Недостаточно прав для создания шаблона')
    }

    return this.uow.transaction(async () => {
      let hostWorkspaceId = input.workspaceId
      if (input.scope === 'GLOBAL') {
        const systemId = await this.repo.findSystemWorkspaceId()
        if (!systemId) {
          throw badRequest(
            'Системный воркспейс для глобальных шаблонов не найден (slug: system-templates)',
          )
        }
        hostWorkspaceId = systemId
      }

      const created = await this.repo.createTemplatePage(actorUserId, {
        workspaceId: hostWorkspaceId,
        scope: input.scope,
        title: input.title,
        icon: input.icon !== undefined ? input.icon : page.icon,
        description: input.description ?? null,
        previewColor: null,
        content: page.content,
        contentYjs: page.contentYjs,
        type: page.type,
      })
      await this.repo.linkTags(created.id, input.tagIds ?? [])

      if (input.scope === 'GLOBAL') {
        await this.repo.setFilesPublic(extractFileIdsFromContent(page.content))
      }

      return created
    })
  }

  /** "Use template": deep-copy a template page into a NEW independent page. */
  async createPageFromTemplate(
    actorUserId: string,
    input: CreatePageFromTemplateInput,
  ): Promise<CreatePageFromTemplateResultDto> {
    const detail = await this.repo.findTemplateDetail(input.templateId)
    if (!detail) throw notFound('Шаблон не найден')
    // Same access rule as getTemplate: WORKSPACE needs membership; GLOBAL is open.
    await this.authorizeTemplate(actorUserId, detail)

    const source = await this.repo.findTemplateContentForCopy(input.templateId)
    if (!source) throw notFound('Содержимое шаблона не найдено')

    await this.assertMembership(actorUserId, input.workspaceId)

    const title = input.title?.trim() ? input.title.trim() : (detail.title ?? 'Без названия')

    return this.uow.transaction(async () => {
      const created = await this.repo.createPageFromTemplatePage(actorUserId, {
        templatePageId: input.templateId,
        workspaceId: input.workspaceId,
        parentId: input.parentId,
        title,
        content: source.content,
        contentYjs: source.contentYjs,
        icon: source.icon,
        type: source.type,
      })
      await this.repo.incrementUsage(input.templateId)
      return created
    })
  }

  async update(
    actorUserId: string,
    input: UpdateTemplateInput,
  ): Promise<CreateTemplateResultDto> {
    const detail = await this.repo.findTemplateDetail(input.templateId)
    if (!detail) throw notFound('Шаблон не найден')
    const canEdit = await this.authorizeTemplate(actorUserId, detail)
    if (!canEdit) throw forbidden('Недостаточно прав для управления шаблоном')
    await this.assertTagsExist(input.tagIds ?? [])

    return this.uow.transaction(async () => {
      const updated = await this.repo.updateTemplatePage(actorUserId, {
        pageId: input.templateId,
        title: input.title,
        icon: input.icon,
        description: input.description,
      })
      if (input.tagIds !== undefined) {
        await this.repo.linkTags(input.templateId, input.tagIds)
      }
      if (detail.scope === 'GLOBAL') {
        const content = await this.repo.findTemplateContent(input.templateId)
        await this.repo.setFilesPublic(extractFileIdsFromContent(content))
      }
      return updated
    })
  }

  async delete(
    actorUserId: string,
    input: DeleteTemplateInput,
  ): Promise<DeleteTemplateResultDto> {
    const detail = await this.repo.findTemplateDetail(input.templateId)
    if (!detail) throw notFound('Шаблон не найден')
    const canEdit = await this.authorizeTemplate(actorUserId, detail)
    if (!canEdit) throw forbidden('Недостаточно прав для управления шаблоном')
    await this.uow.transaction(() => this.repo.softDeleteTemplatePage(input.templateId))
    return { count: 1 }
  }
}
