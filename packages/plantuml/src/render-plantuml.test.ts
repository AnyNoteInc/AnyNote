import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderPlantuml } from './render-plantuml'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('renderPlantuml', () => {
  it('short-circuits empty source without a network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const result = await renderPlantuml('id', '   ', 'light')
    expect(result).toEqual({ ok: true, svg: '' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns the proxy RenderResult on success', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, svg: '<svg/>' }), { status: 200 }),
    )
    const result = await renderPlantuml('id', '@startuml\nA->B\n@enduml', 'dark')
    expect(result).toEqual({ ok: true, svg: '<svg/>' })
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/plantuml/render',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('passes share auth context to the proxy when provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, svg: '<svg/>' }), { status: 200 }),
    )

    await renderPlantuml('id', '@startuml\nA->B\n@enduml', 'dark', { shareId: 'share-1' })

    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toMatchObject({
      source: '@startuml\nA->B\n@enduml',
      shareId: 'share-1',
    })
  })

  it('maps a thrown fetch error to a RenderResult error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    const result = await renderPlantuml('id', '@startuml\nA->B\n@enduml', 'light')
    expect(result).toEqual({ ok: false, error: 'network down' })
  })
})
