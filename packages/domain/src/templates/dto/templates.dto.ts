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
  category: z.string().max(100).nullable().optional(),
  scope: z.nativeEnum(PageTemplateScope),
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
  category: z.string().max(100).nullable().optional(),
})
export type UpdateTemplateInput = z.infer<typeof updateTemplateInput>

export const deleteTemplateInput = z.object({
  templateId: z.string().uuid(),
  workspaceId: z.string().uuid(),
})
export type DeleteTemplateInput = z.infer<typeof deleteTemplateInput>

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
  category: string | null
  type: PageType
  usageCount: number
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
}
