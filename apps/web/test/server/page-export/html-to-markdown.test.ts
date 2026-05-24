import { describe, expect, it } from 'vitest'

import { htmlToMarkdown } from '@/server/page-export/html-to-markdown'

describe('htmlToMarkdown', () => {
  it('emits ATX headings, dashed bullets, fenced code', () => {
    const html = '<h1>Title</h1><ul><li>A</li><li>B</li></ul><pre><code>x</code></pre>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('# Title')
    // turndown emits `- ` followed by indent spaces; check the marker and item text
    expect(md).toMatch(/^-\s+A/m)
    expect(md).toMatch(/^-\s+B/m)
    expect(md).toContain('```')
    expect(md).toContain('x')
  })

  it('renders callout as blockquote with emoji', () => {
    const html = '<div data-type="callout" data-emoji="💡"><p>Hello</p></div>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('> 💡 Hello')
  })

  it('preserves details and summary blocks', () => {
    const html =
      '<details open><summary>Sum</summary><div data-type="detailsContent"><p>Body</p></div></details>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('<details>')
    expect(md).toContain('<summary>Sum</summary>')
  })

  it('keeps hidden text as a span', () => {
    const html = '<div data-type="hidden-text">x</div>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('<span class="hidden">x</span>')
  })

  it('renders file-attachment as a markdown link', () => {
    // turndown skips completely empty elements; real Tiptap output always has
    // at least the filename as text content inside the node
    const html =
      '<div data-type="file-attachment" data-name="doc.pdf" data-url="https://x/api/files/zzz">doc.pdf</div>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('[doc.pdf](https://x/api/files/zzz)')
  })

  it('collapses excess blank lines', () => {
    const html = '<p>A</p><p>B</p>'
    const md = htmlToMarkdown(html)
    expect(md).not.toContain('\n\n\n')
  })
})
