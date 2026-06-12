import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { domain } from '@/lib/domain'

export const runtime = 'nodejs'

/**
 * Lightweight sliding-window rate limit, in-memory per-instance BY DESIGN
 * («rate-limited by simplicity» per the spec): a module-level map of recent
 * request timestamps per IP, pruned on access. Multi-instance deployments
 * multiply the cap by instance count — acceptable for a boolean endpoint.
 */
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000

const requestLog = new Map<string, number[]>()

function clientIpOf(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  const firstHop = forwarded?.split(',')[0]?.trim()
  return firstHop || req.headers.get('x-real-ip') || 'unknown'
}

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const cutoff = now - RATE_LIMIT_WINDOW_MS
  const recent = (requestLog.get(ip) ?? []).filter((ts) => ts > cutoff)
  if (recent.length >= RATE_LIMIT_MAX) {
    requestLog.set(ip, recent)
    return true
  }
  recent.push(now)
  requestLog.set(ip, recent)
  return false
}

/**
 * Abuse hardening (the `/api/invite/accept` precedent): this endpoint is a
 * domain-probing oracle by design, so at minimum require the browser's
 * `Origin` to match the app's own origin — cross-site pages cannot use a
 * visitor's browser to enumerate which email domains have SSO. When
 * `NEXT_PUBLIC_BASE_URL` is unset (tests, ad-hoc envs) fall back to the
 * origin implied by the request's own Host header.
 */
function isSameAppOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  const base = process.env.NEXT_PUBLIC_BASE_URL
  try {
    const expected = base
      ? new URL(base).origin
      : new URL(`${new URL(req.url).protocol}//${req.headers.get('host') ?? ''}`).origin
    return new URL(origin).origin === expected
  } catch {
    return false
  }
}

const UNAVAILABLE = { available: false } as const

const bodySchema = z.object({ email: z.string().email().max(320) })

/**
 * Public (pre-session) SSO availability resolve for the sign-in page.
 * Body: `{email}`. Response is ONLY `{available, providerId?}` — the
 * providerId is the opaque better-auth `ssoProviderId` the client passes to
 * `signIn.sso`; never any workspace information. Every miss — malformed
 * input, unknown/unverified domain, disabled provider — returns the SAME
 * `{available: false}` (spec §7 invariant 5: no workspace enumeration by
 * probing domains). Cost per request: one indexed query.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (isRateLimited(clientIpOf(req))) {
    return NextResponse.json({ error: 'Слишком много запросов' }, { status: 429 })
  }

  if (!isSameAppOrigin(req)) {
    return NextResponse.json({ error: 'Недопустимый источник запроса' }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(UNAVAILABLE)
  }

  const resolved = await domain.identity
    .resolveSsoProviderForEmail(parsed.data.email)
    .catch(() => null)
  if (!resolved) {
    return NextResponse.json(UNAVAILABLE)
  }
  return NextResponse.json({ available: true, providerId: resolved.ssoProviderId })
}
