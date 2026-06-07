import { PageType, PageTemplateScope } from '@repo/db'
import type { Prisma } from '@repo/db'
import { z } from 'zod'

// ── Input schemas ─────────────────────────────────────────────────────────────

export const searchTemplatesInput = z.object({
  workspaceId: z.string().uuid(),
  query: z.string().max(200),
  limit: z.number().int().min(1).max(50).optional(),
})
export type SearchTemplatesInput = z.infer<typeof searchTemplatesInput>

export const listWorkspaceTemplatesInput = z.object({
  workspaceId: z.string().uuid(),
})
export type ListWorkspaceTemplatesInput = z.infer<typeof listWorkspaceTemplatesInput>

export const createTemplateFromPageInput = z.object({
  pageId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  icon: z.string().nullable().optional(),
  scope: z.nativeEnum(PageTemplateScope),
  tagIds: z.array(z.string().uuid()).max(10).optional(),
})
export type CreateTemplateFromPageInput = z.infer<typeof createTemplateFromPageInput>

export const createPageFromTemplateInput = z.object({
  templateId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  title: z.string().optional(),
})
export type CreatePageFromTemplateInput = z.infer<typeof createPageFromTemplateInput>

export const updateTemplateInput = z.object({
  templateId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  icon: z.string().nullable().optional(),
  tagIds: z.array(z.string().uuid()).max(10).optional(),
})
export type UpdateTemplateInput = z.infer<typeof updateTemplateInput>

export const deleteTemplateInput = z.object({
  templateId: z.string().uuid(),
  workspaceId: z.string().uuid(),
})
export type DeleteTemplateInput = z.infer<typeof deleteTemplateInput>

export const getTemplateInput = z.object({
  templateId: z.string().uuid(),
  workspaceId: z.string().uuid(),
})
export type GetTemplateInput = z.infer<typeof getTemplateInput>

export const listMarketplaceInput = z.object({
  workspaceId: z.string().uuid(),
  tagId: z.string().uuid().nullable().optional(),
  query: z.string().max(200).optional(),
  sectionLimit: z.number().int().min(1).max(50).optional(),
})
export type ListMarketplaceInput = z.infer<typeof listMarketplaceInput>

// ── Tag / Author DTOs ─────────────────────────────────────────────────────────

export interface TemplateTagDto {
  id: string
  slug: string
  name: string
  icon: string
  position: number
}

export interface TemplateAuthorDto {
  name: string // display name; "AnyNote" for seeded globals (createdById null)
}

// ── Row / output DTOs ─────────────────────────────────────────────────────────

/**
 * Lightweight projection used by search/list — never includes the heavy
 * `content`/`contentYjs` payload, which is only read when a page is created.
 */
export interface TemplateSummaryDto {
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
  previewContent: Prisma.JsonValue | null
  tags: TemplateTagDto[]
  author: TemplateAuthorDto
  createdById: string | null
  createdAt: Date
  updatedAt: Date
}

export interface SearchTemplatesResult {
  workspaceTemplates: TemplateSummaryDto[]
  globalTemplates: TemplateSummaryDto[]
}

export interface CreateTemplateResultDto {
  id: string
}

export interface CreatePageFromTemplateResultDto {
  id: string
}

export interface DeleteTemplateResultDto {
  count: number
}

/**
 * Template detail used by the management editor: metadata plus the page's own
 * Yjs doc (base64) so the editor can mount collaboratively.
 * `canEdit` is computed by the service from the actor's role / createdById.
 * `createdById` is included so the route can forward it to the helpers.
 */
export interface TemplateDetailDto {
  id: string
  workspaceId: string
  scope: PageTemplateScope
  title: string
  description: string | null
  icon: string | null
  type: PageType
  contentYjs: string | null // base64 — the page's own Yjs doc, for the editor
  createdById: string | null
  canEdit: boolean
}

export interface MarketplaceResultDto {
  tags: TemplateTagDto[]
  workspaceTemplates: TemplateSummaryDto[]
  popularTemplates: TemplateSummaryDto[]
  allTemplates: TemplateSummaryDto[]
}
