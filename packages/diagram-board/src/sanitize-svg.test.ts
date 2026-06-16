// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sanitizeSvg } from './sanitize-svg'

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
