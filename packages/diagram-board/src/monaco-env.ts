'use client'

import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

let configured = false

/**
 * Configure Monaco to run fully self-hosted (no CDN): point @monaco-editor/react
 * at the bundled `monaco-editor`, and provide the base editor worker via the
 * cross-bundler `new URL(..., import.meta.url)` worker pattern (works in both
 * Turbopack dev and the webpack production build). Mermaid is a Monarch-only
 * language, so only the base editor.worker is needed. Idempotent + browser-only.
 */
export function configureMonaco(): typeof monaco | null {
  if (typeof window === 'undefined') return null
  if (configured) return monaco
  configured = true
  ;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
    getWorker() {
      return new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker', import.meta.url), {
        type: 'module',
      })
    },
  }
  loader.config({ monaco })
  return monaco
}
