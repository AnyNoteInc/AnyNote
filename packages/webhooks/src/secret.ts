import { randomBytes } from 'node:crypto'

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

/**
 * `whsec_` + 32 base62 chars. 24 random bytes (192 bits) → 32 base62 chars
 * (~190.5 bits); the high-digit slice loses ~2 bits, which is irrelevant at
 * this keyspace.
 */
export function generateWebhookSecret(): string {
  return `whsec_${toBase62(randomBytes(24), 32)}`
}

/** 32 base62 chars — the one-time endpoint-verification challenge. */
export function generateChallenge(): string {
  return toBase62(randomBytes(24), 32)
}
