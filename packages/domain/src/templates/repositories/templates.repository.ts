import { PageTemplateScope } from '@repo/db'
import type { Prisma } from '@repo/db'

import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type {
  CreateTemplateFromPageInput,
  TemplateContentDto,
  TemplateSummaryDto,
  UpdateTemplateInput,
} from '../dto/templates.dto.ts'

const SUMMARY_SELECT = {
  id: true,
  workspaceId: true,
  scope: true,
  title: true,
  description: true,
  icon: true,
  category: true,
  type: true,
  usageCount: true,
  createdAt: true,
  updatedAt: true,
} as const

/** Source page row needed to clone content into a template. */
export interface SourcePageDto {
  id: string
  workspaceId: string
  createdById: string | null
  title: string | null
  icon: string | null
  type: TemplateContentDto['type']
  content: Prisma.JsonValue | null
  contentYjs: Uint8Array<ArrayBuffer> | null
}

export class TemplateRepository {
  private readonly uow: UnitOfWork
  constructor(uow: UnitOfWork) {
    this.uow = uow
  }

  // ── Membership ──────────────────────────────────────────────────────────────

  async findMembership(
    userId: string,
    workspaceId: string,
  ): Promise<{ role: string } | null> {
    return this.uow.client().workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    })
  }

  // ── Source page (for createFromPage) ────────────────────────────────────────

  async findAccessiblePage(userId: string, pageId: string): Promise<SourcePageDto | null> {
    const row = await this.uow.client().page.findFirst({
      where: { id: pageId, workspace: { members: { some: { userId } } }, deletedAt: null },
      select: {
        id: true,
        workspaceId: true,
        createdById: true,
        title: true,
        icon: true,
        type: true,
        content: true,
        contentYjs: true,
      },
    })
    return row as SourcePageDto | null
  }

  // ── Search / list (summary projection) ──────────────────────────────────────

  /**
   * Fetch candidate templates for a workspace: its own WORKSPACE templates plus
   * all GLOBAL templates. Ranking/filtering by query is done in the service via
   * pure helpers so it stays unit-testable; the DB-side `contains` filter (when
   * a query is present) just narrows the candidate set.
   */
  async searchCandidates(
    workspaceId: string,
    query: string,
  ): Promise<TemplateSummaryDto[]> {
    const trimmed = query.trim()
    const textFilter: Prisma.PageTemplateWhereInput =
      trimmed === ''
        ? {}
        : {
            OR: [
              { title: { contains: trimmed, mode: 'insensitive' } },
              { description: { contains: trimmed, mode: 'insensitive' } },
            ],
          }
    const rows = await this.uow.client().pageTemplate.findMany({
      where: {
        deletedAt: null,
        AND: [
          textFilter,
          {
            OR: [
              { scope: PageTemplateScope.WORKSPACE, workspaceId },
              { scope: PageTemplateScope.GLOBAL },
            ],
          },
        ],
      },
      select: SUMMARY_SELECT,
    })
    return rows
  }

  async listByWorkspace(workspaceId: string): Promise<TemplateSummaryDto[]> {
    return this.uow.client().pageTemplate.findMany({
      where: { scope: PageTemplateScope.WORKSPACE, workspaceId, deletedAt: null },
      orderBy: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
      select: SUMMARY_SELECT,
    })
  }

  async listGlobal(): Promise<TemplateSummaryDto[]> {
    return this.uow.client().pageTemplate.findMany({
      where: { scope: PageTemplateScope.GLOBAL, deletedAt: null },
      orderBy: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
      select: SUMMARY_SELECT,
    })
  }

  // ── Read full content (for createPageFromTemplate) ──────────────────────────

  async findContent(templateId: string): Promise<TemplateContentDto | null> {
    const row = await this.uow.client().pageTemplate.findFirst({
      where: { id: templateId, deletedAt: null },
      select: {
        id: true,
        workspaceId: true,
        scope: true,
        title: true,
        icon: true,
        type: true,
        content: true,
        contentYjs: true,
      },
    })
    return row as TemplateContentDto | null
  }

  // ── Writes ──────────────────────────────────────────────────────────────────

  async createFromPage(
    actorUserId: string,
    input: CreateTemplateFromPageInput,
    source: SourcePageDto,
  ): Promise<{ id: string }> {
    const created = await this.uow.client().pageTemplate.create({
      data: {
        scope: input.scope,
        workspaceId: input.scope === PageTemplateScope.WORKSPACE ? input.workspaceId : null,
        title: input.title,
        description: input.description ?? null,
        icon: input.icon !== undefined ? input.icon : source.icon,
        category: input.category ?? null,
        type: source.type,
        content: source.content ?? undefined,
        contentYjs: source.contentYjs ?? undefined,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
      select: { id: true },
    })
    return created
  }

  async incrementUsage(templateId: string): Promise<void> {
    await this.uow.client().pageTemplate.update({
      where: { id: templateId },
      data: { usageCount: { increment: 1 } },
    })
  }

  async findForWrite(
    templateId: string,
  ): Promise<{ id: string; scope: PageTemplateScope; workspaceId: string | null } | null> {
    return this.uow.client().pageTemplate.findFirst({
      where: { id: templateId, deletedAt: null },
      select: { id: true, scope: true, workspaceId: true },
    })
  }

  async update(
    actorUserId: string,
    input: UpdateTemplateInput,
  ): Promise<{ id: string }> {
    const data: Prisma.PageTemplateUpdateInput = { updatedById: actorUserId }
    if (input.title !== undefined) data.title = input.title
    if (input.description !== undefined) data.description = input.description
    if (input.icon !== undefined) data.icon = input.icon
    if (input.category !== undefined) data.category = input.category
    return this.uow.client().pageTemplate.update({
      where: { id: input.templateId },
      data,
      select: { id: true },
    })
  }

  async softDelete(actorUserId: string, templateId: string): Promise<{ id: string }> {
    return this.uow.client().pageTemplate.update({
      where: { id: templateId },
      data: { deletedAt: new Date(), updatedById: actorUserId },
      select: { id: true },
    })
  }
}
