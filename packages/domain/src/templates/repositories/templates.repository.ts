import { PageTemplateScope } from '@repo/db'
import type { PageType, Prisma } from '@repo/db'

import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { PageService } from '../../pages/index.ts'
import type { TemplateSummaryDto, TemplateTagDto } from '../dto/templates.dto.ts'

// ── templateMeta JSON shape ─────────────────────────────────────────────────────

interface TemplateMeta {
  description?: string | null
  previewColor?: string | null
}

function readMeta(meta: Prisma.JsonValue | null): TemplateMeta {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {}
  const m = meta as Record<string, unknown>
  return {
    description: typeof m.description === 'string' ? m.description : null,
    previewColor: typeof m.previewColor === 'string' ? m.previewColor : null,
  }
}

// ── Summary projection (marketplace cards) ──────────────────────────────────────

const SUMMARY_SELECT = {
  id: true,
  workspaceId: true,
  isTemplate: true,
  title: true,
  icon: true,
  type: true,
  usageCount: true,
  averageRating: true,
  ratingCount: true,
  templateMeta: true,
  content: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { firstName: true, lastName: true, email: true } },
  templateTags: {
    select: { tag: { select: { id: true, slug: true, name: true, icon: true, position: true } } },
  },
} as const

function toSummary(row: {
  id: string
  workspaceId: string | null
  isTemplate: PageTemplateScope | null
  title: string | null
  icon: string | null
  type: PageType
  usageCount: number
  averageRating: number
  ratingCount: number
  templateMeta: Prisma.JsonValue | null
  content: Prisma.JsonValue | null
  createdById: string | null
  createdAt: Date
  updatedAt: Date
  createdBy: { firstName: string | null; lastName: string | null; email: string | null } | null
  templateTags: { tag: { id: string; slug: string; name: string; icon: string; position: number } }[]
}): TemplateSummaryDto {
  const meta = readMeta(row.templateMeta)
  const fullName = [row.createdBy?.firstName, row.createdBy?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim()
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    // A summary row is only ever fetched with `isTemplate != null`; coalesce to
    // satisfy the non-null DTO field.
    scope: row.isTemplate ?? PageTemplateScope.WORKSPACE,
    title: row.title ?? '',
    description: meta.description ?? null,
    icon: row.icon,
    type: row.type,
    usageCount: row.usageCount,
    averageRating: row.averageRating,
    ratingCount: row.ratingCount,
    previewColor: meta.previewColor ?? null,
    previewContent: row.content,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    tags: row.templateTags.map((t) => t.tag).sort((a, b) => a.position - b.position),
    author: { name: fullName || row.createdBy?.email || 'AnyNote' },
  }
}

// ── Detail row (management editor) ──────────────────────────────────────────────

export interface TemplateDetailRow {
  id: string
  workspaceId: string
  scope: PageTemplateScope
  title: string | null
  icon: string | null
  type: PageType
  contentYjs: Uint8Array<ArrayBuffer> | null
  description: string | null
  createdById: string | null
}

/** Content needed to deep-copy a template page into a new page. */
export interface TemplateContentRow {
  content: Prisma.JsonValue | null
  contentYjs: Uint8Array<ArrayBuffer> | null
  icon: string | null
  type: PageType
}

/** Source page row needed to clone content into a template. */
export interface SourcePageDto {
  id: string
  workspaceId: string
  createdById: string | null
  title: string | null
  icon: string | null
  type: PageType
  content: Prisma.JsonValue | null
  contentYjs: Uint8Array<ArrayBuffer> | null
}

export class TemplateRepository {
  private readonly uow: UnitOfWork
  private readonly pages: PageService
  constructor(uow: UnitOfWork, pages: PageService) {
    this.uow = uow
    this.pages = pages
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

  /** Resolve the seeded system workspace that hosts GLOBAL templates. */
  async findSystemWorkspaceId(): Promise<string | null> {
    const ws = await this.uow.client().workspace.findFirst({
      where: { slug: 'system-templates' },
      select: { id: true },
    })
    return ws?.id ?? null
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

  // ── Marketplace candidates (summary projection) ─────────────────────────────

  /** Candidate template pages for the marketplace: this workspace's WORKSPACE
   *  templates + all GLOBAL templates, optionally filtered by tag and/or text.
   *  Sectioning is done in the service. */
  async marketplaceCandidates(args: {
    workspaceId: string
    tagId?: string | null
    query?: string
  }): Promise<TemplateSummaryDto[]> {
    const trimmed = (args.query ?? '').trim()
    const where: Prisma.PageWhereInput = {
      isTemplate: { not: null },
      deletedAt: null,
      AND: [
        {
          OR: [
            { isTemplate: PageTemplateScope.WORKSPACE, workspaceId: args.workspaceId },
            { isTemplate: PageTemplateScope.GLOBAL },
          ],
        },
        ...(args.tagId ? [{ templateTags: { some: { tagId: args.tagId } } }] : []),
        ...(trimmed
          ? [{ title: { contains: trimmed, mode: 'insensitive' as const } }]
          : []),
      ],
    }
    const rows = await this.uow.client().page.findMany({
      where,
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

  /** Validate that every id refers to a seeded tag; returns the valid subset count. */
  async countExistingTags(tagIds: string[]): Promise<number> {
    if (tagIds.length === 0) return 0
    return this.uow.client().templateTag.count({ where: { id: { in: tagIds } } })
  }

  // ── Detail / content reads ──────────────────────────────────────────────────

  /** Fetch a template page's metadata + Yjs doc for the management editor.
   *  Returns null if not found or not a template. */
  async findTemplateDetail(templateId: string): Promise<TemplateDetailRow | null> {
    const row = await this.uow.client().page.findFirst({
      where: { id: templateId, isTemplate: { not: null }, deletedAt: null },
      select: {
        id: true,
        workspaceId: true,
        isTemplate: true,
        title: true,
        icon: true,
        type: true,
        contentYjs: true,
        templateMeta: true,
        createdById: true,
      },
    })
    if (!row || row.isTemplate === null) return null
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      scope: row.isTemplate,
      title: row.title,
      icon: row.icon,
      type: row.type,
      contentYjs: row.contentYjs as Uint8Array<ArrayBuffer> | null,
      description: readMeta(row.templateMeta).description ?? null,
      createdById: row.createdById,
    }
  }

  /** Content needed to deep-copy a template page into a new page.
   *  Returns null if not found or not a template. */
  async findTemplateContentForCopy(templateId: string): Promise<TemplateContentRow | null> {
    const row = await this.uow.client().page.findFirst({
      where: { id: templateId, isTemplate: { not: null }, deletedAt: null },
      select: { content: true, contentYjs: true, icon: true, type: true },
    })
    if (!row) return null
    return {
      content: row.content,
      contentYjs: row.contentYjs as Uint8Array<ArrayBuffer> | null,
      icon: row.icon,
      type: row.type,
    }
  }

  /** Read a template page's content snapshot (for re-publishing files public). */
  async findTemplateContent(templateId: string): Promise<Prisma.JsonValue | null> {
    const row = await this.uow.client().page.findFirst({
      where: { id: templateId, isTemplate: { not: null }, deletedAt: null },
      select: { content: true },
    })
    return row?.content ?? null
  }

  // ── Writes ──────────────────────────────────────────────────────────────────

  /** Create a template PAGE (the template IS a page). Routed through the page
   *  service so linked-list ordering + outbox are handled the same as any page. */
  async createTemplatePage(
    actorUserId: string,
    input: {
      workspaceId: string
      scope: PageTemplateScope
      title: string
      icon: string | null
      description: string | null
      previewColor: string | null
      content: Prisma.JsonValue | null
      contentYjs: Uint8Array<ArrayBuffer> | null
      type: PageType
    },
  ): Promise<{ id: string }> {
    return this.pages.create(actorUserId, {
      workspaceId: input.workspaceId,
      parentId: null,
      title: input.title,
      icon: input.icon ?? undefined,
      type: input.type,
      isTemplate: input.scope,
      templateMeta: {
        description: input.description,
        previewColor: input.previewColor,
      },
      content: input.content ?? undefined,
      contentYjs: input.contentYjs ?? undefined,
    })
  }

  /** Deep-copy a template page into a NEW, independent normal page. */
  async createPageFromTemplatePage(
    actorUserId: string,
    input: {
      templatePageId: string
      workspaceId: string
      parentId: string | null
      title: string
      content: Prisma.JsonValue | null
      contentYjs: Uint8Array<ArrayBuffer> | null
      icon: string | null
      type: PageType
    },
  ): Promise<{ id: string }> {
    return this.pages.create(actorUserId, {
      workspaceId: input.workspaceId,
      parentId: input.parentId,
      title: input.title,
      icon: input.icon ?? undefined,
      type: input.type,
      content: input.content ?? undefined,
      contentYjs: input.contentYjs ?? undefined,
    })
  }

  async incrementUsage(pageId: string): Promise<void> {
    await this.uow.client().page.update({
      where: { id: pageId },
      data: { usageCount: { increment: 1 } },
    })
  }

  async linkTags(pageId: string, tagIds: string[]): Promise<void> {
    await this.uow.client().pageTemplateTag.deleteMany({ where: { pageId } })
    if (tagIds.length === 0) return
    await this.uow.client().pageTemplateTag.createMany({
      data: tagIds.map((tagId) => ({ pageId, tagId })),
      skipDuplicates: true,
    })
  }

  /** Update a template page's title/icon + merge description into templateMeta. */
  async updateTemplatePage(
    actorUserId: string,
    input: {
      pageId: string
      title?: string
      icon?: string | null
      description?: string | null
    },
  ): Promise<{ id: string }> {
    const data: {
      updatedById: string
      title?: string
      icon?: string | null
      templateMeta?: Prisma.InputJsonValue
    } = { updatedById: actorUserId }
    if (input.title !== undefined) data.title = input.title
    if (input.icon !== undefined) data.icon = input.icon
    if (input.description !== undefined) {
      const current = await this.uow.client().page.findUnique({
        where: { id: input.pageId },
        select: { templateMeta: true },
      })
      const meta = readMeta(current?.templateMeta ?? null)
      data.templateMeta = { description: input.description, previewColor: meta.previewColor ?? null }
    }
    return this.uow.client().page.update({
      where: { id: input.pageId },
      data,
      select: { id: true },
    })
  }

  async softDeleteTemplatePage(pageId: string): Promise<{ id: string }> {
    return this.uow.client().page.update({
      where: { id: pageId },
      data: { deletedAt: new Date() },
      select: { id: true },
    })
  }

  /** Mark the given files public so a published GLOBAL template renders for
   *  users outside the authoring workspace. No-op when empty. */
  async setFilesPublic(fileIds: string[]): Promise<void> {
    if (fileIds.length === 0) return
    await this.uow.client().file.updateMany({
      where: { id: { in: fileIds } },
      data: { isPublic: true },
    })
  }
}
