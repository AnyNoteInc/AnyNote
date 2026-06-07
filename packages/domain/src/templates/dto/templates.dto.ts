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

export const createTemplateInput = z.object({
  workspaceId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  icon: z.string().nullable().optional(),
  tagIds: z.array(z.string().uuid()).max(10).optional(),
})
export type CreateTemplateInput = z.infer<typeof createTemplateInput>

export const getTemplateInput = z.object({
  templateId: z.string().uuid(),
  workspaceId: z.string().uuid(),
})
export type GetTemplateInput = z.infer<typeof getTemplateInput>

export const updateTemplateContentInput = z.object({
  templateId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  // ProseMirror/Tiptap JSON document snapshot (always an object, e.g.
  // { type: 'doc', content: [...] }). contentYjs is derived from this in the
  // tRPC layer, keeping @repo/domain dependency-light.
  content: z.record(z.string(), z.unknown()),
})
export type UpdateTemplateContentInput = z.infer<typeof updateTemplateContentInput>

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
 * Full template row including content payload — read internally when copying a
 * template into a new page. `content`/`contentYjs` mirror the Page columns.
 * `backingPageId` is included so the service can prefer the backing page's
 * live content over the (potentially stale) snapshot stored on the template row.
 */
export interface TemplateContentDto {
  id: string
  workspaceId: string | null
  scope: PageTemplateScope
  title: string
  icon: string | null
  type: PageType
  content: Prisma.JsonValue | null
  contentYjs: Uint8Array<ArrayBuffer> | null
  backingPageId: string | null
}

/**
 * Template detail used by the management editor: metadata plus the JSON
 * content snapshot (never the Yjs bytes, which the client doesn't read).
 * `canEdit` is computed by the service from the actor's role / createdById.
 * `createdById` is included so the route can forward it to the helpers.
 */
export interface TemplateDetailDto {
  id: string
  workspaceId: string | null
  scope: PageTemplateScope
  title: string
  description: string | null
  icon: string | null
  type: PageType
  content: Prisma.JsonValue | null
  backingPageId: string | null
  createdById: string | null
  canEdit: boolean
}

/**
 * Minimal backing-page projection returned by `getBackingPage`.
 * `contentYjs` is a base64 string so the client `atob`s it identically
 * to the shape returned by `trpc.page.getById`.
 */
export interface TemplateBackingPageDto {
  id: string
  type: PageType
  contentYjs: string | null
}

export interface MarketplaceResultDto {
  tags: TemplateTagDto[]
  workspaceTemplates: TemplateSummaryDto[]
  popularTemplates: TemplateSummaryDto[]
  allTemplates: TemplateSummaryDto[]
}
