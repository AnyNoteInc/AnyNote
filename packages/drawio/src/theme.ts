import type { PaletteMode } from '@mui/material'
import type { UrlParameters } from 'react-drawio'

type DrawioThemeParameters = Required<Pick<UrlParameters, 'dark' | 'ui'>>

export function getDrawioThemeParameters(mode: PaletteMode): DrawioThemeParameters {
  return mode === 'dark' ? { ui: 'dark', dark: true } : { ui: 'kennedy', dark: false }
}
