import type { PaletteMode } from '@mui/material'

export type ColorMode = PaletteMode

/** Mermaid built-in theme name for the given site color mode. */
export function mermaidThemeForMode(mode: ColorMode): 'default' | 'dark' {
  return mode === 'dark' ? 'dark' : 'default'
}

/** Monaco built-in theme id for the given site color mode. */
export function monacoThemeForMode(mode: ColorMode): 'vs' | 'vs-dark' {
  return mode === 'dark' ? 'vs-dark' : 'vs'
}
