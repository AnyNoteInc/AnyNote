import { PageTemplateScope, PageType } from '@repo/db'
import type { Prisma } from '@repo/db'

import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type {
  CreateTemplateFromPageInput,
  CreateTemplateInput,
  TemplateContentDto,
  TemplateDetailDto,
  TemplateSummaryDto,
  TemplateTagDto,
  UpdateTemplateInput,
} from '../dto/templates.dto.ts'

const SUMMARY_SELECT = {
  id: true,
  workspaceId: true,
  scope: true,
  title: true,
  description: true,
  icon: true,
  type: true,
  usageCount: true,
  averageRating: true,
  ratingCount: true,
  previewColor: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { firstName: true, lastName: true } },
  tags: {
    select: { tag: { select: { id: true, slug: true, name: true, icon: true, position: true } } },
  },
} as const

function toSummary(row: {
  id: string
  workspaceId: string | null
  scope: PageTemplateScope
  title: string
  description: string | null
  icon: string | null
  type: PageType
  usageCount: number
  averageRating: number
  ratingCount: number
  previewColor: string | null
  createdById: string | null
  createdAt: Date
  updatedAt: Date
  createdBy: { firstName: string | null; lastName: string | null } | null
  tags: { tag: { id: string; slug: string; name: string; icon: string; position: number } }[]
}): TemplateSummaryDto {
  const fullName = [row.createdBy?.firstName, row.createdBy?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim()
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    scope: row.scope,
    title: row.title,
    description: row.description,
    icon: row.icon,
    type: row.type,
    usageCount: row.usageCount,
    averageRating: row.averageRating,
    ratingCount: row.ratingCount,
    previewColor: row.previewColor,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    tags: row.tags.map((t) => t.tag).sort((a, b) => a.position - b.position),
    author: { name: fullName || 'AnyNote' },
  }
}

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
    return rows.map(toSummary)
  }

  async listByWorkspace(workspaceId: string): Promise<TemplateSummaryDto[]> {
    const rows = await this.uow.client().pageTemplate.findMany({
      where: { scope: PageTemplateScope.WORKSPACE, workspaceId, deletedAt: null },
      orderBy: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
      select: SUMMARY_SELECT,
    })
    return rows.map(toSummary)
  }

  async listGlobal(): Promise<TemplateSummaryDto[]> {
    const rows = await this.uow.client().pageTemplate.findMany({
      where: { scope: PageTemplateScope.GLOBAL, deletedAt: null },
      orderBy: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
      select: SUMMARY_SELECT,
    })
    return rows.map(toSummary)
  }

  // ── Tag queries ──────────────────────────────────────────────────────────────

  async listTags(): Promise<TemplateTagDto[]> {
    return this.uow.client().templateTag.findMany({
      orderBy: { position: 'asc' },
      select: { id: true, slug: true, name: true, icon: true, position: true },
    })
  }

  /** Candidate rows for the marketplace: this workspace's templates + all globals,
   *  optionally filtered by tag and/or text. Sectioning is done in the service. */
  async marketplaceCandidates(args: {
    workspaceId: string
    tagId?: string | null
    query?: string
  }): Promise<TemplateSummaryDto[]> {
    const trimmed = (args.query ?? '').trim()
    const where: Prisma.PageTemplateWhereInput = {
      deletedAt: null,
      AND: [
        {
          OR: [
            { scope: PageTemplateScope.WORKSPACE, workspaceId: args.workspaceId },
            { scope: PageTemplateScope.GLOBAL },
          ],
        },
        ...(args.tagId ? [{ tags: { some: { tagId: args.tagId } } }] : []),
        ...(trimmed
          ? [
              {
                OR: [
                  { title: { contains: trimmed, mode: 'insensitive' as const } },
                  { description: { contains: trimmed, mode: 'insensitive' as const } },
                ],
              },
            ]
          : []),
      ],
    }
    const rows = await this.uow.client().pageTemplate.findMany({
      where,
      orderBy: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
      select: SUMMARY_SELECT,
    })
    return rows.map(toSummary)
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
    backingPageId: string,
  ): Promise<{ id: string }> {
    const created = await this.uow.client().pageTemplate.create({
      data: {
        scope: input.scope,
        workspaceId: input.scope === PageTemplateScope.WORKSPACE ? input.workspaceId : null,
        title: input.title,
        description: input.description ?? null,
        icon: input.icon !== undefined ? input.icon : source.icon,
        type: source.type,
        content: source.content ?? undefined,
        contentYjs: source.contentYjs ?? undefined,
        backingPageId,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
      select: { id: true },
    })
    await this.linkTags(created.id, input.tagIds ?? [])
    return created
  }

  async create(
    actorUserId: string,
    input: CreateTemplateInput,
    backingPageId: string,
  ): Promise<{ id: string }> {
    const created = await this.uow.client().pageTemplate.create({
      data: {
        scope: PageTemplateScope.WORKSPACE,
        workspaceId: input.workspaceId,
        title: input.title,
        description: input.description ?? null,
        icon: input.icon ?? null,
        type: PageType.TEXT,
        backingPageId,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
      select: { id: true },
    })
    await this.linkTags(created.id, input.tagIds ?? [])
    return created
  }

  private async linkTags(templateId: string, tagIds: string[]): Promise<void> {
    await this.uow.client().pageTemplateTag.deleteMany({ where: { templateId } })
    if (tagIds.length === 0) return
    await this.uow.client().pageTemplateTag.createMany({
      data: tagIds.map((tagId) => ({ templateId, tagId })),
      skipDuplicates: true,
    })
  }

  /** Validate that every id refers to a seeded tag; returns the valid subset count. */
  async countExistingTags(tagIds: string[]): Promise<number> {
    if (tagIds.length === 0) return 0
    return this.uow.client().templateTag.count({ where: { id: { in: tagIds } } })
  }

  async incrementUsage(templateId: string): Promise<void> {
    await this.uow.client().pageTemplate.update({
      where: { id: templateId },
      data: { usageCount: { increment: 1 } },
    })
  }

  async findForWrite(
    templateId: string,
  ): Promise<{ id: string; scope: PageTemplateScope; workspaceId: string | null; createdById: string | null } | null> {
    return this.uow.client().pageTemplate.findFirst({
      where: { id: templateId, deletedAt: null },
      select: { id: true, scope: true, workspaceId: true, createdById: true },
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
    const updated = await this.uow.client().pageTemplate.update({
      where: { id: input.templateId },
      data,
      select: { id: true },
    })
    if (input.tagIds !== undefined) {
      await this.linkTags(input.templateId, input.tagIds)
    }
    return updated
  }

  async softDelete(actorUserId: string, templateId: string): Promise<{ id: string }> {
    return this.uow.client().pageTemplate.update({
      where: { id: templateId },
      data: { deletedAt: new Date(), updatedById: actorUserId },
      select: { id: true },
    })
  }

  async findDetail(templateId: string): Promise<TemplateDetailDto | null> {
    const row = await this.uow.client().pageTemplate.findFirst({
      where: { id: templateId, deletedAt: null },
      select: {
        id: true,
        workspaceId: true,
        scope: true,
        title: true,
        description: true,
        icon: true,
        type: true,
        content: true,
        backingPageId: true,
      },
    })
    return row as TemplateDetailDto | null
  }

  async updateContent(
    actorUserId: string,
    templateId: string,
    content: Prisma.InputJsonValue,
    contentYjs: Uint8Array<ArrayBuffer> | null,
  ): Promise<{ id: string }> {
    return this.uow.client().pageTemplate.update({
      where: { id: templateId },
      data: {
        content,
        contentYjs: contentYjs ?? undefined,
        updatedById: actorUserId,
      },
      select: { id: true },
    })
  }
}
