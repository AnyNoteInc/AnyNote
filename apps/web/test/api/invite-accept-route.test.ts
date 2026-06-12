import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn<() => Promise<unknown>>(),
  getServerTRPC: vi.fn<() => Promise<unknown>>(),
}))

vi.mock('@/lib/get-session', () => ({
  getSession: mocks.getSession,
}))

vi.mock('@/trpc/server', () => ({
  getServerTRPC: mocks.getServerTRPC,
}))

// `@/lib/invite` pulls in `server-only` + the real prisma singleton; the route
// only needs the cookie name and the token shape check.
vi.mock('@/lib/invite', () => ({
  INVITE_RETURN_COOKIE: 'invite_return',
  isWellFormedInviteToken: (token: string) => /^[A-Za-z0-9]{8,64}$/.test(token),
}))

import { POST } from '../../src/app/api/invite/accept/route'

const APP_ORIGIN = 'http://localhost:3000'

function callRoute(headers: Record<string, string>) {
  const req = new Request(`${APP_ORIGIN}/api/invite/accept`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ kind: 'invite', token: 'A'.repeat(32) }),
  }) as unknown as NextRequest
  return POST(req)
}

beforeEach(() => {
  mocks.getSession.mockReset().mockResolvedValue(null)
  mocks.getServerTRPC.mockReset().mockRejectedValue(new Error('must not reach tRPC'))
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', APP_ORIGIN)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/invite/accept — same-origin enforcement (CSRF)', () => {
  it('returns 403 for a cross-origin POST and never touches the session', async () => {
    const res = await callRoute({ origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect(mocks.getSession).not.toHaveBeenCalled()
  })

  it('returns 403 when the Origin header is missing', async () => {
    const res = await callRoute({})
    expect(res.status).toBe(403)
    expect(mocks.getSession).not.toHaveBeenCalled()
  })

  it('rejects a prefix-spoofed origin (app origin as subdomain prefix)', async () => {
    const res = await callRoute({ origin: `${APP_ORIGIN.replace(':3000', '')}.evil.example` })
    expect(res.status).toBe(403)
  })

  it('a matching origin proceeds past the check (401 from the missing session)', async () => {
    const res = await callRoute({ origin: APP_ORIGIN })
    expect(res.status).toBe(401)
    expect(mocks.getSession).toHaveBeenCalledTimes(1)
  })

  it('without NEXT_PUBLIC_BASE_URL it falls back to the Host-derived origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', '')
    const ok = await callRoute({ origin: APP_ORIGIN, host: 'localhost:3000' })
    expect(ok.status).toBe(401)
    const bad = await callRoute({ origin: 'http://localhost:4000', host: 'localhost:3000' })
    expect(bad.status).toBe(403)
  })
})
