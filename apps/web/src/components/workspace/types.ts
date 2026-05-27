import type { PageType } from '@repo/db'

export type PageItem = {
  id: string
  type?: PageType
  title: string | null
  icon: string | null
  parentId: string | null
  prevPageId: string | null
  createdById: string | null
  createdAt: string | Date
}

export function orderSiblings(pages: PageItem[]): PageItem[] {
  if (pages.length === 0) return []
  const byPrev = new Map<string | null, PageItem>()
  for (const p of pages) byPrev.set(p.prevPageId, p)
  const out: PageItem[] = []
  let cursor: string | null = null
  while (byPrev.has(cursor)) {
    const next: PageItem = byPrev.get(cursor)!
    out.push(next)
    cursor = next.id
  }
  const inChain = new Set(out.map((p) => p.id))
  for (const p of pages) {
    if (!inChain.has(p.id)) out.push(p)
  }
  return out
}

export function firstPageInTreeOrder(pages: PageItem[]): PageItem | undefined {
  const firstRootPage = orderSiblings(pages.filter((p) => p.parentId === null))[0]
  return firstRootPage ?? orderSiblings(pages)[0]
}

export type FlatPageItem = PageItem & {
  depth: number
  collapsed: boolean
}

export function flattenTree(
  pages: PageItem[],
  parentId: string | null = null,
  depth = 0,
  collapsedIds: Set<string> = new Set(),
): FlatPageItem[] {
  const siblings = orderSiblings(pages.filter((p) => p.parentId === parentId))
  const result: FlatPageItem[] = []
  for (const page of siblings) {
    const collapsed = collapsedIds.has(page.id)
    result.push({ ...page, depth, collapsed })
    if (!collapsed) {
      result.push(...flattenTree(pages, page.id, depth + 1, collapsedIds))
    }
  }
  return result
}
