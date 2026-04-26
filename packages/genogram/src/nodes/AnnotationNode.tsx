import type { NodeProps } from '@xyflow/react'
import type { Node } from '@xyflow/react'
import type { AnnotationNodeData } from '../types'

type AnnotationRfNode = Node<AnnotationNodeData, 'annotation'>

export function AnnotationNode({ data }: NodeProps<AnnotationRfNode>) {
  return (
    <div
      style={{
        padding: '6px 10px',
        background: 'var(--genogram-annotation-bg, #fffbe6)',
        border: '1px solid var(--genogram-annotation-border, #e0d490)',
        borderRadius: 4,
        fontSize: 12,
        maxWidth: 220,
        whiteSpace: 'pre-wrap',
      }}
    >
      {data.text}
    </div>
  )
}
