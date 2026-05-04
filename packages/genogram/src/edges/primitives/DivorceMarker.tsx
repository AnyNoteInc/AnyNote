'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CustodySide, UnionId } from '../../types'
import { setUnionEndMark } from '../../yjs/actions'
import { useDoc } from '../../react-flow/doc-context'
import { EDGE_STROKE, EDGE_WIDTH } from './constants'

const SLASH_LENGTH = 10
const SLASH_GAP = 4

export interface DivorceMarkerProps {
  /** X of the bracket's left vertical leg (= source person bottom + offset). */
  sourceX: number
  /** X of the bracket's right vertical leg (= target person bottom + offset). */
  targetX: number
  /**
   * Y of the bracket's horizontal segment — the marker sits at this Y. The
   * caller computes it (factoring in stack offsets for multi-partner
   * unions) so the marker tracks the actual rendered horizontal.
   */
  bracketY: number
  custodySide?: CustodySide
  /** UnionId used to persist markPosition via Yjs. */
  unionId?: UnionId
  /** Initial mark position along the line (0..1); defaults to custodySideToT(custodySide). */
  markPosition?: number
}

/**
 * Two parallel diagonal slashes across the union line, draggable along the line.
 * Position is stored in union.divorce.markPosition via Yjs on mouse-up.
 */
export function DivorceMarker({
  sourceX,
  targetX,
  bracketY,
  custodySide,
  unionId,
  markPosition,
}: DivorceMarkerProps) {
  const doc = useDoc()

  const defaultT = markPosition ?? custodySideToT(custodySide)
  const localPosRef = useRef<number>(defaultT)
  const [pos, setPos] = useState<number>(defaultT)
  const [dragging, setDragging] = useState(false)
  const dragStateRef = useRef<{
    posStart: number
    mouseStart: { x: number; y: number }
  } | null>(null)

  // Sync from Yjs when markPosition changes externally
  useEffect(() => {
    const next = markPosition ?? custodySideToT(custodySide)
    setPos(next)
    localPosRef.current = next
  }, [markPosition, custodySide])

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      dragStateRef.current = {
        posStart: localPosRef.current,
        mouseStart: { x: e.clientX, y: e.clientY },
      }
      setDragging(true)

      const onMove = (m: MouseEvent) => {
        const ds = dragStateRef.current
        if (!ds) return
        // Bracket horizontal is purely horizontal — project drag onto the X
        // axis only, ignoring vertical drag noise.
        const dx = m.clientX - ds.mouseStart.x
        const lineDx = targetX - sourceX
        const lineLen = Math.max(1, Math.abs(lineDx))
        const dir = Math.sign(lineDx) || 1
        const deltaScalar = (dx * dir) / lineLen
        const nextPos = Math.min(1, Math.max(0, ds.posStart + deltaScalar))
        localPosRef.current = nextPos
        setPos(nextPos)
      }

      const onUp = () => {
        setDragging(false)
        dragStateRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        if (unionId) {
          setUnionEndMark(doc, unionId, {
            custodySide,
            markPosition: localPosRef.current,
          })
        }
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [sourceX, targetX, custodySide, unionId, doc],
  )

  // Marker sits on the horizontal segment of the union bracket — caller
  // provides bracketY so multi-partner stacks land on the correct row.
  const cx = sourceX + (targetX - sourceX) * pos
  const cy = bracketY

  // Slash perpendicular comes from the bracket's horizontal direction (always
  // pure horizontal), so this resolves to a vertical pair tilted slightly.
  const dx = targetX - sourceX
  const len = Math.max(1, Math.abs(dx))
  const ux = dx / len
  const uy = 0
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

  return (
    <g
      onMouseDown={onDragStart}
      style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      data-testid="divorce-mark"
    >
      {/* Invisible hit area for easier dragging */}
      <rect x={cx - 12} y={cy - 12} width={24} height={24} fill="transparent" stroke="none" />
      {slashes}
    </g>
  )
}

function custodySideToT(side?: CustodySide): number {
  switch (side) {
    case 'male':
      return 0.35
    case 'female':
      return 0.65
    case 'shared':
    default:
      return 0.5
  }
}
