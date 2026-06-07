import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    page: { findFirst: vi.fn() },
    file: { findMany: vi.fn(async () => []) },
  },
  storage: { get: vi.fn() },
  getSession: vi.fn(),
  htmlToPdf: vi.fn(),
  assertMembership: vi.fn(),
}))

// The export route imports @/lib/domain (the createDomain singleton), which is
// `import 'server-only'`. Stub it so vitest can load the module (same as other web tests).
vi.mock('server-only', () => ({}))

// Spread the real @repo/db (PageType, enqueueOutboxEvent, … are value-imported by the
// domain modules) and override only prisma.
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: mocks.prisma }
})

vi.mock('@repo/storage', () => ({
  storage: mocks.storage,
}))

vi.mock('@/lib/get-session', () => ({
  getSession: mocks.getSession,
}))

vi.mock('@/server/page-export/html-to-pdf', () => ({
  htmlToPdf: mocks.htmlToPdf,
}))

// The new route resolves membership via the domain singleton, not prisma. Mock
// the singleton so we control assertMembership per case.
vi.mock('@/lib/domain', () => ({
  domain: { workspace: { assertMembership: mocks.assertMembership } },
}))

import { GET } from '../../src/app/api/pages/[pageId]/export/[format]/route'

const WS_ID = '22222222-2222-4222-8222-222222222222'
const TEXT_PAGE = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Demo',
  icon: null,
  workspaceId: WS_ID,
  content: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
  },
}

function makeRequest(format: string): NextRequest {
  const url = `http://localhost:3000/api/pages/${TEXT_PAGE.id}/export/${format}`
  return new Request(url) as unknown as NextRequest
}

function callRoute(format: string) {
  return GET(makeRequest(format), {
    params: Promise.resolve({ pageId: TEXT_PAGE.id, format }),
  })
}

describe('GET /api/pages/:p/export/:format', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://anynote.test'
    process.env.GOTENBERG_URL = 'http://gotenberg.test'
    process.env.GOTENBERG_TIMEOUT_MS = '5000'

    mocks.getSession.mockReset().mockResolvedValue({ user: { id: 'user-1' } })
    mocks.assertMembership.mockReset().mockResolvedValue(undefined)
    mocks.prisma.page.findFirst.mockReset().mockResolvedValue(TEXT_PAGE)
    mocks.prisma.file.findMany.mockReset().mockResolvedValue([])
    mocks.storage.get.mockReset()
    mocks.htmlToPdf.mockReset()
  })

  afterEach(() => vi.restoreAllMocks())

  it('returns 200 text/html for format=html', async () => {
    const res = await callRoute('html')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('content-disposition')).toContain("filename*=UTF-8''")
    const body = await res.text()
    expect(body).toContain('<!doctype html>')
    expect(body).toContain('Hello')
  })

  it('returns 200 text/markdown for format=md with title prefix', async () => {
    const res = await callRoute('md')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/markdown')
    const body = await res.text()
    expect(body.startsWith('# Demo\n\n')).toBe(true)
    expect(body).toContain('Hello')
  })

  it('returns 200 application/pdf for format=pdf via htmlToPdf', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([0x25, 0x50, 0x44, 0x46]))
        c.close()
      },
    })
    mocks.htmlToPdf.mockResolvedValue(stream)
    const res = await callRoute('pdf')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(mocks.htmlToPdf).toHaveBeenCalledOnce()
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.subarray(0, 4).toString()).toBe('%PDF')
  })

  it('redirects to /sign-in when there is no session', async () => {
    mocks.getSession.mockResolvedValue(null)
    const res = await callRoute('html')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/sign-in?next=')
  })

  it('returns 403 for non-member', async () => {
    const { forbidden } = await import('@repo/domain/errors.ts')
    mocks.assertMembership.mockRejectedValue(forbidden('not a member'))
    const res = await callRoute('html')
    expect(res.status).toBe(403)
  })

  it('returns 404 for missing page', async () => {
    mocks.prisma.page.findFirst.mockResolvedValue(null)
    const res = await callRoute('html')
    expect(res.status).toBe(404)
  })

  it('returns 200 with title-only body when content is null', async () => {
    mocks.prisma.page.findFirst.mockResolvedValue({ ...TEXT_PAGE, content: null })
    const res = await callRoute('html')
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('Demo')
  })

  it('returns 504 when Gotenberg times out', async () => {
    const { GotenbergTimeoutError } = await import('../../src/server/page-export/errors')
    mocks.htmlToPdf.mockRejectedValue(new GotenbergTimeoutError())
    const res = await callRoute('pdf')
    expect(res.status).toBe(504)
  })

  it('returns 502 when Gotenberg upstream errors', async () => {
    const { GotenbergUpstreamError } = await import('../../src/server/page-export/errors')
    mocks.htmlToPdf.mockRejectedValue(new GotenbergUpstreamError(503, 'down'))
    const res = await callRoute('pdf')
    expect(res.status).toBe(502)
  })

  it('returns 404 for invalid format', async () => {
    const res = await GET(makeRequest('zip'), {
      params: Promise.resolve({ pageId: TEXT_PAGE.id, format: 'zip' }),
    })
    expect(res.status).toBe(404)
  })
})
