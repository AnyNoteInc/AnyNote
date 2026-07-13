// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { normalizeSvgForImg, sanitizeSvg } from './sanitize-svg'

describe('sanitizeSvg', () => {
  it('strips empty geometry attrs on <foreignObject> but keeps valid numeric ones', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject y="" x="" width="100" height="50"><div>x</div></foreignObject></svg>'
    const out = sanitizeSvg(input)
    expect(out).not.toContain('y=""')
    expect(out).not.toContain('x=""')
    expect(out).toContain('width="100"')
    expect(out).toContain('height="50"')
  })

  it('retains all valid numeric geometry attrs', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject x="10" y="20" width="5" height="5"><div>x</div></foreignObject></svg>'
    const out = sanitizeSvg(input)
    const doc = new DOMParser().parseFromString(out, 'image/svg+xml')
    const fo = doc.querySelector('foreignObject')
    expect(fo).not.toBeNull()
    expect(fo!.getAttribute('x')).toBe('10')
    expect(fo!.getAttribute('y')).toBe('20')
    expect(fo!.getAttribute('width')).toBe('5')
    expect(fo!.getAttribute('height')).toBe('5')
  })

  it('returns input unchanged when there is no <foreignObject> (identity short-circuit)', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="10" height="10"/></svg>'
    expect(sanitizeSvg(input)).toBe(input)
  })

  it('returns the original string on malformed/unparseable input, never throws', () => {
    const input = '<svg><foreignObject y=""><div>unclosed'
    expect(() => sanitizeSvg(input)).not.toThrow()
    expect(sanitizeSvg(input)).toBe(input)
  })
})

describe('normalizeSvgForImg', () => {
  const parseStrict = (markup: string) => {
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
    return { doc, ok: !doc.querySelector('parsererror') }
  }

  it('repairs mermaid-style unclosed <br> into well-formed XML', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" width="100%"><foreignObject width="100" height="40"><div>a<br>b</div></foreignObject></svg>'
    const out = normalizeSvgForImg(input)
    expect(parseStrict(out).ok).toBe(true)
  })

  it('resolves HTML entities like &nbsp; that strict XML rejects', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="100%"><foreignObject width="10" height="10"><div>a&nbsp;b</div></foreignObject></svg>'
    const out = normalizeSvgForImg(input)
    expect(out).not.toContain('&nbsp;')
    expect(parseStrict(out).ok).toBe(true)
  })

  it('restores intrinsic width/height from viewBox when width is relative', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 134 198" width="100%"><g/></svg>'
    const { doc, ok } = parseStrict(normalizeSvgForImg(input))
    expect(ok).toBe(true)
    const svg = doc.documentElement
    expect(svg.getAttribute('width')).toBe('134')
    expect(svg.getAttribute('height')).toBe('198')
  })

  it('keeps explicit pixel sizes untouched (plantuml-style output)', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200px" height="100px"><g/></svg>'
    const { doc, ok } = parseStrict(normalizeSvgForImg(input))
    expect(ok).toBe(true)
    expect(doc.documentElement.getAttribute('width')).toBe('200px')
    expect(doc.documentElement.getAttribute('height')).toBe('100px')
  })

  it('returns input unchanged when there is no <svg> at all', () => {
    expect(normalizeSvgForImg('<div>nope</div>')).toBe('<div>nope</div>')
    expect(normalizeSvgForImg('')).toBe('')
  })
})
