import type { DragHandleRule } from '@tiptap/extension-drag-handle'

// columnLayout / column are structural — the user never drags the row or the
// cell itself; only blocks of content inside cells get a handle. Deduct enough
// to push the score < 0, which the library treats as "not a candidate".
export const excludeColumnNodes: DragHandleRule = {
  id: 'excludeColumnNodes',
  evaluate: ({ node }) => {
    if (node.type.name === 'columnLayout' || node.type.name === 'column') return 10000
    return 0
  },
}

// Container nodes own their children; the FIRST child block should not show the
// + / drag controls (they belong to the container, not a standalone block).
// - callout / hiddenText / blockquote: the first content block.
// - detailsContent: the toggle body's first block.
// - details: the toggle's TITLE (detailsSummary is its first child) — hovering
//   the header must hand the handle to the whole toggle, not the summary.
const CONTAINER_PARENTS = new Set([
  'callout',
  'details',
  'detailsContent',
  'hiddenText',
  'blockquote',
])

export const excludeFirstContainerChild: DragHandleRule = {
  id: 'excludeFirstContainerChild',
  evaluate: ({ parent, isFirst }) => {
    if (isFirst && parent && CONTAINER_PARENTS.has(parent.type.name)) return 10000
    return 0
  },
}
