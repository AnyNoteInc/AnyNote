'use client'

const DEFAULT_DRAWIO_URL = 'https://embed.diagrams.net'

// NEXT_PUBLIC_DRAWIO_URL is inlined at build time. Read it at call time so tests
// (and any runtime override) see the current value. Point it at a self-hosted
// jgraph/drawio instance to avoid the diagrams.net CDN.
export function resolveDrawioUrl(): string {
  return process.env.NEXT_PUBLIC_DRAWIO_URL || DEFAULT_DRAWIO_URL
}
