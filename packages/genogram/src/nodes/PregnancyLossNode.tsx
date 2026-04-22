import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { Node } from "@xyflow/react"
import { LAYOUT } from "../layout/constants"
import type { PregnancyLossNodeData } from "../types"
import { PersonLabel } from "./primitives/PersonLabel"

type LossRfNode = Node<PregnancyLossNodeData, "pregnancyLoss">

const STROKE = 1.5
const STROKE_COLOR = "var(--genogram-stroke, #333)"

export function PregnancyLossNode({ data }: NodeProps<LossRfNode>) {
  const w = LAYOUT.LOSS
  const letter = data.kind === "abortion" ? "A" : "B"

  return (
    <div style={{ position: "relative", width: w, height: w }}>
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        style={anchorHandle}
        isConnectable={false}
      />

      <svg
        width={w}
        height={w}
        viewBox={`0 0 ${w} ${w}`}
        style={{ display: "block", overflow: "visible" }}
      >
        <line
          x1={w / 2}
          y1={0}
          x2={w / 2}
          y2={w}
          stroke={STROKE_COLOR}
          strokeWidth={STROKE}
        />
        <line
          x1={0}
          y1={w / 2}
          x2={w}
          y2={w / 2}
          stroke={STROKE_COLOR}
          strokeWidth={STROKE}
        />
        <text
          x={w * 0.75}
          y={w * 0.35}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={w * 0.5}
          fill={STROKE_COLOR}
        >
          {letter}
        </text>
      </svg>

      <PersonLabel label={data.label} shapeWidth={w} shapeHeight={w} />
    </div>
  )
}

const anchorHandle = {
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 1,
  minHeight: 1,
  border: 0,
  background: "transparent",
}
