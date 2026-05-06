import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { HighlightMatches } from '../src/components/search/highlight-matches'

describe('HighlightMatches', () => {
  it('renders the original text when query is empty', () => {
    const html = renderToStaticMarkup(<HighlightMatches text="hello world" query="" />)
    expect(html).toBe('hello world')
  })

  it('wraps single match case-insensitively', () => {
    const html = renderToStaticMarkup(<HighlightMatches text="Hello WORLD" query="world" />)
    expect(html).toContain('<mark>WORLD</mark>')
    expect(html).toContain('Hello ')
  })

  it('wraps multiple matches', () => {
    const html = renderToStaticMarkup(<HighlightMatches text="foo bar foo baz" query="foo" />)
    const mark = html.match(/<mark>foo<\/mark>/g)
    expect(mark).toHaveLength(2)
  })

  it('escapes regex metacharacters in query', () => {
    const html = renderToStaticMarkup(<HighlightMatches text="a.b" query="." />)
    expect(html).toContain('<mark>.</mark>')
    expect(html).toContain('a')
    expect(html).toContain('b')
  })
})
