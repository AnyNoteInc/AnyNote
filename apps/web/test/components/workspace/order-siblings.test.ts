import { describe, expect, it } from 'vitest'

import { orderSiblings, type PageItem } from '../../../src/components/workspace/types'

/**
 * Build a PageItem with sensible defaults so each test only specifies the
 * fields it cares about (id, prevPageId, createdAt for ordering).
 */
function page(partial: Partial<PageItem> & { id: string }): PageItem {
  return {
    title: partial.id,
    icon: null,
    parentId: null,
    prevPageId: null,
    createdById: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

const ids = (pages: PageItem[]) => pages.map((p) => p.id)

describe('orderSiblings', () => {
  it('(a) head present (common case): orders by the prevPageId chain from the null head', () => {
    const a = page({ id: 'a', prevPageId: null, createdAt: '2026-01-01T00:00:03.000Z' })
    const b = page({ id: 'b', prevPageId: 'a', createdAt: '2026-01-01T00:00:02.000Z' })
    const c = page({ id: 'c', prevPageId: 'b', createdAt: '2026-01-01T00:00:01.000Z' })

    // Input is shuffled and createdAt deliberately disagrees with chain order,
    // so a createdAt fallback would produce [c, b, a]; the chain must win.
    expect(ids(orderSiblings([c, b, a]))).toEqual(['a', 'b', 'c'])
  })

  it('(b) THE BUG — dangling head: prev points outside the filtered set', () => {
    // No page has id 'OUTSIDE' in this set, so x is the view-local head.
    const x = page({ id: 'x', prevPageId: 'OUTSIDE', createdAt: '2026-01-01T00:00:01.000Z' })
    const y = page({ id: 'y', prevPageId: 'x', createdAt: '2026-01-01T00:00:02.000Z' })

    expect(ids(orderSiblings([y, x]))).toEqual(['x', 'y'])
  })

  it('(c) drop-sort within a non-head collection: m sorted between p1 and p2', () => {
    // Collection-filtered set; the chain head ('teamHead') is filtered out.
    const p1 = page({ id: 'p1', prevPageId: 'teamHead', createdAt: '2026-01-01T00:00:05.000Z' })
    const m = page({ id: 'm', prevPageId: 'p1', createdAt: '2026-01-01T00:00:01.000Z' })
    const p2 = page({ id: 'p2', prevPageId: 'm', createdAt: '2026-01-01T00:00:03.000Z' })

    // Input is shuffled out of chain order. The old fallback preserves input
    // order ([m, p2, p1]); the chain must place m between p1 and p2.
    expect(ids(orderSiblings([m, p2, p1]))).toEqual(['p1', 'm', 'p2'])
  })

  it('(d) fragmented chain: two dangling heads, ordered by head createdAt', () => {
    // Fragment B's head was created earlier than fragment A's head, so B comes first.
    const a1 = page({ id: 'a1', prevPageId: 'OUT_A', createdAt: '2026-01-01T00:00:10.000Z' })
    const a2 = page({ id: 'a2', prevPageId: 'a1', createdAt: '2026-01-01T00:00:11.000Z' })
    const b1 = page({ id: 'b1', prevPageId: 'OUT_B', createdAt: '2026-01-01T00:00:05.000Z' })
    const b2 = page({ id: 'b2', prevPageId: 'b1', createdAt: '2026-01-01T00:00:06.000Z' })

    // b1 head (earlier createdAt) fragment first, each fragment internally chained.
    expect(ids(orderSiblings([a2, a1, b2, b1]))).toEqual(['b1', 'b2', 'a1', 'a2'])
  })

  it('(e) empty and single page', () => {
    expect(orderSiblings([])).toEqual([])

    const only = page({ id: 'solo', prevPageId: null })
    expect(ids(orderSiblings([only]))).toEqual(['solo'])
  })

  it('(e2) single page with a dangling prev is still its own head', () => {
    const only = page({ id: 'solo', prevPageId: 'GONE' })
    expect(ids(orderSiblings([only]))).toEqual(['solo'])
  })

  it('defensive: a cycle does not loop forever; cycled nodes append last', () => {
    // n1 -> n2 -> n1 forms a cycle with no head; both must still appear once.
    const n1 = page({ id: 'n1', prevPageId: 'n2', createdAt: '2026-01-01T00:00:01.000Z' })
    const n2 = page({ id: 'n2', prevPageId: 'n1', createdAt: '2026-01-01T00:00:02.000Z' })

    const result = ids(orderSiblings([n1, n2]))
    expect(result).toHaveLength(2)
    expect(new Set(result)).toEqual(new Set(['n1', 'n2']))
  })
})
