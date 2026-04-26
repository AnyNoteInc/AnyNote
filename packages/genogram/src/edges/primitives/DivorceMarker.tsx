import { EDGE_STROKE, EDGE_WIDTH } from './constants'
import type { CustodySide } from '../../types'

const SLASH_LENGTH = 10
const SLASH_GAP = 4

export interface DivorceMarkerProps {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  custodySide?: CustodySide
}

/**
 * Two parallel diagonal slashes across the union line. The position along
 * the line reflects custodySide: left ⇒ near male partner (children stay with him),
 * right ⇒ near female partner, shared/undefined ⇒ midpoint.
 */
export function DivorceMarker({
  sourceX,
  sourceY,
  targetX,
  targetY,
  custodySide,
}: DivorceMarkerProps) {
  const t = custodySideToT(custodySide)
  const cx = sourceX + (targetX - sourceX) * t
  const cy = sourceY + (targetY - sourceY) * t

  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const len = Math.max(1, Math.hypot(dx, dy))
  const ux = dx / len
  const uy = dy / len
  // Perpendicular unit vector
  const px = -uy
  const py = ux

  // Tilt 20° forward of perpendicular so the slashes look like "/ /"
  const tiltX = ux * 0.35
  const tiltY = uy * 0.35
  const vx = (px + tiltX) * SLASH_LENGTH
  const vy = (py + tiltY) * SLASH_LENGTH

  const slashes = [-SLASH_GAP / 2, SLASH_GAP / 2].map((offset, i) => {
    const ox = cx + ux * offset
    const oy = cy + uy * offset
    return (
      <line
        key={i}
        x1={ox - vx / 2}
        y1={oy - vy / 2}
        x2={ox + vx / 2}
        y2={oy + vy / 2}
        stroke={EDGE_STROKE}
        strokeWidth={EDGE_WIDTH}
      />
    )
  })

  return <g>{slashes}</g>
}

function custodySideToT(side?: CustodySide): number {
  switch (side) {
    case 'left':
      return 0.35
    case 'right':
      return 0.65
    case 'shared':
    default:
      return 0.5
  }
}
