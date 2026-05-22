import type { ColorMode } from '@repo/diagram-board/render-types'

/** Mermaid built-in theme name for the given site color mode. */
export function mermaidThemeForMode(mode: ColorMode): 'default' | 'dark' {
  return mode === 'dark' ? 'dark' : 'default'
}
