import type { NodeProps } from '@xyflow/react'
import type { Node } from '@xyflow/react'
import type { OwnerCreationDateNodeData } from '../types'
import { RU } from '../i18n/ru'

type OwnerCreationDateRfNode = Node<OwnerCreationDateNodeData, 'genogramCreationDate'>

export function OwnerCreationDateNode({ data }: NodeProps<OwnerCreationDateRfNode>) {
  return (
    <div
      style={{
        fontSize: 11,
        color: 'var(--genogram-text, #333)',
        opacity: 0.65,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        userSelect: 'none',
      }}
    >
      {RU.labels.creationDate}: {data.formattedDate}
    </div>
  )
}
