import { CodeBlockPro, type LanguageConfig } from '@tiptap-codeless/extension-code-block-pro'
import { createLowlight } from 'lowlight'
import bash from 'highlight.js/lib/languages/bash'
import javascript from 'highlight.js/lib/languages/javascript'
import python from 'highlight.js/lib/languages/python'
import typescript from 'highlight.js/lib/languages/typescript'

import type { ColorMode } from '../theme-mode'

// Languages offered in the code-block language selector. `mermaid` renders as a
// diagram (handled by the extension); the rest are syntax-highlighted via lowlight.
export const CODE_BLOCK_LANGUAGES: LanguageConfig[] = [
  { value: 'mermaid', label: 'Mermaid' },
  { value: 'javascript', label: 'JavaScript', aliases: ['js'] },
  { value: 'typescript', label: 'TypeScript', aliases: ['ts'] },
  { value: 'python', label: 'Python', aliases: ['py'] },
  { value: 'bash', label: 'Bash', aliases: ['sh', 'shell'] },
]

/** Fresh lowlight instance with only the four highlightable languages registered. */
export function buildCodeBlockLowlight() {
  const lowlight = createLowlight()
  lowlight.register('javascript', javascript)
  lowlight.register('typescript', typescript)
  lowlight.register('python', python)
  lowlight.register('bash', bash)
  return lowlight
}

/** Configured CodeBlockPro extension. `mode` drives the light/dark code-block theme. */
export function buildCodeBlockPro(mode: ColorMode) {
  return CodeBlockPro.configure({
    lowlight: buildCodeBlockLowlight(),
    locale: 'en',
    theme: mode,
    defaultLanguage: null,
    languages: CODE_BLOCK_LANGUAGES,
  })
}
