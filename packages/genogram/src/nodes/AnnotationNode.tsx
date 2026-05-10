import type { Node, NodeProps } from '@xyflow/react'
import type { AnnotationNodeData } from '../types'

type AnnotationRfNode = Node<AnnotationNodeData, 'annotation'>

export function AnnotationNode({ data }: NodeProps<AnnotationRfNode>) {
  return (
    <div
      style={{
        padding: '4px 8px',
        background: 'var(--genogram-annotation-bg, #fffbe6)',
        border: '1px solid var(--genogram-annotation-border, #e0d490)',
        borderRadius: 6,
        fontSize: 9,
        lineHeight: 1.3,
        maxWidth: 200,
        whiteSpace: 'pre-wrap',
      }}
    >
      {data.text}
    </div>
  )
}
