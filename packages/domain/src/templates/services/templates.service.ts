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
  ListMarketplaceInput,
  MarketplaceResultDto,
  SearchTemplatesResult,
  TemplateBackingPageDto,
  TemplateDetailDto,
  TemplateSummaryDto,
  TemplateTagDto,
  UpdateTemplateContentInput,
  UpdateTemplateInput,
} from '../dto/templates.dto.ts'
import type { TemplateRepository } from '../repositories/templates.repository.ts'
import {
  buildCreatePageFromTemplatePayload,
  canCreateGlobalTemplate,
  canCreateWorkspaceTemplate,
  canEditGlobalTemplate,
  canEditWorkspaceTemplate,
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

  private async assertTagsExist(tagIds: string[]): Promise<void> {
    if (tagIds.length === 0) return
    const found = await this.repo.countExistingTags(tagIds)
    if (found !== tagIds.length) throw badRequest('Указан несуществующий тег')
  }

  private async createBackingPage(
    actorUserId: string,
    workspaceId: string,
    source?: { content?: unknown; contentYjs?: Uint8Array<ArrayBuffer> | null; icon?: string | null },
  ): Promise<string> {
    // parentId MUST stay null: PageService.create runs its parent-existence
    // check BEFORE opening its own transaction. We call this from inside the
    // template transaction, so a non-null parentId would run that check on the
    // active tx and dissolve the fence. Backing pages are always top-level.
    const created = await this.pages.create(actorUserId, {
      workspaceId,
      parentId: null,
      title: 'Шаблон',
      type: 'TEXT',
      isTemplateBacking: true,
      content: (source?.content as never) ?? undefined,
      contentYjs: source?.contentYjs ?? undefined,
    })
    return created.id
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
    const workspaceTemplates = candidates
      .filter((t) => t.scope === 'WORKSPACE')
      .slice(0, limit)
    const popularTemplates = [...candidates]
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, limit)
    const allTemplates = candidates.slice(0, limit)
    return { tags, workspaceTemplates, popularTemplates, allTemplates }
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
    let canEdit: boolean
    if (template.scope === 'GLOBAL') {
      canEdit = canEditGlobalTemplate({ actorUserId, createdById: template.createdById })
    } else {
      const member = await this.repo.findMembership(actorUserId, input.workspaceId)
      canEdit = canEditWorkspaceTemplate({
        actorUserId,
        createdById: template.createdById,
        role: member?.role,
      })
    }
    return { ...template, canEdit }
  }

  /**
   * Return the content source for a template the actor is authorised to access.
   * Access is granted iff `getById` would succeed (same checks).
   *
   * Two cases:
   *  - The template has a backing page → return it (live, collaborative,
   *    `editable: true`). Bypasses the normal page-workspace membership filter
   *    so GLOBAL templates whose backing page lives in another workspace stay
   *    reachable.
   *  - No backing page (e.g. seeded GLOBAL/WORKSPACE templates) → fall back to
   *    the template's own content snapshot, served read-only (`editable: false`)
   *    since no live collaboration doc exists.
   */
  async getBackingPage(
    actorUserId: string,
    input: GetTemplateInput,
  ): Promise<TemplateBackingPageDto> {
    // Re-use getById for the access check — it throws if the actor can't see
    // the template, and gives us backingPageId for free.
    const template = await this.getById(actorUserId, input)
    if (template.backingPageId) {
      const page = await this.repo.findBackingPageForTemplate(input.templateId)
      if (page) return page
    }
    // Fallback: render the template's own content snapshot, read-only.
    const content = await this.repo.findContent(input.templateId)
    if (!content) throw notFound('Содержимое шаблона не найдено')
    return {
      id: input.templateId,
      type: content.type,
      contentYjs: content.contentYjs
        ? Buffer.from(content.contentYjs).toString('base64')
        : null,
      editable: false,
    }
  }

  // ── Writes ──────────────────────────────────────────────────────────────────

  async create(
    actorUserId: string,
    input: CreateTemplateInput,
  ): Promise<CreateTemplateResultDto> {
    await this.assertMembership(actorUserId, input.workspaceId)
    await this.assertTagsExist(input.tagIds ?? [])
    return this.uow.transaction(async () => {
      const backingPageId = await this.createBackingPage(actorUserId, input.workspaceId)
      return this.repo.create(actorUserId, input, backingPageId)
    })
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
      const backingPageId = await this.createBackingPage(actorUserId, input.workspaceId, {
        content: page.content,
        contentYjs: page.contentYjs,
        icon: page.icon,
      })
      return this.repo.createFromPage(actorUserId, input, page, backingPageId)
    })
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

    // Prefer the backing page's live content (collaborative edits land there,
    // not on the PageTemplate snapshot). Seeded GLOBAL templates have no
    // backing page and fall back to the template's own contentYjs.
    let sourceContent: Prisma.JsonValue | null = template.content
    let sourceContentYjs = template.contentYjs
    if (template.backingPageId) {
      const backing = await this.repo.findBackingPageContent(template.backingPageId)
      if (backing) {
        sourceContent = backing.content
        sourceContentYjs = backing.contentYjs
      }
    }

    const payload = buildCreatePageFromTemplatePayload(
      { ...template, content: sourceContent, contentYjs: sourceContentYjs },
      {
        workspaceId: input.workspaceId,
        parentId: input.parentId,
        title: input.title,
      },
    )

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
    await this.assertTemplateWriteAccess(actorUserId, template, input.workspaceId)
    await this.assertTagsExist(input.tagIds ?? [])
    return this.uow.transaction(() => this.repo.update(actorUserId, input))
  }

  async updateContent(
    actorUserId: string,
    input: UpdateTemplateContentInput,
    contentYjs: Uint8Array<ArrayBuffer> | null,
  ): Promise<CreateTemplateResultDto> {
    const template = await this.repo.findForWrite(input.templateId)
    if (!template) throw notFound('Шаблон не найден')
    await this.assertTemplateWriteAccess(actorUserId, template, input.workspaceId)
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
    await this.assertTemplateWriteAccess(actorUserId, template, input.workspaceId)
    await this.uow.transaction(async () => {
      await this.repo.softDelete(actorUserId, input.templateId)
      if (template.backingPageId) {
        await this.repo.softDeleteBackingPage(template.backingPageId)
      }
    })
    return { count: 1 }
  }

  private async assertTemplateWriteAccess(
    actorUserId: string,
    template: { scope: PageTemplateScope; workspaceId: string | null; createdById: string | null; backingPageId?: string | null },
    workspaceId: string,
  ): Promise<void> {
    if (template.scope === 'GLOBAL') {
      if (!canEditGlobalTemplate({ actorUserId, createdById: template.createdById })) {
        throw forbidden('Изменять глобальный шаблон может только его создатель')
      }
      return
    }
    if (template.workspaceId !== workspaceId) throw notFound('Шаблон не найден')
    const member = await this.repo.findMembership(actorUserId, workspaceId)
    if (
      !canEditWorkspaceTemplate({
        actorUserId,
        createdById: template.createdById,
        role: member?.role,
      })
    ) {
      throw forbidden('Недостаточно прав для управления шаблоном')
    }
  }
}
