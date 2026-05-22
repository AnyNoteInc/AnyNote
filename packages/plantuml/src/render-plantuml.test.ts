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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, svg: '<svg/>' }), { status: 200 }),
    )
    const result = await renderPlantuml('id', '@startuml\nA->B\n@enduml', 'dark')
    expect(result).toEqual({ ok: true, svg: '<svg/>' })
  })

  it('maps a thrown fetch error to a RenderResult error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    const result = await renderPlantuml('id', '@startuml\nA->B\n@enduml', 'light')
    expect(result).toEqual({ ok: false, error: 'network down' })
  })
})
