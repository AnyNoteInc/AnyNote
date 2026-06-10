import { describe, expect, it } from 'vitest'

import { markdownToTiptap } from '../../src/server/page-import/markdown-to-tiptap'
import { resolveSourcePath, rewriteRelativeLinks } from '../../src/server/page-import/rewrite-links'

describe('resolveSourcePath', () => {
  it('resolves ./ and ../ against the source dir', () => {
    expect(resolveSourcePath('a/b', 'c.md')).toBe('a/b/c.md')
    expect(resolveSourcePath('a/b', './c.md')).toBe('a/b/c.md')
    expect(resolveSourcePath('a/b', '../c.md')).toBe('a/c.md')
    expect(resolveSourcePath('', 'c.md')).toBe('c.md')
    expect(resolveSourcePath('a', '../../c.md')).toBeNull()
  })
})

describe('rewriteRelativeLinks', () => {
  const resolve = (abs: string) => (abs === 'Proj/target.md' ? '/pages/p-1' : null)

  it('rewrites relative md links to internal page links', () => {
    const doc = markdownToTiptap('[см](target.md) и [внешн](https://e.com) и [якорь](#x)')
    const { doc: out, changed } = rewriteRelativeLinks(doc, { sourceKey: 'Proj/a.md', resolve })
    expect(changed).toBe(true)
    const s = JSON.stringify(out)
    expect(s).toContain('"href":"/pages/p-1"')
    expect(s).toContain('https://e.com')
    expect(s).toContain('"href":"#x"')
  })

  it('decodes URI-encoded hrefs before resolving', () => {
    const doc = markdownToTiptap('[a](target%2Emd)')
    const { changed } = rewriteRelativeLinks(doc, { sourceKey: 'Proj/a.md', resolve })
    expect(changed).toBe(true)
  })

  it('reports changed=false when nothing matches', () => {
    const doc = markdownToTiptap('[a](missing.md)')
    const { changed } = rewriteRelativeLinks(doc, { sourceKey: 'Proj/a.md', resolve })
    expect(changed).toBe(false)
  })

  it('consults resolveExternal for absolute hrefs when provided', () => {
    const doc = markdownToTiptap(
      '[n](https://www.notion.so/ws/Page-a1b2c3d4e5f60718293a4b5c6d7e8f90) [e](https://example.com)',
    )
    const { doc: out, changed } = rewriteRelativeLinks(doc, {
      sourceKey: 'a.md',
      resolve: () => null,
      resolveExternal: (href) => (href.includes('notion.so') ? '/pages/p-9' : null),
    })
    expect(changed).toBe(true)
    const s = JSON.stringify(out)
    expect(s).toContain('"href":"/pages/p-9"')
    expect(s).toContain('https://example.com')
  })
})
