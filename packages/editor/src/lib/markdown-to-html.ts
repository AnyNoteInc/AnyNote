import { marked } from 'marked'

/** Markdown → HTML for editor.insertContent(). Synchronous by contract. */
export function markdownToHtml(source: string): string {
  const out = marked.parse(source, { async: false, gfm: true })
  return typeof out === 'string' ? out : ''
}
