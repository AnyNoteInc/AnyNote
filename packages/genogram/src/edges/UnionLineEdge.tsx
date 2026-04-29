import type { Edge, EdgeProps } from '@xyflow/react'
import type { GenogramEdgeData, GenogramEdgeType } from '../types'
import { LAYOUT } from '../layout/constants'
import { DivorceMarker } from './primitives/DivorceMarker'
import { EDGE_STROKE, EDGE_WIDTH } from './primitives/constants'

type UnionRfEdge = Edge<GenogramEdgeData, GenogramEdgeType>

/**
 * Π-shaped bracket between union partners: a vertical drops from each
 * partner handle, joined at the bottom by a horizontal at right angles.
 * Solid for marriage, dashed for cohabitation. Divorce slashes are rendered
 * on the horizontal segment when data.decorations contains "divorceSlash".
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
  const dashed = type === 'unionCohabitation'
  const hasDivorce = data?.decorations?.includes('divorceSlash') ?? false

  // Multi-partner fan-out: when the source/target person owns more than one
  // union, domainToFlow gives each union its own offset on that person's
  // bottom edge so brackets emerge from distinct points, plus a Y offset so
  // the horizontal segments stack at parallel levels instead of collinear.
  const baseX = sourceX + (data?.sourceXOffset ?? 0)
  const partnerX = targetX + (data?.targetXOffset ?? 0)
  const bracketY =
    Math.max(sourceY, targetY) + LAYOUT.UNION_BRACKET_DROP + (data?.bracketYOffset ?? 0)
  const d =
    `M ${baseX} ${sourceY} ` +
    `L ${baseX} ${bracketY} ` +
    `L ${partnerX} ${bracketY} ` +
    `L ${partnerX} ${targetY}`

  return (
    <g>
      {/* Invisible wide hit-area so Playwright (and touch) can click the line */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        data-testid="union-line-hit"
      />
      <path
        id={id}
        d={d}
        fill="none"
        stroke={EDGE_STROKE}
        strokeWidth={EDGE_WIDTH}
        strokeDasharray={dashed ? '6 4' : undefined}
        style={style}
      />
      {hasDivorce && (
        <DivorceMarker
          sourceX={baseX}
          sourceY={sourceY}
          targetX={partnerX}
          targetY={targetY}
          bracketY={bracketY}
          custodySide={data?.custodySide}
          unionId={data?.unionId}
          markPosition={data?.markPosition}
        />
      )}
    </g>
  )
}
