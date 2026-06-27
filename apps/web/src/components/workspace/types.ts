import type { PageType } from '@repo/db'

export type PageItem = {
  id: string
  type?: PageType
  title: string | null
  icon: string | null
  parentId: string | null
  prevPageId: string | null
  collectionId?: string | null
  createdById: string | null
  createdAt: string | Date
}

const createdAtMs = (p: PageItem): number =>
  p.createdAt instanceof Date ? p.createdAt.getTime() : Date.parse(p.createdAt)

// Stable order by createdAt ascending, then id as a deterministic tiebreak.
const byCreatedThenId = (a: PageItem, b: PageItem): number =>
  createdAtMs(a) - createdAtMs(b) || a.id.localeCompare(b.id)

/**
 * Order pages by the `prevPageId` linked list.
 *
 * Subtlety: workspace root pages form ONE `prevPageId` chain across ALL
 * collections (`createPageTx` tail-inserts scoped by `(workspaceId, parentId)`,
 * not `collectionId`), but each sidebar section calls this with pages already
 * filtered to a single `collectionId`. So a page is a view-local HEAD when its
 * `prevPageId` is `null` OR points to a page that isn't in the filtered set
 * ("dangling" prev). Walking only from a strictly-null head would leave every
 * non-head collection unsorted (its head's prev points at a filtered-out page),
 * which is the drag-to-sort-invisible bug.
 *
 * We collect all such heads, order the resulting fragments deterministically by
 * head createdAt (then id), and within each fragment follow the chain forward.
 * Any unreachable page (e.g. a cycle) appends last in createdAt order.
 */
export function orderSiblings(pages: PageItem[]): PageItem[] {
  if (pages.length === 0) return []

  const byId = new Map<string, PageItem>()
  const byPrev = new Map<string, PageItem>()
  for (const p of pages) {
    byId.set(p.id, p)
    if (p.prevPageId !== null) byPrev.set(p.prevPageId, p)
  }

  const heads = pages
    .filter((p) => p.prevPageId === null || !byId.has(p.prevPageId))
    .sort(byCreatedThenId)

  const out: PageItem[] = []
  const visited = new Set<string>()
  for (const head of heads) {
    let cursor: PageItem | undefined = head
    while (cursor && !visited.has(cursor.id)) {
      out.push(cursor)
      visited.add(cursor.id)
      cursor = byPrev.get(cursor.id)
    }
  }

  // Defensive: anything unreached (e.g. a cycle with no head) goes last.
  const leftover = pages.filter((p) => !visited.has(p.id)).sort(byCreatedThenId)
  out.push(...leftover)

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
  // Bucket children by parentId ONCE (O(n)) instead of re-scanning the full
  // page set at every recursion level (the old O(n²) behaviour). Each bucket
  // is exactly `pages.filter((p) => p.parentId === pid)` in original input
  // order, so `orderSiblings` receives an identical input and its chain-order /
  // dangling-prev-head / cycle semantics are preserved byte-for-byte.
  const childrenByParent = new Map<string | null, PageItem[]>()
  for (const page of pages) {
    const key = page.parentId
    const bucket = childrenByParent.get(key)
    if (bucket) bucket.push(page)
    else childrenByParent.set(key, [page])
  }

  const result: FlatPageItem[] = []
  const walk = (pid: string | null, d: number): void => {
    const siblings = orderSiblings(childrenByParent.get(pid) ?? [])
    for (const page of siblings) {
      const collapsed = collapsedIds.has(page.id)
      result.push({ ...page, depth: d, collapsed })
      if (!collapsed) walk(page.id, d + 1)
    }
  }
  walk(parentId, depth)
  return result
}
