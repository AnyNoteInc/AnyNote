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
    if (!markdown || !markdown.trim()) return { type: 'doc', content: [] }
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
      case 'space':
        return []
      default: {
        const raw = (token as { text?: string }).text ?? ''
        if (!raw) return []
        return [{ type: 'paragraph', content: [{ type: 'text', text: raw }] }]
      }
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
      default: {
        const text = (token as { text?: string }).text ?? ''
        if (!text) return []
        return [{ type: 'text', text, ...(marks.length ? { marks } : {}) }]
      }
    }
  }
}
