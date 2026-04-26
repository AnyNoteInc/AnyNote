import type { WebhookEvent } from './types.js'
import { YookassaError } from './errors.js'

const KNOWN_EVENTS = new Set([
  'payment.succeeded',
  'payment.canceled',
  'payment.waiting_for_capture',
  'refund.succeeded',
])

export function parseWebhookEvent(body: unknown): WebhookEvent {
  if (!body || typeof body !== 'object') throw new YookassaError('invalid webhook body')
  const obj = body as Record<string, unknown>
  if (!obj.event || !KNOWN_EVENTS.has(String(obj.event))) {
    throw new YookassaError(`unknown event: ${String(obj.event)}`)
  }
  if (!obj.object || typeof obj.object !== 'object') {
    throw new YookassaError('missing object')
  }
  return obj as unknown as WebhookEvent
}

export function verifyTrustedIp(ip: string, allowlistCsv: string | undefined): boolean {
  if (!allowlistCsv) return true
  const cidrs = allowlistCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (cidrs.length === 0) return true
  return cidrs.some((cidr) => ipInCidr(ip, cidr))
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/')
  if (!range) return false
  const bits = bitsStr ? parseInt(bitsStr, 10) : 32
  if (Number.isNaN(bits) || bits < 0 || bits > 32) return false
  const ipInt = ipv4ToInt(ip)
  const rangeInt = ipv4ToInt(range)
  if (ipInt === null || rangeInt === null) return false
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (ipInt & mask) === (rangeInt & mask)
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return null
  }
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0
}
