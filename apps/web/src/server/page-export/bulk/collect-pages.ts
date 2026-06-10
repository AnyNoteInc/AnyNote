import type { PageType, Prisma, PrismaClient } from '@repo/db'
import { buildPageVisibilityWhere, excludeDatabaseRowPages } from '@repo/domain'

export type ExportScope = 'WORKSPACE' | 'COLLECTION' | 'SUBTREE'

export type ExportPageRecord = {
  id: string
  parentId: string | null
  title: string | null
  icon: string | null
  type: PageType
  content: unknown
}

const SELECT = {
  id: true,
  parentId: true,
  title: true,
  icon: true,
  type: true,
  content: true,
} as const

/**
 * The export security boundary: canonical visibility predicate + db-row
 * exclusion + no trash/no archive, bounded by scope. A subtree branch under an
 * inaccessible page is pruned entirely (BFS only descends through visible nodes).
 */
export async function collectExportPages(
  prisma: PrismaClient,
  args: { userId: string; workspaceId: string; scope: ExportScope; scopeId: string | null },
): Promise<ExportPageRecord[]> {
  const base: Prisma.PageWhereInput = {
    workspaceId: args.workspaceId,
    deletedAt: null,
    archivedAt: null,
    AND: [buildPageVisibilityWhere(args.userId), excludeDatabaseRowPages()],
  }

  if (args.scope === 'WORKSPACE') {
    return prisma.page.findMany({ where: base, select: SELECT })
  }
  if (args.scope === 'COLLECTION') {
    return prisma.page.findMany({
      where: { ...base, collectionId: args.scopeId },
      select: SELECT,
    })
  }

  if (!args.scopeId) return []
  const root = await prisma.page.findFirst({
    where: { ...base, id: args.scopeId },
    select: SELECT,
  })
  if (!root) return []
  const out: ExportPageRecord[] = [root]
  let frontier = [root.id]
  while (frontier.length > 0) {
    const children = await prisma.page.findMany({
      where: { ...base, parentId: { in: frontier } },
      select: SELECT,
    })
    out.push(...children)
    frontier = children.map((c) => c.id)
  }
  return out
}
