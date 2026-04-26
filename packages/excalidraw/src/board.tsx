'use client'

import dynamic from 'next/dynamic'

import type { BoardProps } from './types'

// Excalidraw touches `window`/`document` during module evaluation, so the
// inner component — and therefore Excalidraw itself — is loaded via
// `next/dynamic` with `ssr: false`. Consumers can additionally wrap
// `Board` in their own `dynamic(() => import("@repo/excalidraw"), { ssr: false })`
// to keep the package out of the initial RSC bundle.
const BoardInnerDynamic = dynamic(() => import('./board-inner').then((m) => m.BoardInner), {
  ssr: false,
})

export function Board(props: BoardProps) {
  return <BoardInnerDynamic {...props} />
}
