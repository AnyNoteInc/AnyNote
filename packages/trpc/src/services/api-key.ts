import { createHash, randomBytes } from 'node:crypto'

import { addDays, addYears } from 'date-fns'

export type ApiKeyTtl = '7d' | '30d' | '90d' | '1y' | 'never'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function toBase62(bytes: Buffer, length: number): string {
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  let out = ''
  const base = BigInt(ALPHABET.length)
  while (n > 0n) {
    out = ALPHABET[Number(n % base)]! + out
    n /= base
  }
  if (out.length < length) out = ALPHABET[0]!.repeat(length - out.length) + out
  return out.slice(-length)
}

export function generateApiKey(): {
  fullKey: string
  prefix: string
  lastFour: string
  hash: string
} {
  // 18 bytes (144 bits) → 24 base62 chars (~143 bits). Slicing the high digit
  // loses ~1 bit and slightly biases the leading character; 2^143 keyspace is
  // still vastly more than required given SHA-256 lookup.
  const body = toBase62(randomBytes(18), 24)
  const fullKey = `ank_${body}`
  return {
    fullKey,
    prefix: body.slice(0, 8),
    lastFour: body.slice(-4),
    hash: hashApiKey(fullKey),
  }
}

export function hashApiKey(fullKey: string): string {
  return createHash('sha256').update(fullKey).digest('hex')
}

export function computeExpiresAt(ttl: ApiKeyTtl, now: Date = new Date()): Date | null {
  switch (ttl) {
    case 'never':
      return null
    case '7d':
      return addDays(now, 7)
    case '30d':
      return addDays(now, 30)
    case '90d':
      return addDays(now, 90)
    case '1y':
      return addYears(now, 1)
  }
}
