'use client'

import dynamic from 'next/dynamic'

import type { DiagramBoardProps, DiagramConfig } from './types'

const DiagramBoardInnerDynamic = dynamic(
  () => import('./board-inner').then((m) => m.DiagramBoardInner),
  { ssr: false },
)

export function DiagramBoard(props: DiagramBoardProps & { config: DiagramConfig }) {
  return <DiagramBoardInnerDynamic {...props} />
}
