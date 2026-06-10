import { signWebhookPayload } from './signature.ts'
import { assertSafeWebhookUrl, SsrfBlockedError, type LookupFn } from './ssrf.ts'

export type ChallengeResult = { ok: boolean; error?: string }

const DEFAULT_TIMEOUT_MS = 10_000
/** The echo must appear within the first 4KB of the response body (spec §6). */
const ECHO_SCAN_CHARS = 4096

/**
 * Endpoint-verification challenge: POSTs `{type:'verification', challenge,
 * subscriptionId}` signed exactly like a regular delivery (same header set,
 * `X-AnyNote-Event: verification`, the subscription id in `X-AnyNote-Delivery`
 * since no delivery row exists). Succeeds iff the endpoint answers 2xx AND
 * echoes the challenge string within the first 4096 chars of the body.
 */
export async function sendVerificationChallenge(args: {
  url: string
  secret: string
  challenge: string
  subscriptionId: string
  timeoutMs?: number
  fetchFn?: typeof fetch
  lookup?: LookupFn
}): Promise<ChallengeResult> {
  try {
    await assertSafeWebhookUrl(args.url, args.lookup)
  } catch (err) {
    const reason =
      err instanceof SsrfBlockedError || err instanceof Error ? err.message : String(err)
    return { ok: false, error: reason }
  }

  const body = JSON.stringify({
    type: 'verification',
    challenge: args.challenge,
    subscriptionId: args.subscriptionId,
  })
  const timestampSec = Math.floor(Date.now() / 1000)
  const signature = signWebhookPayload(args.secret, timestampSec, body)
  const fetchFn = args.fetchFn ?? fetch

  let res: Response
  try {
    res = await fetchFn(args.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AnyNote-Signature': signature,
        'X-AnyNote-Timestamp': String(timestampSec),
        'X-AnyNote-Event': 'verification',
        'X-AnyNote-Delivery': args.subscriptionId,
        'X-AnyNote-Payload-Version': '1',
      },
      body,
      // A redirect could point at a private host and evade the SSRF guard —
      // never follow; any 3xx response is treated as a plain failure below.
      redirect: 'manual',
      signal: AbortSignal.timeout(args.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  if (res.status < 200 || res.status >= 300) {
    return { ok: false, error: `http ${res.status}` }
  }

  let text: string
  try {
    text = await res.text()
  } catch {
    return { ok: false, error: 'не удалось прочитать тело ответа' }
  }
  if (!text.slice(0, ECHO_SCAN_CHARS).includes(args.challenge)) {
    return { ok: false, error: 'ответ не содержит строку подтверждения' }
  }
  return { ok: true }
}
