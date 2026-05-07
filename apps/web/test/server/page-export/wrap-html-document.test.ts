import { describe, expect, it } from 'vitest'

import { wrapHtmlDocument } from '@/server/page-export/wrap-html-document'

describe('wrapHtmlDocument', () => {
  it('produces a complete HTML document with title and body', () => {
    const out = wrapHtmlDocument({
      bodyHtml: '<p>Hello</p>',
      title: 'My Page',
      icon: null,
    })
    expect(out.startsWith('<!doctype html>')).toBe(true)
    expect(out).toContain('<title>My Page</title>')
    expect(out).toContain('<p>Hello</p>')
    expect(out).toContain('class="document-title"')
    expect(out).toContain('My Page')
  })

  it('escapes HTML metacharacters in title', () => {
    const out = wrapHtmlDocument({
      bodyHtml: '',
      title: '<script>alert(1)</script>',
      icon: null,
    })
    expect(out).not.toContain('<script>alert(1)</script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('inserts the icon before the title when present', () => {
    const out = wrapHtmlDocument({ bodyHtml: '', title: 'Page', icon: '📄' })
    expect(out).toMatch(/<h1[^>]*>📄 Page<\/h1>/)
  })

  it('inlines the print stylesheet', () => {
    const out = wrapHtmlDocument({ bodyHtml: '', title: 'Page', icon: null })
    expect(out).toContain('<style>')
    expect(out).toContain('document-title')
    expect(out).toContain('@page')
  })

  it('inlines A4 print margins instead of edge-to-edge pages', () => {
    const out = wrapHtmlDocument({ bodyHtml: '', title: 'Page', icon: null })
    expect(out).toContain('@page { size: A4; margin: 20mm; }')
    expect(out).not.toContain('@page { size: A4; margin: 0; }')
  })
})
