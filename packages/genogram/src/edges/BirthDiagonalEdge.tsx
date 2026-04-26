import type { Edge, EdgeProps } from '@xyflow/react'
import type { GenogramEdgeData, GenogramEdgeType } from '../types'
import { EDGE_STROKE, EDGE_WIDTH } from './primitives/constants'

type DiagonalEdge = Edge<GenogramEdgeData, GenogramEdgeType>

/**
 * Used for both twin and fraternal diagonals — visually identical straight
 * lines from BirthGroupNode down to each member. The distinguishing factor
 * (horizontal line between twins) is a separate edge type.
 */
export function BirthDiagonalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
}: EdgeProps<DiagonalEdge>) {
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
