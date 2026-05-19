import { Injectable } from '@nestjs/common'
import { marked, type Token, type Tokens } from 'marked'

type Mark = { type: string; attrs?: Record<string, unknown> }

type TiptapNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: Mark[]
}

export type TiptapDoc = { type: 'doc'; content: TiptapNode[] }

@Injectable()
export class MarkdownParser {
  parse(markdown: string): TiptapDoc {
    if (!markdown?.trim()) return { type: 'doc', content: [] }
    const tokens = marked.lexer(markdown, { gfm: true })
    return { type: 'doc', content: tokens.flatMap((t) => this.parseBlock(t)) }
  }

  private parseBlock(token: Token): TiptapNode[] {
    switch (token.type) {
      case 'paragraph': {
        const t = token as Tokens.Paragraph
        return [{ type: 'paragraph', content: this.parseInline(t.tokens) }]
      }
      case 'heading': {
        const t = token as Tokens.Heading
        return [
          {
            type: 'heading',
            attrs: { level: Math.max(1, Math.min(6, t.depth)) },
            content: this.parseInline(t.tokens),
          },
        ]
      }
      case 'list':
        return [this.parseList(token as Tokens.List)]
      case 'blockquote': {
        const t = token as Tokens.Blockquote
        return [
          {
            type: 'blockquote',
            content: t.tokens.flatMap((child) => this.parseBlock(child)),
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
      case 'space':
        return []
      default: {
        const inlineTokens = (token as { tokens?: Token[] }).tokens
        if (inlineTokens) return [{ type: 'paragraph', content: this.parseInline(inlineTokens) }]
        const raw = (token as { text?: string }).text ?? ''
        if (!raw) return []
        return [{ type: 'paragraph', content: [{ type: 'text', text: raw }] }]
      }
    }
  }

  private parseList(token: Tokens.List): TiptapNode {
    return {
      type: token.ordered ? 'orderedList' : 'bulletList',
      content: token.items.map((item) => ({
        type: 'listItem',
        content: item.tokens.flatMap((child) => this.parseBlock(child)),
      })),
    }
  }

  private parseInline(tokens: Token[]): TiptapNode[] {
    const out: TiptapNode[] = []
    for (const token of tokens) out.push(...this.parseInlineToken(token, []))
    return out
  }

  private parseInlineToken(token: Token, marks: Mark[]): TiptapNode[] {
    switch (token.type) {
      case 'text': {
        const t = token as Tokens.Text
        if (t.tokens) return t.tokens.flatMap((nested) => this.parseInlineToken(nested, marks))
        return [{ type: 'text', text: t.text, ...(marks.length ? { marks } : {}) }]
      }
      case 'strong': {
        const t = token as Tokens.Strong
        return t.tokens.flatMap((nested) =>
          this.parseInlineToken(nested, [...marks, { type: 'bold' }]),
        )
      }
      case 'em': {
        const t = token as Tokens.Em
        return t.tokens.flatMap((nested) =>
          this.parseInlineToken(nested, [...marks, { type: 'italic' }]),
        )
      }
      case 'codespan': {
        const t = token as Tokens.Codespan
        return [{ type: 'text', text: t.text, marks: [...marks, { type: 'code' }] }]
      }
      case 'link': {
        const t = token as Tokens.Link
        const linkMark: Mark = { type: 'link', attrs: { href: t.href } }
        return t.tokens.flatMap((nested) =>
          this.parseInlineToken(nested, [...marks, linkMark]),
        )
      }
      case 'br':
        return [{ type: 'hardBreak', ...(marks.length ? { marks } : {}) }]
      default: {
        const text = (token as { text?: string }).text ?? ''
        if (!text) return []
        return [{ type: 'text', text, ...(marks.length ? { marks } : {}) }]
      }
    }
  }
}
