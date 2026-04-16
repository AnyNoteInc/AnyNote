export type PageItem = {
  id: string
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
