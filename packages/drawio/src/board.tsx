'use client'

import dynamic from 'next/dynamic'

import type { DrawioBoardProps } from './types'

const DrawioBoardInnerDynamic = dynamic(
  () => import('./board-inner').then((m) => m.DrawioBoardInner),
  { ssr: false },
)

export function DrawioBoard(props: DrawioBoardProps) {
  return <DrawioBoardInnerDynamic {...props} />
}
