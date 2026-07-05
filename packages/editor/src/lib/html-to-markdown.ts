import TurndownService from 'turndown'

export function htmlToMarkdown(html: string): string {
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
  })

  td.addRule('callout', {
    filter: (n) => {
      if (n.nodeName !== 'DIV') return false
      return n.getAttribute('data-type') === 'callout'
    },
    replacement: (content, node) => {
      const icon = node.getAttribute('data-emoji') ?? node.getAttribute('data-icon') ?? '💡'
      return `\n> ${icon} ${content.trim()}\n`
    },
  })

  td.addRule('details', {
    filter: (n) => {
      return n.nodeName === 'DETAILS' || n.getAttribute('data-type') === 'details'
    },
    replacement: (content) => {
      const trimmed = content.trim()
      const lines = trimmed.split('\n').filter((l) => l.length > 0)
      const summary = lines[0] ?? ''
      const body = lines.slice(1).join('\n')
      return `\n<details>\n<summary>${summary}</summary>\n${body}\n</details>\n`
    },
  })

  td.addRule('hiddenText', {
    filter: (n) => {
      if (n.nodeName !== 'DIV') return false
      return n.getAttribute('data-type') === 'hidden-text'
    },
    replacement: (content) => `<span class="hidden">${content.trim()}</span>`,
  })

  td.addRule('fileAttachment', {
    filter: (n) => {
      if (n.nodeName !== 'DIV') return false
      return n.getAttribute('data-type') === 'file-attachment'
    },
    replacement: (_content, node) => {
      const name = node.getAttribute('data-name') ?? 'file'
      const url = node.getAttribute('data-url') ?? node.getAttribute('data-href') ?? '#'
      return `[${name}](${url})`
    },
  })

  // Turndown emits two newlines between most blocks for standard markdown.
  // Callers found the extra blank lines noisy — collapse to single newlines
  // (markdown renderers still treat these as paragraph breaks for rendering
  // purposes because of hard line breaks at the block level).
  const raw = td.turndown(html)
  return raw.replaceAll(/\n{2,}/g, '\n').trim() + '\n'
}
