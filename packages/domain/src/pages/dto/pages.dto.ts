import { PageType } from '@repo/db'
import type { Prisma } from '@repo/db'
import { z } from 'zod'

// ── Input schemas ─────────────────────────────────────────────────────────────

export const createPageInput = z.object({
  workspaceId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  title: z.string().optional(),
  icon: z.string().optional(),
  type: z.nativeEnum(PageType).optional(),
  collectionId: z.string().uuid().nullable().optional(),
  location: z.enum(['team', 'private']).optional(),
})
export type CreatePageInput = z.infer<typeof createPageInput>

export const renamePageInput = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string(),
  icon: z.string().nullable().optional(),
})
export type RenamePageInput = z.infer<typeof renamePageInput>

export const updatePageInput = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string().optional(),
  icon: z.string().nullable().optional(),
  type: z.nativeEnum(PageType).optional(),
})
export type UpdatePageInput = z.infer<typeof updatePageInput>

export const duplicatePageInput = z.object({
  pageId: z.string().uuid(),
})
export type DuplicatePageInput = z.infer<typeof duplicatePageInput>

export const movePageInput = z.object({
  pageId: z.string().uuid(),
  newParentId: z.string().uuid().nullable(),
})
export type MovePageInput = z.infer<typeof movePageInput>

export const reorderPageInput = z.object({
  pageId: z.string().uuid(),
  newParentId: z.string().uuid().nullable(),
  newPrevPageId: z.string().uuid().nullable(),
})
export type ReorderPageInput = z.infer<typeof reorderPageInput>

export const archivePageInput = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
})
export type ArchivePageInput = z.infer<typeof archivePageInput>

export const unarchivePageInput = archivePageInput
export type UnarchivePageInput = z.infer<typeof unarchivePageInput>

export const moveToCollectionInput = z.object({
  pageId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  target: z.enum(['team', 'private']),
})
export type MoveToCollectionInput = z.infer<typeof moveToCollectionInput>

export const softDeletePageInput = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
})
export type SoftDeletePageInput = z.infer<typeof softDeletePageInput>

export const restorePageInput = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
})
export type RestorePageInput = z.infer<typeof restorePageInput>

export const hardDeletePageInput = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
})
export type HardDeletePageInput = z.infer<typeof hardDeletePageInput>

export const emptyTrashInput = z.object({
  workspaceId: z.string().uuid(),
})
export type EmptyTrashInput = z.infer<typeof emptyTrashInput>

// ── Extra fields for createPage (engines passes these; tRPC passes the subset) ─

/**
 * Engines passes ownership/content/contentYjs; tRPC passes only the schema subset.
 * createPage accepts the superset so both consumers share one positioning + outbox path.
 */
export type CreatePageExtra = {
  ownership?: 'TEXT' | 'SKILL' | 'AGENT'
  content?: Prisma.InputJsonValue
  contentYjs?: Uint8Array<ArrayBuffer>
  isTemplateBacking?: boolean
  resolvedCollectionId?: string | null
}

// ── Internal row DTO (returned from access queries) ───────────────────────────

export interface PageRowDto {
  id: string
  workspaceId: string
  createdById: string | null
  parentId: string | null
  collectionId: string | null
  prevPageId: string | null
  title: string | null
  icon: string | null
  type: PageType
  content: Prisma.JsonValue | null
  contentYjs: Uint8Array<ArrayBuffer> | null
  archivedAt: Date | null
  deletedAt: Date | null
}

// ── Output DTOs ───────────────────────────────────────────────────────────────

export interface CreateResultDto {
  id: string
}

export interface RenameResultDto {
  id: string
  title: string | null
  icon: string | null
  updatedAt: Date
}

export interface CountResultDto {
  count: number
}
