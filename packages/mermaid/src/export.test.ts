import { describe, expect, it } from 'vitest'
import { svgStringToDataUrl, downloadFilename } from './export'

describe('export helpers', () => {
  it('encodes an SVG string as a base64 data URL', () => {
    const url = svgStringToDataUrl('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true)
  })

  it('builds a timestamped filename with the given extension', () => {
    const name = downloadFilename('svg')
    expect(name).toMatch(/^mermaid-\d+\.svg$/)
  })
})
