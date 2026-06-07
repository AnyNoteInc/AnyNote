import type { PageTemplateScope, PageType } from '@repo/db'

/**
 * Client-facing shape of a template summary. Mirrors the domain
 * `TemplateSummaryDto`, but `createdAt`/`updatedAt` arrive as ISO strings
 * because the tRPC link uses plain JSON (no superjson transformer).
 */
export interface TemplateSummary {
  id: string
  workspaceId: string | null
  scope: PageTemplateScope
  title: string
  description: string | null
  icon: string | null
  tags: { id: string; slug: string; name: string; icon: string; position: number }[]
  type: PageType
  usageCount: number
  createdAt: string | Date
  updatedAt: string | Date
}
