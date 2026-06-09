import { PageRevisionAction } from '@repo/db'
import type { Prisma } from '@repo/db'
import { z } from 'zod'

// Re-export the enum value through the dto barrel so services never import
// `@repo/db` as a value (the domain-services-no-db-value rule).
export { PageRevisionAction }

// ── tRPC input schemas ────────────────────────────────────────────────────────

export const listRevisionsInput = z.object({
  pageId: z.string().uuid(),
})
export type ListRevisionsInput = z.infer<typeof listRevisionsInput>

export const revisionPreviewInput = z.object({
  pageId: z.string().uuid(),
  revisionId: z.string().uuid(),
})
export type RevisionPreviewInput = z.infer<typeof revisionPreviewInput>

export const restoreRevisionInput = z.object({
  pageId: z.string().uuid(),
  revisionId: z.string().uuid(),
})
export type RestoreRevisionInput = z.infer<typeof restoreRevisionInput>

// ── Service inputs ────────────────────────────────────────────────────────────

export interface CaptureContentRevisionInput {
  pageId: string
  actorId: string | null
  content: Prisma.InputJsonValue | null
  contentYjs: Uint8Array<ArrayBuffer> | null
  metadata: Prisma.InputJsonValue | null
}

export interface CaptureStructuralRevisionInput {
  pageId: string
  actorId: string | null
  action: PageRevisionAction
  metadata: Prisma.InputJsonValue | null
}

export interface RestoreRevisionServiceInput {
  pageId: string
  revisionId: string
  actorId: string | null
}

// ── Repository row shapes ─────────────────────────────────────────────────────

/** The throttle probe: just the latest revision's actor + timestamp. */
export interface LatestRevisionDto {
  actorId: string | null
  createdAt: Date
}

/** Lightweight list row — never includes the heavy content/contentYjs blobs. */
export interface RevisionSummaryDto {
  id: string
  actorId: string | null
  action: PageRevisionAction
  metadata: Prisma.JsonValue | null
  createdAt: Date
}

/** Full revision, including the content snapshot (preview / restore). */
export interface RevisionDetailDto {
  id: string
  pageId: string
  actorId: string | null
  action: PageRevisionAction
  content: Prisma.JsonValue | null
  contentYjs: Uint8Array<ArrayBuffer> | null
  metadata: Prisma.JsonValue | null
  createdAt: Date
}

export interface CreateRevisionInput {
  pageId: string
  actorId: string | null
  action: PageRevisionAction
  content?: Prisma.InputJsonValue | null
  contentYjs?: Uint8Array<ArrayBuffer> | null
  metadata?: Prisma.InputJsonValue | null
}
