import type { Edge, EdgeProps } from '@xyflow/react'
import type { GenogramEdgeData, GenogramEdgeType } from '../types'
import { EDGE_STROKE, EDGE_WIDTH } from './primitives/constants'

type RfChildEdge = Edge<GenogramEdgeData, GenogramEdgeType>

/**
 * Straight vertical drop from the union bracket horizontal down to the child
 * top. The hub sits at the bracket Y, so each child edge starts at
 * (child.x, bracket Y) — the segment shows up as a parallel line under the
 * bracket. Layout guarantees child.x stays within the bracket span, so the
 * line always lands on the bracket horizontal.
 */
export function ChildEdge({ id, sourceY, targetX, targetY, style }: EdgeProps<RfChildEdge>) {
  const d = `M ${targetX} ${sourceY} L ${targetX} ${targetY}`
  return (
    <path id={id} d={d} fill="none" stroke={EDGE_STROKE} strokeWidth={EDGE_WIDTH} style={style} />
  )
}
