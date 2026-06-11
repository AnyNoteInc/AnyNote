import { createHash, randomBytes } from 'node:crypto'

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** Plaintext length of every people-invite token (member, link, guest). */
export const INVITE_TOKEN_LENGTH = 32

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
 * 32 base62 chars — the plaintext that goes into `/invite/{token}`-style links.
 * 24 random bytes (192 bits) → ~190.5 bits; the high-digit slice loses ~2 bits,
 * irrelevant at this keyspace. Local clone of the `@repo/webhooks` generator —
 * domain deps stay limited to `@repo/db` + `zod`.
 */
export function generateInviteToken(): string {
  return toBase62(randomBytes(24), INVITE_TOKEN_LENGTH)
}

/** Tokens are stored hashed at rest — sha256 hex (no salt: high-entropy, single-purpose). */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
