import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
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
  const fill = data.lifeStatus === 'deceased' ? DECEASED_FILL : FILL
  const showCross = data.showDeathCross

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
      {/* Target counterpart at the same position as the bottom source handle,
          so the union bracket can drop from male.bottom to female.bottom. */}
      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom-target"
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

        {showCross &&
          (data.sex === 'male' ? (
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
          ) : (
            (() => {
              // For circles we inscribe the cross inside the disc — the
              // diagonal endpoints sit exactly on the stroke at 45° so no
              // line segment leaves the circle. r matches the circle's
              // radius from the rendered <circle> below.
              const cx = w / 2
              const cy = h / 2
              const r = w / 2 - STROKE / 2
              const offset = r / Math.SQRT2
              return (
                <>
                  <line
                    x1={cx - offset}
                    y1={cy - offset}
                    x2={cx + offset}
                    y2={cy + offset}
                    stroke={STROKE_COLOR}
                    strokeWidth={STROKE}
                  />
                  <line
                    x1={cx + offset}
                    y1={cy - offset}
                    x2={cx - offset}
                    y2={cy + offset}
                    stroke={STROKE_COLOR}
                    strokeWidth={STROKE}
                  />
                </>
              )
            })()
          ))}

        {/* partnerOrder is rendered AFTER the death cross so the digit stays
            visible even on a deceased partner — the user wanted the number
            placed inside the element regardless of life status. The
            shouldShowPartnerOrder data flag is honoured for backwards-compat
            but the display now also covers single-partner cases when the
            user explicitly typed an ordinal. */}
        {data.partnerOrder !== undefined && !data.isOwner && (
          <text
            x={w / 2}
            y={h / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={w * 0.35}
            fill={STROKE_COLOR}
            paintOrder="stroke"
            stroke="var(--genogram-fill, #fff)"
            strokeWidth={2.5}
            strokeLinejoin="round"
          >
            {data.partnerOrder}
          </text>
        )}
      </svg>

      <PersonLabel label={data.label} shapeWidth={w} shapeHeight={h} size={data.size} />
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
