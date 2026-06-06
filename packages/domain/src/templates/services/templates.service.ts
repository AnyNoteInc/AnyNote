import type { PageTemplateScope, Prisma } from '@repo/db'

import { badRequest, forbidden, notFound } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { PageService } from '../../pages/index.ts'
import type {
  CreatePageFromTemplateInput,
  CreatePageFromTemplateResultDto,
  CreateTemplateFromPageInput,
  CreateTemplateInput,
  CreateTemplateResultDto,
  DeleteTemplateInput,
  DeleteTemplateResultDto,
  GetTemplateInput,
  SearchTemplatesResult,
  TemplateDetailDto,
  TemplateSummaryDto,
  UpdateTemplateContentInput,
  UpdateTemplateInput,
} from '../dto/templates.dto.ts'
import type { TemplateRepository } from '../repositories/templates.repository.ts'
import {
  buildCreatePageFromTemplatePayload,
  canCreateGlobalTemplate,
  canCreateWorkspaceTemplate,
  groupTemplatesByScope,
  sortTemplatesByRelevance,
} from '../templates.helpers.ts'

const DEFAULT_SEARCH_LIMIT = 20

export class TemplateService {
  private readonly repo: TemplateRepository
  private readonly uow: UnitOfWork
  private readonly pages: PageService
  constructor(repo: TemplateRepository, uow: UnitOfWork, pages: PageService) {
    this.repo = repo
    this.uow = uow
    this.pages = pages
  }

  private async assertMembership(userId: string, workspaceId: string): Promise<{ role: string }> {
    const member = await this.repo.findMembership(userId, workspaceId)
    if (!member) throw forbidden('Вы не являетесь участником воркспейса')
    return member
  }

  // ── Reads ─────────────────────────────────────────────────────────────────────

  async search(
    actorUserId: string,
    input: { workspaceId: string; query: string; limit?: number },
  ): Promise<SearchTemplatesResult> {
    await this.assertMembership(actorUserId, input.workspaceId)
    const limit = input.limit ?? DEFAULT_SEARCH_LIMIT

    const candidates = await this.repo.searchCandidates(input.workspaceId, input.query)
    const ranked = sortTemplatesByRelevance(candidates, input.query)
    const { workspaceTemplates, globalTemplates } = groupTemplatesByScope(ranked)
    return {
      workspaceTemplates: workspaceTemplates.slice(0, limit),
      globalTemplates: globalTemplates.slice(0, limit),
    }
  }

  async listByWorkspace(
    actorUserId: string,
    input: { workspaceId: string },
  ): Promise<TemplateSummaryDto[]> {
    await this.assertMembership(actorUserId, input.workspaceId)
    return this.repo.listByWorkspace(input.workspaceId)
  }

  /** Global templates are visible to any authenticated user. */
  async listGlobal(): Promise<TemplateSummaryDto[]> {
    return this.repo.listGlobal()
  }

  async getById(
    actorUserId: string,
    input: GetTemplateInput,
  ): Promise<TemplateDetailDto> {
    await this.assertMembership(actorUserId, input.workspaceId)
    const template = await this.repo.findDetail(input.templateId)
    if (!template) throw notFound('Шаблон не найден')
    if (template.scope === 'WORKSPACE' && template.workspaceId !== input.workspaceId) {
      throw notFound('Шаблон не найден')
    }
    return template
  }

  // ── Writes ──────────────────────────────────────────────────────────────────

  async create(
    actorUserId: string,
    input: CreateTemplateInput,
  ): Promise<CreateTemplateResultDto> {
    const member = await this.assertMembership(actorUserId, input.workspaceId)
    if (!canCreateWorkspaceTemplate({ isPageCreator: false, role: member.role })) {
      throw forbidden('Недостаточно прав для создания шаблона')
    }
    return this.uow.transaction(() => this.repo.create(actorUserId, input))
  }

  async createFromPage(
    actorUserId: string,
    input: CreateTemplateFromPageInput,
  ): Promise<CreateTemplateResultDto> {
    const page = await this.repo.findAccessiblePage(actorUserId, input.pageId)
    if (!page) throw notFound('Страница не найдена')
    if (page.workspaceId !== input.workspaceId) {
      throw badRequest('Страница не принадлежит этому воркспейсу')
    }

    const member = await this.repo.findMembership(actorUserId, input.workspaceId)
    const isPageCreator = page.createdById === actorUserId

    if (input.scope === 'GLOBAL') {
      if (!canCreateGlobalTemplate({ role: member?.role })) {
        throw forbidden(
          'Создание глобальных шаблонов недоступно. Глобальные шаблоны добавляются администратором.',
        )
      }
    } else if (!canCreateWorkspaceTemplate({ isPageCreator, role: member?.role })) {
      throw forbidden('Недостаточно прав для создания шаблона')
    }

    return this.uow.transaction(() => this.repo.createFromPage(actorUserId, input, page))
  }

  async createPageFromTemplate(
    actorUserId: string,
    input: CreatePageFromTemplateInput,
  ): Promise<CreatePageFromTemplateResultDto> {
    const member = await this.assertMembership(actorUserId, input.workspaceId)

    const template = await this.repo.findContent(input.templateId)
    if (!template) throw notFound('Шаблон не найден')

    // WORKSPACE templates are only usable inside their own workspace; GLOBAL
    // templates are usable by any workspace member.
    if (
      template.scope === 'WORKSPACE' &&
      template.workspaceId !== input.workspaceId
    ) {
      throw notFound('Шаблон не найден')
    }

    if (!canCreateWorkspaceTemplate({ isPageCreator: false, role: member.role })) {
      throw forbidden('Недостаточно прав для создания страницы')
    }

    const payload = buildCreatePageFromTemplatePayload(template, {
      workspaceId: input.workspaceId,
      parentId: input.parentId,
      title: input.title,
    })

    // Reuse the page service so positioning (linked list), the outbox event,
    // and kanban seeding all run through the one established path. Increment
    // usageCount in the same transaction so usage tracking can't drift.
    return this.uow.transaction(async () => {
      const created = await this.pages.create(actorUserId, payload)
      await this.repo.incrementUsage(input.templateId)
      return created
    })
  }

  async update(
    actorUserId: string,
    input: UpdateTemplateInput,
  ): Promise<CreateTemplateResultDto> {
    const template = await this.repo.findForWrite(input.templateId)
    if (!template) throw notFound('Шаблон не найден')
    await this.assertWriteAccess(actorUserId, template, input.workspaceId)
    return this.uow.transaction(() => this.repo.update(actorUserId, input))
  }

  async updateContent(
    actorUserId: string,
    input: UpdateTemplateContentInput,
    contentYjs: Uint8Array<ArrayBuffer> | null,
  ): Promise<CreateTemplateResultDto> {
    const template = await this.repo.findForWrite(input.templateId)
    if (!template) throw notFound('Шаблон не найден')
    await this.assertWriteAccess(actorUserId, template, input.workspaceId)
    return this.uow.transaction(() =>
      this.repo.updateContent(
        actorUserId,
        input.templateId,
        input.content as Prisma.InputJsonValue,
        contentYjs,
      ),
    )
  }

  async delete(
    actorUserId: string,
    input: DeleteTemplateInput,
  ): Promise<DeleteTemplateResultDto> {
    const template = await this.repo.findForWrite(input.templateId)
    if (!template) throw notFound('Шаблон не найден')
    await this.assertWriteAccess(actorUserId, template, input.workspaceId)
    await this.uow.transaction(() => this.repo.softDelete(actorUserId, input.templateId))
    return { count: 1 }
  }

  /**
   * Mutating a GLOBAL template is never allowed for normal users (no global
   * admin). A WORKSPACE template may be managed by a writable member of its
   * owning workspace.
   */
  private async assertWriteAccess(
    actorUserId: string,
    template: { scope: PageTemplateScope; workspaceId: string | null },
    workspaceId: string,
  ): Promise<void> {
    if (template.scope === 'GLOBAL') {
      throw forbidden('Глобальные шаблоны нельзя изменять')
    }
    if (template.workspaceId !== workspaceId) {
      throw notFound('Шаблон не найден')
    }
    const member = await this.repo.findMembership(actorUserId, workspaceId)
    if (!canCreateWorkspaceTemplate({ isPageCreator: false, role: member?.role })) {
      throw forbidden('Недостаточно прав для управления шаблоном')
    }
  }
}
