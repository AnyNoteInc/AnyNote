export type DropZone = 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM'

export type DropPoint = { x: number; y: number }

export type DropRect = { left: number; top: number; right: number; bottom: number }

export type ZoneOptions = { canSide: boolean }

const SIDE_FRACTION = 0.25

export function computeDropZone(
  point: DropPoint,
  rect: DropRect,
  options: ZoneOptions,
): DropZone | null {
  if (point.x < rect.left || point.x > rect.right) return null
  if (point.y < rect.top || point.y > rect.bottom) return null
  const width = rect.right - rect.left
  const sideThreshold = width * SIDE_FRACTION
  const inLeftBand = point.x < rect.left + sideThreshold
  const inRightBand = point.x > rect.right - sideThreshold
  if (options.canSide && inLeftBand) return 'LEFT'
  if (options.canSide && inRightBand) return 'RIGHT'
  const midY = rect.top + (rect.bottom - rect.top) / 2
  return point.y < midY ? 'TOP' : 'BOTTOM'
}
