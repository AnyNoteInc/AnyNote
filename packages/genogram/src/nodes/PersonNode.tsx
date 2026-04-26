import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { Node } from '@xyflow/react'
import { personWidth } from '../layout/constants'
import type { PersonNodeData } from '../types'
import { PersonLabel } from './primitives/PersonLabel'

type PersonRfNode = Node<PersonNodeData, 'person'>

const STROKE = 2
const STROKE_COLOR = 'var(--genogram-stroke, #333)'
const FILL = 'var(--genogram-fill, #fff)'
const DECEASED_FILL = 'var(--genogram-fill-deceased, #f4f4f4)'

export function PersonNode({ data }: NodeProps<PersonRfNode>) {
  const w = personWidth(data.size)
  const h = w
  const fill = data.isDeceased ? DECEASED_FILL : FILL
  const showCross = data.isDeceased && (data.deathKind === 'early' || data.deathKind === 'tragic')

  return (
    <div
      style={{
        position: 'relative',
        width: w,
        height: h,
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        style={handleStyle}
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        style={handleStyle}
        isConnectable={false}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        style={handleStyle}
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        style={handleStyle}
        isConnectable={false}
      />

      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {data.sex === 'male' ? (
          <rect
            x={STROKE / 2}
            y={STROKE / 2}
            width={w - STROKE}
            height={h - STROKE}
            fill={fill}
            stroke={STROKE_COLOR}
            strokeWidth={STROKE}
          />
        ) : (
          <circle
            cx={w / 2}
            cy={h / 2}
            r={w / 2 - STROKE / 2}
            fill={fill}
            stroke={STROKE_COLOR}
            strokeWidth={STROKE}
          />
        )}

        {data.isOwner &&
          (data.sex === 'male' ? (
            <rect
              x={w * 0.25}
              y={h * 0.25}
              width={w * 0.5}
              height={h * 0.5}
              fill="none"
              stroke={STROKE_COLOR}
              strokeWidth={STROKE}
            />
          ) : (
            <circle
              cx={w / 2}
              cy={h / 2}
              r={w / 4}
              fill="none"
              stroke={STROKE_COLOR}
              strokeWidth={STROKE}
            />
          ))}

        {data.isUnknown && (
          <text
            x={w / 2}
            y={h / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={w * 0.5}
            fill={STROKE_COLOR}
          >
            ?
          </text>
        )}

        {data.partnerOrder !== undefined && !data.isUnknown && !data.isOwner && (
          <text
            x={w / 2}
            y={h / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={w * 0.35}
            fill={STROKE_COLOR}
          >
            {data.partnerOrder}
          </text>
        )}

        {showCross && (
          <>
            <line
              x1={STROKE}
              y1={STROKE}
              x2={w - STROKE}
              y2={h - STROKE}
              stroke={STROKE_COLOR}
              strokeWidth={STROKE}
            />
            <line
              x1={w - STROKE}
              y1={STROKE}
              x2={STROKE}
              y2={h - STROKE}
              stroke={STROKE_COLOR}
              strokeWidth={STROKE}
            />
          </>
        )}
      </svg>

      <PersonLabel label={data.label} shapeWidth={w} shapeHeight={h} />
    </div>
  )
}

const handleStyle = {
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 1,
  minHeight: 1,
  border: 0,
  background: 'transparent',
}
