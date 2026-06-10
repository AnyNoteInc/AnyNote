import { createHmac, timingSafeEqual } from 'node:crypto'

/** sha256 HMAC over `{timestamp}.{body}` — the documented signature base. */
export function signWebhookPayload(secret: string, timestampSec: number, body: string): string {
  const mac = createHmac('sha256', secret).update(`${timestampSec}.${body}`).digest('hex')
  return `sha256=${mac}`
}

/** Consumer-side verification helper (documented in 7C; also used in tests). */
export function verifyWebhookSignature(
  secret: string,
  timestampSec: number,
  body: string,
  signature: string,
): boolean {
  const expected = signWebhookPayload(secret, timestampSec, body)
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}
