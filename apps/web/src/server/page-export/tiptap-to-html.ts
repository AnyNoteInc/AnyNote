import { generateHTML } from '@tiptap/html'

import { buildServerExtensions } from './server-extensions'

type TiptapDoc = { type: string; content?: unknown[] }

export function tiptapJsonToHtml(json: unknown): string {
  if (!json || typeof json !== 'object') return ''
  const doc = json as TiptapDoc
  if (doc.type !== 'doc') return ''
  return generateHTML(doc as Parameters<typeof generateHTML>[0], buildServerExtensions())
}
