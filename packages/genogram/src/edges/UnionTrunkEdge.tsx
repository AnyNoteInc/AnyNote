import type { Edge, EdgeProps } from "@xyflow/react"
import type { GenogramEdgeData, GenogramEdgeType } from "../types"
import { EDGE_STROKE, EDGE_WIDTH } from "./primitives/constants"

type TrunkEdge = Edge<GenogramEdgeData, GenogramEdgeType>

export function UnionTrunkEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
}: EdgeProps<TrunkEdge>) {
  // Vertical from union anchor down to hub. In canonical layout sourceX
  // equals targetX; we draw via sourceX so slight drift is forgiven.
  return (
    <path
      id={id}
      d={`M ${sourceX} ${sourceY} L ${sourceX} ${targetY} L ${targetX} ${targetY}`}
      fill="none"
      stroke={EDGE_STROKE}
      strokeWidth={EDGE_WIDTH}
      style={style}
    />
  )
}
