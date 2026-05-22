import type { PaletteMode } from '@mui/material'

export type ColorMode = PaletteMode

export type RenderResult = { ok: true; svg: string } | { ok: false; error: string }

export type DiagramRenderer = (
  id: string,
  source: string,
  mode: ColorMode,
) => Promise<RenderResult>
