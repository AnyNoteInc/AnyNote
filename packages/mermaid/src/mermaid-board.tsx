'use client'

import dynamic from 'next/dynamic'

import type { MermaidBoardProps } from './types'

// Monaco + mermaid touch window/document at module-eval time, so the inner
// component is loaded via next/dynamic with ssr:false.
const MermaidBoardInnerDynamic = dynamic(
  () => import('./mermaid-board-inner').then((m) => m.MermaidBoardInner),
  { ssr: false },
)

export function MermaidBoard(props: MermaidBoardProps) {
  return <MermaidBoardInnerDynamic {...props} />
}
