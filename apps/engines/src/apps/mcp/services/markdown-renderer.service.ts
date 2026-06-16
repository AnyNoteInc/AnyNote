import { Injectable } from '@nestjs/common'

type Node = {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  content?: Node[]
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

type Doc = { type: 'doc'; content?: Node[] }

@Injectable()
export class MarkdownRenderer {
  render(doc: Doc | null | undefined): string {
    if (!doc || !doc.content) return ''
    return doc.content
      .map((n) => this.renderNode(n))
      .join('\n\n')
      .trimEnd()
  }

  private renderNode(node: Node): string {
    switch (node.type) {
      case 'paragraph':
        return this.renderInline(node.content ?? [])
      case 'heading': {
        const level = Math.max(1, Math.min(6, Number(node.attrs?.level ?? 1)))
        return `${'#'.repeat(level)} ${this.renderInline(node.content ?? [])}`
      }
      case 'bulletList':
        return (node.content ?? []).map((li) => `- ${this.renderListItem(li)}`).join('\n')
      case 'orderedList':
        return (node.content ?? [])
          .map((li, i) => `${i + 1}. ${this.renderListItem(li)}`)
          .join('\n')
      case 'blockquote':
        return (node.content ?? []).map((n) => `> ${this.renderNode(n)}`).join('\n')
      case 'codeBlock': {
        const lang = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
        return (
          '```' + lang + '\n' + (node.content?.map((c) => c.text ?? '').join('') ?? '') + '\n```'
        )
      }
      case 'table':
        return this.renderTable(node)
      case 'horizontalRule':
        return '---'
      case 'hardBreak':
        return '  \n'
      case 'text':
        return this.renderText(node)
      default:
        return this.renderInline(node.content ?? [])
    }
  }

  private renderTable(node: Node): string {
    const rows = node.content ?? []
    if (rows.length === 0) return ''
    const cellText = (cell: Node): string =>
      (cell.content ?? [])
        .map((n) => this.renderNode(n))
        .join(' ')
        .trim()
        .replace(/\|/g, '\\|')
        .replace(/\r?\n/g, ' ')
    const lines: string[] = []
    rows.forEach((row, rowIdx) => {
      const cells = (row.content ?? []).map(cellText)
      lines.push(`| ${cells.join(' | ')} |`)
      if (rowIdx === 0) lines.push(`| ${cells.map(() => '---').join(' | ')} |`)
    })
    return lines.join('\n')
  }

  private renderListItem(li: Node): string {
    return (li.content ?? []).map((n) => this.renderNode(n)).join(' ')
  }

  private renderInline(nodes: Node[]): string {
    return nodes.map((n) => this.renderNode(n)).join('')
  }

  private renderText(node: Node): string {
    let out = node.text ?? ''
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') out = `**${out}**`
      else if (mark.type === 'italic') out = `_${out}_`
      else if (mark.type === 'code') out = `\`${out}\``
      else if (mark.type === 'link') {
        const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : ''
        out = `[${out}](${href})`
      }
    }
    return out
  }
}
