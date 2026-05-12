export type DropZone = 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM'

export type DropPoint = { x: number; y: number }

export type DropRect = { left: number; top: number; right: number; bottom: number }

export type ZoneOptions = { canSide: boolean }

// Y-containment picks the target: the cursor must be on the same line as the
// block. X then decides what to do with that target — inside its horizontal
// bounds means vertical reorder (TOP/BOTTOM); past its left/right edge means
// "create a column on that side". This makes the full width of the block a
// safe reorder zone, and column creation is gated on physically dragging the
// cursor beyond the block's edge.
export function computeDropZone(
  point: DropPoint,
  rect: DropRect,
  options: ZoneOptions,
): DropZone | null {
  if (point.y < rect.top || point.y > rect.bottom) return null
  if (options.canSide) {
    if (point.x < rect.left) return 'LEFT'
    if (point.x > rect.right) return 'RIGHT'
  }
  const midY = rect.top + (rect.bottom - rect.top) / 2
  return point.y < midY ? 'TOP' : 'BOTTOM'
}
