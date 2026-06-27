import { describe, expect, it } from 'vitest'

import {
  flattenTree,
  type FlatPageItem,
  type PageItem,
} from '../../../src/components/workspace/types'

/**
 * Build a PageItem with sensible defaults so each test only specifies the
 * fields it cares about (id, parentId, prevPageId, createdAt for ordering).
 * Mirrors the helper in order-siblings.test.ts.
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

// Project the flattened output down to the shape that defines tree-render order:
// [{ id, depth, collapsed }, ...]. This is the byte-for-byte contract.
const shape = (items: FlatPageItem[]) =>
  items.map((i) => ({ id: i.id, depth: i.depth, collapsed: i.collapsed }))

describe('flattenTree (characterization — locks today byte-for-byte)', () => {
  it('2-level tree: roots ordered by chain, children nested at depth 1', () => {
    const r1 = page({
      id: 'r1',
      parentId: null,
      prevPageId: null,
      createdAt: '2026-01-01T00:00:01.000Z',
    })
    const r2 = page({
      id: 'r2',
      parentId: null,
      prevPageId: 'r1',
      createdAt: '2026-01-01T00:00:02.000Z',
    })
    const c1 = page({
      id: 'c1',
      parentId: 'r1',
      prevPageId: null,
      createdAt: '2026-01-01T00:00:03.000Z',
    })
    const c2 = page({
      id: 'c2',
      parentId: 'r1',
      prevPageId: 'c1',
      createdAt: '2026-01-01T00:00:04.000Z',
    })

    // Input shuffled; chain order must win at each level.
    const flat = flattenTree([c2, r2, c1, r1], null, 0, new Set())
    expect(shape(flat)).toEqual([
      { id: 'r1', depth: 0, collapsed: false },
      { id: 'c1', depth: 1, collapsed: false },
      { id: 'c2', depth: 1, collapsed: false },
      { id: 'r2', depth: 0, collapsed: false },
    ])
  })

  it('dangling-prev head among children: child head whose prev points outside the sibling set', () => {
    const root = page({ id: 'root', parentId: null, prevPageId: null })
    // x.prevPageId points to a page not in root's child set -> x is a view-local head.
    const x = page({
      id: 'x',
      parentId: 'root',
      prevPageId: 'OUTSIDE',
      createdAt: '2026-01-01T00:00:01.000Z',
    })
    const y = page({
      id: 'y',
      parentId: 'root',
      prevPageId: 'x',
      createdAt: '2026-01-01T00:00:02.000Z',
    })

    const flat = flattenTree([y, x, root], null, 0, new Set())
    expect(shape(flat)).toEqual([
      { id: 'root', depth: 0, collapsed: false },
      { id: 'x', depth: 1, collapsed: false },
      { id: 'y', depth: 1, collapsed: false },
    ])
  })

  it('collapsed node hides its subtree but still emits itself with collapsed=true', () => {
    const root = page({ id: 'root', parentId: null, prevPageId: null })
    const child = page({ id: 'child', parentId: 'root', prevPageId: null })
    const grandchild = page({ id: 'grandchild', parentId: 'child', prevPageId: null })

    const flat = flattenTree([root, child, grandchild], null, 0, new Set(['child']))
    expect(shape(flat)).toEqual([
      { id: 'root', depth: 0, collapsed: false },
      { id: 'child', depth: 1, collapsed: true },
    ])
  })

  it('multiple sibling fragments at one level: two dangling heads ordered by head createdAt', () => {
    // Two fragments under the same parent, each with a prev pointing outside the set.
    const a1 = page({
      id: 'a1',
      parentId: 'root',
      prevPageId: 'OUT_A',
      createdAt: '2026-01-01T00:00:10.000Z',
    })
    const a2 = page({
      id: 'a2',
      parentId: 'root',
      prevPageId: 'a1',
      createdAt: '2026-01-01T00:00:11.000Z',
    })
    const b1 = page({
      id: 'b1',
      parentId: 'root',
      prevPageId: 'OUT_B',
      createdAt: '2026-01-01T00:00:05.000Z',
    })
    const b2 = page({
      id: 'b2',
      parentId: 'root',
      prevPageId: 'b1',
      createdAt: '2026-01-01T00:00:06.000Z',
    })
    const root = page({ id: 'root', parentId: null, prevPageId: null })

    const flat = flattenTree([a2, a1, b2, b1, root], null, 0, new Set())
    expect(shape(flat)).toEqual([
      { id: 'root', depth: 0, collapsed: false },
      // b-fragment head created earlier -> first; each fragment internally chained.
      { id: 'b1', depth: 1, collapsed: false },
      { id: 'b2', depth: 1, collapsed: false },
      { id: 'a1', depth: 1, collapsed: false },
      { id: 'a2', depth: 1, collapsed: false },
    ])
  })

  it('3-level tree: depth increments correctly down the spine', () => {
    const r = page({
      id: 'r',
      parentId: null,
      prevPageId: null,
      createdAt: '2026-01-01T00:00:01.000Z',
    })
    const c = page({
      id: 'c',
      parentId: 'r',
      prevPageId: null,
      createdAt: '2026-01-01T00:00:02.000Z',
    })
    const g1 = page({
      id: 'g1',
      parentId: 'c',
      prevPageId: null,
      createdAt: '2026-01-01T00:00:03.000Z',
    })
    const g2 = page({
      id: 'g2',
      parentId: 'c',
      prevPageId: 'g1',
      createdAt: '2026-01-01T00:00:04.000Z',
    })
    const r2 = page({
      id: 'r2',
      parentId: null,
      prevPageId: 'r',
      createdAt: '2026-01-01T00:00:05.000Z',
    })

    const flat = flattenTree([g2, g1, c, r, r2], null, 0, new Set())
    expect(shape(flat)).toEqual([
      { id: 'r', depth: 0, collapsed: false },
      { id: 'c', depth: 1, collapsed: false },
      { id: 'g1', depth: 2, collapsed: false },
      { id: 'g2', depth: 2, collapsed: false },
      { id: 'r2', depth: 0, collapsed: false },
    ])
  })

  it('cycle among siblings: no head, unreachable nodes append last in createdAt order', () => {
    const root = page({ id: 'root', parentId: null, prevPageId: null })
    // childA <-> childB form a prevPageId cycle with no head; orderSiblings
    // reaches neither via the chain walk and appends both as leftover, sorted
    // by createdAt (then id). childB is earlier, so it comes first.
    const childA = page({
      id: 'childA',
      parentId: 'root',
      prevPageId: 'childB',
      createdAt: '2026-01-01T00:00:02.000Z',
    })
    const childB = page({
      id: 'childB',
      parentId: 'root',
      prevPageId: 'childA',
      createdAt: '2026-01-01T00:00:01.000Z',
    })

    const flat = flattenTree([childA, childB, root], null, 0, new Set())
    expect(shape(flat)).toEqual([
      { id: 'root', depth: 0, collapsed: false },
      { id: 'childB', depth: 1, collapsed: false },
      { id: 'childA', depth: 1, collapsed: false },
    ])
  })

  it('empty input yields empty output', () => {
    expect(flattenTree([], null, 0, new Set())).toEqual([])
  })
})
