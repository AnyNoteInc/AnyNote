import TurndownService from 'turndown'

import { parseMarkdownDocument, type ParseOptions, type TiptapDoc } from './markdown-to-tiptap'

// Plain turndown for the import chain. The export-side htmlToMarkdown collapses
// blank lines (cosmetic for downloads) which would merge paragraphs if its
// output were re-parsed — so imports keep standard markdown spacing.
const td = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
})

export function parseHtmlDocument(
  html: string,
  fallbackTitle: string,
  opts: ParseOptions = {},
): { title: string; doc: TiptapDoc } {
  const markdown = td.turndown(html ?? '')
  return parseMarkdownDocument(markdown, fallbackTitle, opts)
}
