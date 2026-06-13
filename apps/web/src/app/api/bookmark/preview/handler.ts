import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { assertSafeWebhookUrl, type LookupFn } from '@repo/webhooks'

import { getSession } from '@/lib/get-session'
import { parseMeta, type BookmarkPreviewMeta } from '@/lib/bookmark-preview'

/**
 * Server-side bookmark/link-preview fetch (spec §4, invariant 2). Given a URL,
 * fetches the page and extracts og:title/description/image + favicon for the
 * editor's bookmark card. SECURITY-CRITICAL — it fetches an arbitrary URL on
 * the server, so every SSRF lever is closed:
 *
 *  - session-gated FIRST (401 — the route is not a public relay), so an
 *    unauth caller can never burn a shared IP's rate-limit budget;
 *  - then a per-IP sliding-window rate limit (the /api/sso/resolve precedent);
 *  - `assertSafeWebhookUrl` (https-only, private/loopback/link-local/CGN/
 *    metadata ranges blocked) BEFORE any fetch;
 *  - `redirect: 'manual'` + AbortSignal.timeout — on a 3xx the Location host is
 *    re-asserted and followed AT MOST ONCE (the sso-port precedent; a redirect
 *    could otherwise point at a private host and evade the guard);
 *  - the body is read through a BOUNDED stream (≤512KB) — never res.text() — so
 *    a hostile server can't make us buffer an unbounded response;
 *  - ANY failure (blocked target, redirect-to-private, timeout, upstream error,
 *    non-2xx) returns `200 {}` — an empty result, never an error that leaks
 *    whether/why the target was reachable (no SSRF oracle). 401 (no session) and
 *    429 (rate limited) are the only non-200s, and neither depends on the target.
 *
 * NOTE: this lives in a sibling module (not `route.ts`) because Next.js only
 * permits a route file to export `runtime` + the HTTP-method handlers — the
 * injectable `handlePreview` / `__testHooks` would be rejected as invalid route
 * exports. `route.ts` imports `POST` from here.
 */

const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000
const FETCH_TIMEOUT_MS = 8_000
const MAX_BODY_BYTES = 512 * 1024
const MAX_REDIRECTS = 1

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

const bodySchema = z.object({ url: z.string().min(1).max(2_048) })

const EMPTY: BookmarkPreviewMeta = {}

/** Reads at most `MAX_BODY_BYTES` of the response body, then cancels the stream. */
async function readBounded(res: Response): Promise<string> {
  const body = res.body
  if (!body) return ''
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let text = ''
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      text += decoder.decode(value, { stream: true })
      if (total >= MAX_BODY_BYTES) break
    }
  } finally {
    // Stop the upstream transfer — we have enough (or hit the cap).
    await reader.cancel().catch(() => {})
  }
  return text
}

export type FetchDeps = {
  fetchFn?: typeof fetch
  lookup?: LookupFn
}

/** SSRF-guard `url`, then fetch with manual redirects. Null on block/transport error. */
async function guardedFetch(
  url: string,
  fetchFn: typeof fetch,
  lookup: LookupFn | undefined,
): Promise<Response | null> {
  try {
    await assertSafeWebhookUrl(url, lookup)
  } catch {
    return null
  }
  try {
    return await fetchFn(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'AnyNote-LinkPreview' },
    })
  } catch {
    return null
  }
}

/** Absolute URL of a 3xx Location resolved against `from`, or null if absent/bad. */
function resolveRedirect(res: Response, from: string): string | null {
  const location = res.headers.get('location')
  if (!location) return null
  try {
    return new URL(location, from).toString()
  } catch {
    return null
  }
}

const isRedirect = (status: number): boolean => status >= 300 && status < 400
const isSuccess = (status: number): boolean => status >= 200 && status < 300

/** A successful response paired with the URL it was actually fetched from. */
type FetchResult = { res: Response; finalUrl: string }

/**
 * Guards `url`, fetches once with manual redirects, re-guards + follows a single
 * 3xx Location, and returns the FINAL successful Response together with the URL
 * it was fetched from (or null on any SSRF/transport/redirect/non-2xx outcome).
 * Never throws.
 *
 * `finalUrl` is the redirect TARGET when a 3xx was followed — relative
 * image/favicon hrefs must resolve against the page that actually served them.
 * We track it explicitly rather than rely on `res.url`: undici populates `res.url`
 * for real fetches, but it is empty on a constructed `Response` (so tests would
 * otherwise silently resolve against the original url).
 */
async function safeFetch(
  url: string,
  fetchFn: typeof fetch,
  lookup: LookupFn | undefined,
): Promise<FetchResult | null> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await guardedFetch(current, fetchFn, lookup)
    if (!res) return null

    if (isSuccess(res.status)) return { res, finalUrl: res.url || current }

    // Either a redirect (maybe follow) or any other non-2xx — drain and decide.
    const next = isRedirect(res.status) && hop < MAX_REDIRECTS ? resolveRedirect(res, current) : null
    await res.body?.cancel().catch(() => {})
    if (!next) return null
    current = next
  }
  return null
}

/**
 * The real handler, with injectable fetch/lookup for tests. `route.ts`'s `POST`
 * delegates here so the exported route handler keeps Next's `(req, context)`
 * signature while tests drive the SSRF/redirect/rate-limit paths deterministically.
 */
export async function handlePreview(req: NextRequest, deps: FetchDeps = {}): Promise<NextResponse> {
  // Auth FIRST, then rate-limit. If the IP budget were spent before the session
  // check, an unauthenticated caller could exhaust a shared IP's allowance (e.g.
  // behind a corporate NAT) and lock out legitimate signed-in users on that IP.
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (isRateLimited(clientIpOf(req))) {
    return NextResponse.json({ error: 'Слишком много запросов' }, { status: 429 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(EMPTY)
  }

  const fetchFn = deps.fetchFn ?? fetch
  const result = await safeFetch(parsed.data.url, fetchFn, deps.lookup)
  if (!result) return NextResponse.json(EMPTY)

  let html: string
  try {
    html = await readBounded(result.res)
  } catch {
    return NextResponse.json(EMPTY)
  }

  // Resolve relative image/favicon hrefs against the URL the page was actually
  // fetched from (the redirect TARGET when a 3xx was followed), not the original
  // request url. `safeFetch` tracks this through the redirect chain.
  const baseUrl = result.finalUrl
  let meta: BookmarkPreviewMeta
  try {
    meta = parseMeta(html, baseUrl)
  } catch {
    meta = EMPTY
  }
  return NextResponse.json(meta, { headers: { 'Cache-Control': 'private, no-store' } })
}

/** Test-only hooks (the route keeps its rate-limit map module-private). */
export const __testHooks = {
  resetRateLimit() {
    requestLog.clear()
  },
}
