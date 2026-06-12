import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveSsoProviderForEmail: vi.fn<() => Promise<{ ssoProviderId: string } | null>>(),
}))

// `@/lib/domain` pulls in `server-only` + the real prisma singleton; the route
// only needs the resolver.
vi.mock('@/lib/domain', () => ({
  domain: { identity: { resolveSsoProviderForEmail: mocks.resolveSsoProviderForEmail } },
}))

import { POST } from '../../src/app/api/sso/resolve/route'

const APP_ORIGIN = 'http://localhost:3000'

function callRoute(headers: Record<string, string>) {
  const req = new Request(`${APP_ORIGIN}/api/sso/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: APP_ORIGIN, ...headers },
    body: JSON.stringify({ email: 'user@corp.example' }),
  }) as unknown as NextRequest
  return POST(req)
}

async function exhaustLimit(ip: string) {
  for (let i = 0; i < 20; i += 1) {
    const res = await callRoute({ 'x-forwarded-for': ip })
    expect(res.status).toBe(200)
  }
}

beforeEach(() => {
  mocks.resolveSsoProviderForEmail.mockReset().mockResolvedValue(null)
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', APP_ORIGIN)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('POST /api/sso/resolve — per-IP sliding-window rate limit', () => {
  it('the 21st request within a minute gets 429 and never reaches the resolver', async () => {
    await exhaustLimit('10.0.0.1')
    expect(mocks.resolveSsoProviderForEmail).toHaveBeenCalledTimes(20)

    const res = await callRoute({ 'x-forwarded-for': '10.0.0.1' })
    expect(res.status).toBe(429)
    expect(mocks.resolveSsoProviderForEmail).toHaveBeenCalledTimes(20)
  })

  it('a different IP is unaffected by another IP being over the limit', async () => {
    await exhaustLimit('10.0.0.2')
    expect((await callRoute({ 'x-forwarded-for': '10.0.0.2' })).status).toBe(429)

    const other = await callRoute({ 'x-forwarded-for': '10.0.0.3' })
    expect(other.status).toBe(200)
  })

  it('the window slides: the same IP is allowed again after a minute', async () => {
    await exhaustLimit('10.0.0.4')
    expect((await callRoute({ 'x-forwarded-for': '10.0.0.4' })).status).toBe(429)

    vi.advanceTimersByTime(61_000)
    const res = await callRoute({ 'x-forwarded-for': '10.0.0.4' })
    expect(res.status).toBe(200)
  })

  it('uses only the first x-forwarded-for hop — spoofed extra hops share one bucket', async () => {
    await exhaustLimit('10.0.0.5, 198.51.100.1')
    const res = await callRoute({ 'x-forwarded-for': '10.0.0.5, 203.0.113.9' })
    expect(res.status).toBe(429)
  })
})
