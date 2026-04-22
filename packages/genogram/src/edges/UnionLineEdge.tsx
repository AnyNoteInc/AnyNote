import type { Edge, EdgeProps } from "@xyflow/react"
import type { GenogramEdgeData, GenogramEdgeType } from "../types"
import { DivorceMarker } from "./primitives/DivorceMarker"
import { EDGE_STROKE, EDGE_WIDTH } from "./primitives/constants"

type UnionRfEdge = Edge<GenogramEdgeData, GenogramEdgeType>

/**
 * Straight line between union partners. Solid for marriage, dashed for
 * cohabitation. Divorce slashes rendered on top when data.decorations
 * contains "divorceSlash".
 */
export function UnionLineEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  type,
  data,
  style,
}: EdgeProps<UnionRfEdge>) {
  const dashed = type === "unionCohabitation"
  const hasDivorce = data?.decorations?.includes("divorceSlash") ?? false

  return (
    <g>
      <path
        id={id}
        d={`M ${sourceX} ${sourceY} L ${targetX} ${targetY}`}
        fill="none"
        stroke={EDGE_STROKE}
        strokeWidth={EDGE_WIDTH}
        strokeDasharray={dashed ? "6 4" : undefined}
        style={style}
      />
      {hasDivorce && (
        <DivorceMarker
          sourceX={sourceX}
          sourceY={sourceY}
          targetX={targetX}
          targetY={targetY}
          custodySide={data?.custodySide}
        />
      )}
    </g>
  )
}
