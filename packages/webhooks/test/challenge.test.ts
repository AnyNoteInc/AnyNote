import { randomUUID } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { sendVerificationChallenge } from '../src/challenge.ts'
import { verifyWebhookSignature } from '../src/signature.ts'

import type { LookupFn } from '../src/ssrf.ts'

// Pure unit test — HTTP and DNS edges are injected fakes, no network.

const PUBLIC_LOOKUP: LookupFn = async () => [{ address: '93.184.216.34', family: 4 }]
const PRIVATE_LOOKUP: LookupFn = async () => [{ address: '10.0.0.5', family: 4 }]

const HOOK_URL = 'https://hooks.example.com/anynote'
const SECRET = 'whsec_challengeTestSecret12345678'
const CHALLENGE = 'chal0123456789abcdefghijklmnopqr'

function makeArgs(fetchFn: unknown, overrides: Record<string, unknown> = {}) {
  return {
    url: HOOK_URL,
    secret: SECRET,
    challenge: CHALLENGE,
    subscriptionId: randomUUID(),
    fetchFn: fetchFn as typeof fetch,
    lookup: PUBLIC_LOOKUP,
    ...overrides,
  }
}

function fetchCall(fetchFn: ReturnType<typeof vi.fn>): [string, RequestInit] {
  const call = fetchFn.mock.calls[0]!
  return [String(call[0]), (call[1] ?? {}) as RequestInit]
}

describe('sendVerificationChallenge', () => {
  it('returns ok when the endpoint echoes the challenge — signed exactly like a delivery', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ challenge: CHALLENGE }), { status: 200 }),
    )
    const args = makeArgs(fetchFn)
    const result = await sendVerificationChallenge(args)
    expect(result).toEqual({ ok: true })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchCall(fetchFn)
    expect(url).toBe(HOOK_URL)
    expect(init.method).toBe('POST')
    // A redirect could point at a private host and evade the SSRF guard.
    expect(init.redirect).toBe('manual')

    const body = String(init.body)
    expect(JSON.parse(body)).toEqual({
      type: 'verification',
      challenge: CHALLENGE,
      subscriptionId: args.subscriptionId,
    })

    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['X-AnyNote-Event']).toBe('verification')
    expect(headers['X-AnyNote-Delivery']).toBe(args.subscriptionId)
    expect(headers['X-AnyNote-Payload-Version']).toBe('1')
    const timestamp = Number(headers['X-AnyNote-Timestamp'])
    expect(Number.isInteger(timestamp)).toBe(true)
    expect(verifyWebhookSignature(SECRET, timestamp, body, headers['X-AnyNote-Signature']!)).toBe(
      true,
    )
  })

  it('fails when the 2xx response does not echo the challenge (first 4096 chars only)', async () => {
    const noEcho = vi.fn(async () => new Response('ok, registered', { status: 200 }))
    const missing = await sendVerificationChallenge(makeArgs(noEcho))
    expect(missing.ok).toBe(false)
    expect(missing.error).toBeTruthy()

    // The echo only counts inside the first 4096 chars of the body.
    const lateEcho = vi.fn(async () => new Response('x'.repeat(5000) + CHALLENGE, { status: 200 }))
    const late = await sendVerificationChallenge(makeArgs(lateEcho))
    expect(late.ok).toBe(false)
  })

  it('fails on a non-2xx response even when the body echoes the challenge', async () => {
    const serverError = vi.fn(async () => new Response(CHALLENGE, { status: 500 }))
    const failed = await sendVerificationChallenge(makeArgs(serverError))
    expect(failed).toEqual({ ok: false, error: 'http 500' })

    // redirect: 'manual' surfaces 3xx as a plain response — treated as failure.
    const redirect = vi.fn(async () => new Response(CHALLENGE, { status: 302 }))
    const redirected = await sendVerificationChallenge(makeArgs(redirect))
    expect(redirected).toEqual({ ok: false, error: 'http 302' })
  })

  it('refuses a host resolving to a private range without calling fetch', async () => {
    const fetchFn = vi.fn()
    const result = await sendVerificationChallenge(makeArgs(fetchFn, { lookup: PRIVATE_LOOKUP }))
    expect(result.ok).toBe(false)
    expect(result.error).toContain('запрещён')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
