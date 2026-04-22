import type { Edge, EdgeProps } from "@xyflow/react"
import type { GenogramEdgeData, GenogramEdgeType } from "../types"
import { EDGE_STROKE, EDGE_WIDTH } from "./primitives/constants"

type TwinHEdge = Edge<GenogramEdgeData, GenogramEdgeType>

/**
 * Horizontal line between two twin members. Source/target handles are the
 * right side of the left twin and the left side of the right twin, so the
 * line naturally crosses the gap at shape-center y.
 */
export function TwinHorizontalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
}: EdgeProps<TwinHEdge>) {
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
