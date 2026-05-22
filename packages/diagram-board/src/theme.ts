import type { ColorMode } from './render-types'

/** Monaco built-in theme id for the given site color mode. */
export function monacoThemeForMode(mode: ColorMode): 'vs' | 'vs-dark' {
  return mode === 'dark' ? 'vs-dark' : 'vs'
}
