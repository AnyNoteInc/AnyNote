import { marked, type Token, type Tokens } from 'marked'

type Mark = { type: string; attrs?: Record<string, unknown> }

export type TiptapNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: Mark[]
}

export type TiptapDoc = { type: 'doc'; content: TiptapNode[] }

export type ParseOptions = {
  /** Rewrite image srcs (e.g. archive-relative paths → /api/files/<id>). Return null to keep the original. */
  resolveImageSrc?: (src: string) => string | null
}

export function markdownToTiptap(markdown: string, opts: ParseOptions = {}): TiptapDoc {
  if (!markdown?.trim()) return { type: 'doc', content: [] }
  const tokens = marked.lexer(markdown, { gfm: true })
  return { type: 'doc', content: tokens.flatMap((t) => parseBlock(t, opts)) }
}

/**
 * Parse a whole imported document: a leading H1 becomes the page title (stripped
 * from the body); otherwise the fallback (file/folder name) is used.
 */
export function parseMarkdownDocument(
  markdown: string,
  fallbackTitle: string,
  opts: ParseOptions = {},
): { title: string; doc: TiptapDoc } {
  const tokens = marked.lexer(markdown ?? '', { gfm: true })
  let title = fallbackTitle
  let body: Token[] = tokens
  const firstIdx = tokens.findIndex((t) => t.type !== 'space')
  const first = firstIdx >= 0 ? tokens[firstIdx] : undefined
  if (first && first.type === 'heading' && (first as Tokens.Heading).depth === 1) {
    title = (first as Tokens.Heading).text.trim() || fallbackTitle
    body = tokens.filter((_, i) => i !== firstIdx)
  }
  return { title, doc: { type: 'doc', content: body.flatMap((t) => parseBlock(t, opts)) } }
}

function parseBlock(token: Token, opts: ParseOptions): TiptapNode[] {
  switch (token.type) {
    case 'paragraph': {
      const t = token as Tokens.Paragraph
      return splitParagraphWithImages(t.tokens, opts)
    }
    case 'heading': {
      const t = token as Tokens.Heading
      return [
        {
          type: 'heading',
          attrs: { level: Math.max(1, Math.min(6, t.depth)) },
          content: parseInline(t.tokens, opts),
        },
      ]
    }
    case 'list':
      return [parseList(token as Tokens.List, opts)]
    case 'blockquote': {
      const t = token as Tokens.Blockquote
      return [
        {
          type: 'blockquote',
          content: t.tokens.flatMap((child) => parseBlock(child, opts)),
        },
      ]
    }
    case 'code': {
      const t = token as Tokens.Code
      return [
        {
          type: 'codeBlock',
          attrs: t.lang ? { language: t.lang } : {},
          content: [{ type: 'text', text: t.text }],
        },
      ]
    }
    case 'hr':
      return [{ type: 'horizontalRule' }]
    case 'table': {
      const t = token as Tokens.Table
      const headerRow: TiptapNode = {
        type: 'tableRow',
        content: t.header.map((cell) => ({
          type: 'tableHeader',
          content: [{ type: 'paragraph', content: parseInline(cell.tokens, opts) }],
        })),
      }
      const bodyRows: TiptapNode[] = t.rows.map((row) => ({
        type: 'tableRow',
        content: row.map((cell) => ({
          type: 'tableCell',
          content: [{ type: 'paragraph', content: parseInline(cell.tokens, opts) }],
        })),
      }))
      return [{ type: 'table', content: [headerRow, ...bodyRows] }]
    }
    case 'space':
      return []
    default: {
      const inlineTokens = (token as { tokens?: Token[] }).tokens
      if (inlineTokens) return splitParagraphWithImages(inlineTokens, opts)
      const raw = (token as { text?: string }).text ?? ''
      if (!raw) return []
      return [{ type: 'paragraph', content: [{ type: 'text', text: raw }] }]
    }
  }
}

function parseList(token: Tokens.List, opts: ParseOptions): TiptapNode {
  const isTask = token.items.some((i) => i.task)
  if (isTask) {
    return {
      type: 'taskList',
      content: token.items.map((item) => ({
        type: 'taskItem',
        attrs: { checked: item.checked === true },
        content: item.tokens.flatMap((child) => parseBlock(child, opts)),
      })),
    }
  }
  return {
    type: token.ordered ? 'orderedList' : 'bulletList',
    content: token.items.map((item) => ({
      type: 'listItem',
      content: item.tokens.flatMap((child) => parseBlock(child, opts)),
    })),
  }
}

// The Tiptap Image node is block-level (the editor's schema mirrors this), but
// markdown allows images inline. Split the paragraph around each image so the
// emitted JSON is schema-valid: text runs become paragraphs, images become
// sibling block nodes.
function splitParagraphWithImages(tokens: Token[], opts: ParseOptions): TiptapNode[] {
  const out: TiptapNode[] = []
  let run: Token[] = []
  const flush = () => {
    if (run.length === 0) return
    const inline = parseInline(run, opts)
    if (inline.length > 0) out.push({ type: 'paragraph', content: inline })
    run = []
  }
  for (const tok of tokens) {
    if (tok.type === 'image') {
      flush()
      const img = tok as Tokens.Image
      const resolved = opts.resolveImageSrc?.(img.href) ?? null
      out.push({
        type: 'image',
        attrs: { src: resolved ?? img.href, ...(img.text ? { alt: img.text } : {}) },
      })
    } else {
      run.push(tok)
    }
  }
  flush()
  return out
}

function parseInline(tokens: Token[], opts: ParseOptions): TiptapNode[] {
  const out: TiptapNode[] = []
  for (const token of tokens) out.push(...parseInlineToken(token, [], opts))
  return out
}

function parseInlineToken(token: Token, marks: Mark[], opts: ParseOptions): TiptapNode[] {
  switch (token.type) {
    case 'text': {
      const t = token as Tokens.Text
      if (t.tokens) return t.tokens.flatMap((nested) => parseInlineToken(nested, marks, opts))
      return [{ type: 'text', text: t.text, ...(marks.length ? { marks } : {}) }]
    }
    case 'strong': {
      const t = token as Tokens.Strong
      return t.tokens.flatMap((nested) =>
        parseInlineToken(nested, [...marks, { type: 'bold' }], opts),
      )
    }
    case 'em': {
      const t = token as Tokens.Em
      return t.tokens.flatMap((nested) =>
        parseInlineToken(nested, [...marks, { type: 'italic' }], opts),
      )
    }
    case 'codespan': {
      const t = token as Tokens.Codespan
      return [{ type: 'text', text: t.text, marks: [...marks, { type: 'code' }] }]
    }
    case 'link': {
      const t = token as Tokens.Link
      const linkMark: Mark = { type: 'link', attrs: { href: t.href } }
      return t.tokens.flatMap((nested) => parseInlineToken(nested, [...marks, linkMark], opts))
    }
    case 'image':
      // Images are hoisted to block level by splitParagraphWithImages; an image
      // in a context that cannot split (e.g. a heading) is dropped.
      return []
    case 'br':
      return [{ type: 'hardBreak', ...(marks.length ? { marks } : {}) }]
    default: {
      const text = (token as { text?: string }).text ?? ''
      if (!text) return []
      return [{ type: 'text', text, ...(marks.length ? { marks } : {}) }]
    }
  }
}
