'use client'

import { useEffect, useState } from 'react'
import type { DiagramPreviewProps } from '@repo/diagram-board'

import { Likec4Diagram } from './likec4-diagram'

/** Board adapter: turns the collaborative Y.Text into a source string for Likec4Diagram. */
export function Likec4PagePreview({ ytext, mode, idPrefix }: DiagramPreviewProps) {
  const [source, setSource] = useState(() => ytext.toString())

  useEffect(() => {
    // Functional updater bails out (same reference) when the text is unchanged, so
    // Yjs observe events that don't alter the source don't re-arm Likec4Diagram's
    // debounce/parse. Dedup belongs here, not in Likec4Diagram (kept dedup-free for
    // StrictMode safety).
    const update = () => {
      const next = ytext.toString()
      setSource((prev) => (prev === next ? prev : next))
    }
    update()
    ytext.observe(update)
    return () => ytext.unobserve(update)
  }, [ytext])

  return <Likec4Diagram source={source} mode={mode} idPrefix={idPrefix} />
}
