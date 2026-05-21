import { beforeEach, describe, expect, it, vi } from 'vitest'

const { initialize, parse, render } = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}))

vi.mock('mermaid', () => ({
  default: { initialize, parse, render },
}))

import { renderMermaid } from './render-mermaid'

beforeEach(() => {
  initialize.mockReset()
  parse.mockReset()
  render.mockReset()
})

describe('renderMermaid', () => {
  it('returns ok + svg when mermaid renders successfully', async () => {
    parse.mockResolvedValue(true)
    render.mockResolvedValue({ svg: '<svg></svg>' })

    const result = await renderMermaid('id1', 'graph TD; A-->B;', 'dark')

    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' }),
    )
    expect(result).toEqual({ ok: true, svg: '<svg></svg>' })
  })

  it('returns an error result when parse rejects', async () => {
    parse.mockRejectedValue(new Error('Parse error on line 2'))

    const result = await renderMermaid('id2', 'not a diagram', 'light')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Parse error')
    expect(render).not.toHaveBeenCalled()
  })

  it('treats blank source as empty (no render, no error)', async () => {
    const result = await renderMermaid('id3', '   ', 'light')
    expect(result).toEqual({ ok: true, svg: '' })
    expect(render).not.toHaveBeenCalled()
  })
})
