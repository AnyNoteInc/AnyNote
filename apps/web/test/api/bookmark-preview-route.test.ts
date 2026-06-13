import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn<() => Promise<unknown>>(),
}))

vi.mock('@/lib/get-session', () => ({
  getSession: mocks.getSession,
}))

import { handlePreview, __testHooks } from '../../src/app/api/bookmark/preview/handler'

const APP_ORIGIN = 'http://localhost:3000'
const TARGET = 'https://news.example.com/story'

type LookupResult = Array<{ address: string; family: number }>

const publicLookup = () => Promise.resolve([{ address: '93.184.216.34', family: 4 }] as LookupResult)
const privateLookup = () => Promise.resolve([{ address: '10.0.0.5', family: 4 }] as LookupResult)

function htmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
}

function callRoute(
  opts: {
    url?: string
    ip?: string
    fetchFn?: typeof fetch
    lookup?: (h: string) => Promise<LookupResult>
  } = {},
) {
  const req = new Request(`${APP_ORIGIN}/api/bookmark/preview`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': opts.ip ?? '203.0.113.7',
    },
    body: JSON.stringify({ url: opts.url ?? TARGET }),
  }) as unknown as NextRequest
  return handlePreview(req, {
    fetchFn: opts.fetchFn,
    lookup: opts.lookup ?? publicLookup,
  })
}

beforeEach(() => {
  mocks.getSession.mockReset().mockResolvedValue({ user: { id: 'u1' } })
  __testHooks.resetRateLimit()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('POST /api/bookmark/preview — auth gate', () => {
  it('returns 401 when there is no session, without fetching', async () => {
    mocks.getSession.mockResolvedValue(null)
    const fetchFn = vi.fn<typeof fetch>()
    const res = await callRoute({ fetchFn })
    expect(res.status).toBe(401)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('POST /api/bookmark/preview — SSRF guard', () => {
  it('refuses a target that resolves to a private address — no fetch, empty result', async () => {
    const fetchFn = vi.fn<typeof fetch>()
    const res = await callRoute({ fetchFn, lookup: privateLookup })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refuses a non-https url — no fetch, empty result', async () => {
    const fetchFn = vi.fn<typeof fetch>()
    const res = await callRoute({ url: 'http://news.example.com/story', fetchFn })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refuses a 3xx redirect whose Location resolves to a private host — stops, empty', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 302, headers: { location: 'https://internal.example.com/x' } }),
    )
    // public for the original host, private for the redirect target
    const lookup = (h: string) =>
      h === 'internal.example.com' ? privateLookup() : publicLookup()
    const res = await callRoute({ fetchFn, lookup })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
    // one fetch for the original, then the redirect target is refused before a 2nd fetch
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('follows ONE safe redirect and parses the final document', async () => {
    const fetchFn = vi.fn<typeof fetch>()
    fetchFn
      .mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { location: 'https://final.example.com/p' } }),
      )
      .mockResolvedValueOnce(htmlResponse('<title>Final Page</title>'))
    const res = await callRoute({ fetchFn })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ title: 'Final Page' })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('stops after a single redirect (no infinite redirect chains)', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 302, headers: { location: 'https://hop.example.com/again' } }),
    )
    const res = await callRoute({ fetchFn })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
    expect(fetchFn).toHaveBeenCalledTimes(2) // original + one follow, then stop
  })
})

describe('POST /api/bookmark/preview — happy parse', () => {
  it('parses og metadata from the fetched HTML', async () => {
    const html = `
      <head>
        <meta property="og:title" content="Great Story" />
        <meta property="og:description" content="What happened next." />
        <meta property="og:image" content="https://cdn.example.com/img.png" />
      </head>`
    const fetchFn = vi.fn<typeof fetch>(async () => htmlResponse(html))
    const res = await callRoute({ fetchFn })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      title: 'Great Story',
      description: 'What happened next.',
      image: 'https://cdn.example.com/img.png',
    })
  })

  it('drops a javascript: image from the parsed HTML', async () => {
    const html = `<meta property="og:title" content="X" />
      <meta property="og:image" content="javascript:alert(1)" />`
    const fetchFn = vi.fn<typeof fetch>(async () => htmlResponse(html))
    const res = await callRoute({ fetchFn })
    const body = await res.json()
    expect(body.title).toBe('X')
    expect(body.image).toBeUndefined()
  })

  it('returns empty {} when the upstream errors (never leaks the target error)', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new Error('ECONNREFUSED internal detail')
    })
    const res = await callRoute({ fetchFn })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
  })

  it('returns empty {} on a non-2xx final status', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response('nope', { status: 404 }))
    const res = await callRoute({ fetchFn })
    expect(await res.json()).toEqual({})
  })
})

describe('POST /api/bookmark/preview — bounded body read', () => {
  it('reads at most 512KB and still parses head tags near the top', async () => {
    const head = `<head><title>Capped</title></head>`
    const filler = 'x'.repeat(2 * 1024 * 1024) // 2MB tail past the cap
    let pulled = 0
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        // First chunk carries the head; subsequent chunks are filler. Track how
        // much we were asked for so we can assert the read stopped early.
        if (pulled === 0) {
          controller.enqueue(encoder.encode(head))
          pulled += head.length
          return
        }
        if (pulled > 4 * 1024 * 1024) {
          controller.close()
          return
        }
        const chunk = filler.slice(0, 64 * 1024)
        controller.enqueue(encoder.encode(chunk))
        pulled += chunk.length
      },
    })
    const fetchFn = vi.fn<typeof fetch>(
      async () =>
        new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } }),
    )
    const res = await callRoute({ fetchFn })
    expect(await res.json()).toEqual({ title: 'Capped' })
    // The read must have stopped well before draining the 2MB+ body.
    expect(pulled).toBeLessThan(1024 * 1024)
  })
})

describe('POST /api/bookmark/preview — per-IP rate limit', () => {
  it('returns 429 after the per-minute cap, without fetching', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => htmlResponse('<title>ok</title>'))
    const ip = '198.51.100.42'
    for (let i = 0; i < 20; i += 1) {
      const res = await callRoute({ ip, fetchFn })
      expect(res.status).toBe(200)
    }
    const callsBefore = fetchFn.mock.calls.length
    const limited = await callRoute({ ip, fetchFn })
    expect(limited.status).toBe(429)
    expect(fetchFn.mock.calls.length).toBe(callsBefore)
  })

  it('a different IP is unaffected', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => htmlResponse('<title>ok</title>'))
    for (let i = 0; i < 20; i += 1) await callRoute({ ip: '198.51.100.1', fetchFn })
    expect((await callRoute({ ip: '198.51.100.1', fetchFn })).status).toBe(429)
    expect((await callRoute({ ip: '198.51.100.2', fetchFn })).status).toBe(200)
  })
})
