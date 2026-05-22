import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderPlantumlSvg } from '../src/server/plantuml/render'
import { PlantumlTimeoutError, PlantumlUpstreamError } from '../src/server/plantuml/errors'

beforeEach(() => {
  process.env.PLANTUML_URL = 'http://plantuml.test'
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('renderPlantumlSvg', () => {
  it('returns the SVG body on a 2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<svg>ok</svg>', { status: 200 }))
    await expect(renderPlantumlSvg('@startuml\nA->B\n@enduml')).resolves.toContain('<svg>ok</svg>')
  })

  it('returns the PlantUML error SVG on a 400 with an svg body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<svg>err</svg>', { status: 400 }))
    await expect(renderPlantumlSvg('bad')).resolves.toContain('<svg>err</svg>')
  })

  it('throws PlantumlUpstreamError on a 5xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 502 }))
    await expect(renderPlantumlSvg('x')).rejects.toBeInstanceOf(PlantumlUpstreamError)
  })

  it('throws PlantumlTimeoutError when fetch aborts', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }))
    await expect(renderPlantumlSvg('x')).rejects.toBeInstanceOf(PlantumlTimeoutError)
  })
})
