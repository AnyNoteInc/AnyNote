import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  renderPlantumlSvg: vi.fn(),
  resolveShareAccess: vi.fn(),
}))

vi.mock('@/lib/get-session', () => ({ getSession: mocks.getSession }))
vi.mock('@/server/plantuml/render', () => ({ renderPlantumlSvg: mocks.renderPlantumlSvg }))
vi.mock('@/lib/share-access', () => ({ resolveShareAccess: mocks.resolveShareAccess }))
vi.mock('@repo/db', () => ({ prisma: {} }))

import { POST } from '../src/app/api/plantuml/render/route'

describe('POST /api/plantuml/render', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.renderPlantumlSvg.mockResolvedValue('<svg>ok</svg>')
  })

  it('allows an anonymous public share viewer to render PlantUML', async () => {
    mocks.getSession.mockResolvedValue(null)
    mocks.resolveShareAccess.mockResolvedValue({
      kind: 'public',
      role: 'READER',
      page: { id: 'page-1' },
    })

    const response = await POST(
      new Request('http://localhost/api/plantuml/render', {
        method: 'POST',
        body: JSON.stringify({ source: '@startuml\nA->B\n@enduml', shareId: 'share-1' }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, svg: '<svg>ok</svg>' })
    expect(mocks.resolveShareAccess).toHaveBeenCalledWith(expect.anything(), 'share-1', null)
  })

  it('still rejects anonymous renders without a valid share', async () => {
    mocks.getSession.mockResolvedValue(null)
    mocks.resolveShareAccess.mockResolvedValue({ kind: 'not_found' })

    const response = await POST(
      new Request('http://localhost/api/plantuml/render', {
        method: 'POST',
        body: JSON.stringify({ source: '@startuml\nA->B\n@enduml', shareId: 'missing' }),
      }),
    )

    expect(response.status).toBe(401)
  })
})
