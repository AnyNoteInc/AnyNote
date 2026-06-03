import { describe, expect, it } from 'vitest'
import type { RuleContext } from '@tiptap/extension-drag-handle'

import { excludeColumnNodes, excludeFirstContainerChild } from './drag-handle-rules'

// The rules only read `node`, `parent`, and `isFirst`. Build the smallest
// RuleContext that satisfies the evaluate() signature.
const ctx = (opts: {
  nodeType: string
  parentType?: string | null
  isFirst?: boolean
}): RuleContext =>
  ({
    node: { type: { name: opts.nodeType } },
    parent: opts.parentType ? { type: { name: opts.parentType } } : null,
    isFirst: opts.isFirst ?? false,
  }) as unknown as RuleContext

// Anything >= 1000 removes the node from being a drag target (BASE_SCORE 1000).
const EXCLUDED = 1000

describe('excludeColumnNodes', () => {
  it('excludes columnLayout and column', () => {
    expect(excludeColumnNodes.evaluate(ctx({ nodeType: 'columnLayout' }))).toBeGreaterThanOrEqual(
      EXCLUDED,
    )
    expect(excludeColumnNodes.evaluate(ctx({ nodeType: 'column' }))).toBeGreaterThanOrEqual(
      EXCLUDED,
    )
  })

  it('does not touch ordinary blocks', () => {
    expect(excludeColumnNodes.evaluate(ctx({ nodeType: 'paragraph' }))).toBe(0)
  })
})

describe('excludeFirstContainerChild', () => {
  it('excludes the first paragraph inside a callout', () => {
    const score = excludeFirstContainerChild.evaluate(
      ctx({ nodeType: 'paragraph', parentType: 'callout', isFirst: true }),
    )
    expect(score).toBeGreaterThanOrEqual(EXCLUDED)
  })

  it('excludes the detailsSummary (toggle title) — first child of details', () => {
    const score = excludeFirstContainerChild.evaluate(
      ctx({ nodeType: 'detailsSummary', parentType: 'details', isFirst: true }),
    )
    expect(score).toBeGreaterThanOrEqual(EXCLUDED)
  })

  it('excludes the first child of detailsContent (toggle body)', () => {
    const score = excludeFirstContainerChild.evaluate(
      ctx({ nodeType: 'paragraph', parentType: 'detailsContent', isFirst: true }),
    )
    expect(score).toBeGreaterThanOrEqual(EXCLUDED)
  })

  it('leaves non-first children of a container alone', () => {
    const score = excludeFirstContainerChild.evaluate(
      ctx({ nodeType: 'paragraph', parentType: 'callout', isFirst: false }),
    )
    expect(score).toBe(0)
  })

  it('leaves first children of non-container parents alone', () => {
    const score = excludeFirstContainerChild.evaluate(
      ctx({ nodeType: 'paragraph', parentType: 'doc', isFirst: true }),
    )
    expect(score).toBe(0)
  })
})
