import type { Edge, EdgeProps } from '@xyflow/react'
import type { GenogramEdgeData, GenogramEdgeType } from '../types'
import { EDGE_STROKE, EDGE_WIDTH } from './primitives/constants'

type TrunkEdge = Edge<GenogramEdgeData, GenogramEdgeType>

/**
 * No longer emitted by domainToFlow — the children hub now sits on the
 * union bracket's horizontal, so a separate trunk segment is unnecessary.
 * Kept as a registered edge type for backward-compat with any persisted
 * flows that still reference 'unionTrunk'; renders as a no-op.
 */
export function UnionTrunkEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
}: EdgeProps<TrunkEdge>) {
  return (
    <path
      id={id}
      d={`M ${sourceX} ${sourceY} L ${targetX} ${targetY}`}
      fill="none"
      stroke={EDGE_STROKE}
      strokeWidth={EDGE_WIDTH}
      style={style}
    />
  )
}
