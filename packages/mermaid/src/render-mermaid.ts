import mermaid from 'mermaid'

import type { ColorMode, RenderResult } from '@repo/diagram-board/render-types'
import { mermaidThemeForMode } from './mermaid-theme'

export type { RenderResult }

let lastTheme: ColorMode | null = null

/**
 * Validate + render a Mermaid source string to SVG markup. Parse errors are
 * returned (never thrown) so the preview can keep showing the last good render.
 * `id` must be unique per call to avoid Mermaid's internal id collisions.
 */
export async function renderMermaid(id: string, source: string, mode: ColorMode): Promise<RenderResult> {
  if (!source.trim()) return { ok: true, svg: '' }

  if (lastTheme !== mode) {
    mermaid.initialize({ startOnLoad: false, theme: mermaidThemeForMode(mode), securityLevel: 'strict' })
    lastTheme = mode
  }

  try {
    await mermaid.parse(source)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  try {
    const { svg } = await mermaid.render(id, source)
    return { ok: true, svg }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
