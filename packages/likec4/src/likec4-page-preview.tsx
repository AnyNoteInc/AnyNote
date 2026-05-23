'use client'

import { useEffect, useState } from 'react'
import type { DiagramPreviewProps } from '@repo/diagram-board'

import { Likec4Diagram } from './likec4-diagram'

/** Board adapter: turns the collaborative Y.Text into a source string for Likec4Diagram. */
export function Likec4PagePreview({ ytext, mode, idPrefix }: DiagramPreviewProps) {
  const [source, setSource] = useState(() => ytext.toString())

  useEffect(() => {
    const update = () => setSource(ytext.toString())
    update()
    ytext.observe(update)
    return () => ytext.unobserve(update)
  }, [ytext])

  return <Likec4Diagram source={source} mode={mode} idPrefix={idPrefix} />
}
