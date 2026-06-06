import { PageTemplateScope } from '@repo/db'
import type { Prisma } from '@repo/db'

import type {
  CreatePageFromTemplateInput,
  TemplateContentDto,
  TemplateSummaryDto,
} from './dto/templates.dto.ts'

/** Roles that may create a workspace-scoped template (mirrors page edit access). */
const WRITABLE_ROLES = new Set(['OWNER', 'ADMIN', 'EDITOR'])

/**
 * A workspace template may be created by the page creator or by any workspace
 * member with a writable role (OWNER/ADMIN/EDITOR), matching how page editing
 * is gated elsewhere.
 */
export function canCreateWorkspaceTemplate(args: {
  isPageCreator: boolean
  role: string | null | undefined
}): boolean {
  if (args.isPageCreator) return true
  return args.role != null && WRITABLE_ROLES.has(args.role)
}

/**
 * AnyNote has no global-admin concept (roles are per-workspace only), so normal
 * users can never create GLOBAL templates. Global templates are seeded. This
 * helper centralises that decision so it can be relaxed later (e.g. an env
 * allowlist) in exactly one place.
 */
export function canCreateGlobalTemplate(_args: { role?: string | null }): boolean {
  return false
}

/** Case-insensitive substring/prefix matching against title and description. */
export function filterTemplatesByQuery<
  T extends Pick<TemplateSummaryDto, 'title' | 'description'>,
>(templates: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...templates]
  return templates.filter((t) => {
    const title = t.title.toLowerCase()
    const description = (t.description ?? '').toLowerCase()
    return title.includes(q) || description.includes(q)
  })
}

/**
 * Relevance score (lower = better, sorts first):
 *   0 — title starts with query
 *   1 — title contains query
 *   2 — description contains query
 *   3 — neither (only happens when query is empty)
 */
function relevanceRank(
  t: Pick<TemplateSummaryDto, 'title' | 'description'>,
  q: string,
): number {
  if (q === '') return 3
  const title = t.title.toLowerCase()
  const description = (t.description ?? '').toLowerCase()
  if (title.startsWith(q)) return 0
  if (title.includes(q)) return 1
  if (description.includes(q)) return 2
  return 3
}

/**
 * Sort by: title-starts-with > title-contains > description-contains, then
 * usageCount desc, then createdAt desc. Pure and stable; does not mutate input.
 */
export function sortTemplatesByRelevance<
  T extends Pick<TemplateSummaryDto, 'title' | 'description' | 'usageCount' | 'createdAt'>,
>(templates: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  return [...templates].sort((a, b) => {
    const ra = relevanceRank(a, q)
    const rb = relevanceRank(b, q)
    if (ra !== rb) return ra - rb
    if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount
    return b.createdAt.getTime() - a.createdAt.getTime()
  })
}

/** Split a flat list into workspace-scoped and global buckets. */
export function groupTemplatesByScope<T extends Pick<TemplateSummaryDto, 'scope'>>(
  templates: T[],
): { workspaceTemplates: T[]; globalTemplates: T[] } {
  const workspaceTemplates: T[] = []
  const globalTemplates: T[] = []
  for (const t of templates) {
    if (t.scope === PageTemplateScope.WORKSPACE) workspaceTemplates.push(t)
    else globalTemplates.push(t)
  }
  return { workspaceTemplates, globalTemplates }
}

/**
 * Build the page-create payload from a template: title falls back to the
 * template's title when the caller didn't override it; type/icon/content are
 * copied verbatim. The editor reads from contentYjs, so the bytes are passed
 * through unchanged (the same copy strategy as page duplication).
 */
export function buildCreatePageFromTemplatePayload(
  template: TemplateContentDto,
  input: Pick<CreatePageFromTemplateInput, 'workspaceId' | 'parentId' | 'title'>,
): {
  workspaceId: string
  parentId: string | null
  title: string
  icon: string | undefined
  type: TemplateContentDto['type']
  content: Prisma.InputJsonValue | undefined
  contentYjs: Uint8Array<ArrayBuffer> | undefined
} {
  const title = input.title?.trim() ? input.title.trim() : template.title
  return {
    workspaceId: input.workspaceId,
    parentId: input.parentId,
    title,
    icon: template.icon ?? undefined,
    type: template.type,
    // template.content is Prisma.JsonValue (may be null); a stored template
    // never holds the JSON literal `null`, so coalescing to undefined yields a
    // valid InputJsonValue for the page-create path.
    content: template.content ?? undefined,
    contentYjs: template.contentYjs ?? undefined,
  }
}
