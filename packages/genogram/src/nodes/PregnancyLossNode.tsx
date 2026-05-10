import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { Node } from '@xyflow/react'
import { LAYOUT } from '../layout/constants'
import type { PregnancyLossNodeData } from '../types'
import { PersonLabel } from './primitives/PersonLabel'

type LossRfNode = Node<PregnancyLossNodeData, 'pregnancyLoss'>

const STROKE = 1.5
const STROKE_COLOR = 'var(--genogram-stroke, #333)'

export function PregnancyLossNode({ data }: NodeProps<LossRfNode>) {
  const w = LAYOUT.LOSS
  const letter = data.kind === 'abortion' ? 'А' : 'В'

  return (
    <div style={{ position: 'relative', width: w, height: w }}>
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
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* Symmetric X cross inset by 0.15w on every side. Both legs span
            from one diagonal corner to the opposite (in their inset square)
            and have identical length (0.7w·√2). The inset leaves the upper-
            right corner free for the А/В letter so no cross line ever
            enters the glyph area. The X centre is still at the box centre,
            so the cross visually occupies the same footprint as a
            small-square element. */}
        <line
          x1={w * 0.15}
          y1={w * 0.15}
          x2={w * 0.85}
          y2={w * 0.85}
          stroke={STROKE_COLOR}
          strokeWidth={STROKE}
        />
        <line
          x1={w * 0.15}
          y1={w * 0.85}
          x2={w * 0.85}
          y2={w * 0.15}
          stroke={STROKE_COLOR}
          strokeWidth={STROKE}
        />
        <text
          x={w * 0.92}
          y={w * 0.08}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={w * 0.18}
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
  background: 'transparent',
}
