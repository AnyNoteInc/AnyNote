import type { Edge, EdgeProps } from '@xyflow/react'
import type { GenogramEdgeData, GenogramEdgeType } from '../types'
import { EDGE_STROKE, EDGE_WIDTH } from './primitives/constants'

type RfChildEdge = Edge<GenogramEdgeData, GenogramEdgeType>

/**
 * L-shaped path from the children hub (source) to a child (target):
 * horizontal at source.y, then vertical down to target. Multiple child
 * edges from the same hub share the horizontal at hub.y — that's what
 * forms the "sibling line" visually.
 */
export function ChildEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
}: EdgeProps<RfChildEdge>) {
  const d = `M ${sourceX} ${sourceY} L ${targetX} ${sourceY} L ${targetX} ${targetY}`
  return (
    <path id={id} d={d} fill="none" stroke={EDGE_STROKE} strokeWidth={EDGE_WIDTH} style={style} />
  )
}
