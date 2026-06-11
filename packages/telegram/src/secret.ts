import { createHash, randomBytes } from 'node:crypto'

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** Uppercase base32 without the ambiguous 0/O/1/I — 24 letters + digits 2-9. */
const LINK_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function toBase62(bytes: Buffer, length: number): string {
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  let out = ''
  const base = BigInt(BASE62.length)
  while (n > 0n) {
    out = BASE62[Number(n % base)]! + out
    n /= base
  }
  if (out.length < length) out = BASE62[0]!.repeat(length - out.length) + out
  return out.slice(-length)
}

/**
 * 32 base62 chars (no prefix — Telegram's `secret_token` is sent back verbatim
 * in `X-Telegram-Bot-Api-Secret-Token`, a recognizable prefix adds nothing).
 * 24 random bytes (192 bits) → ~190.5 bits, ample at this keyspace.
 */
export function generateTelegramWebhookSecret(): string {
  return toBase62(randomBytes(24), 32)
}

/**
 * 8-char human-typed one-time link code (~40 bits — fine for a 15-minute TTL,
 * single-use). The 32-char alphabet divides 256 evenly, so `byte & 31` is
 * unbiased.
 */
export function generateLinkCode(): string {
  const bytes = randomBytes(8)
  let out = ''
  for (const b of bytes) out += LINK_CODE_ALPHABET[b & 31]!
  return out
}

/** Codes are stored hashed at rest — sha256 hex (no salt: 15-min TTL, single use). */
export function hashLinkCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}
