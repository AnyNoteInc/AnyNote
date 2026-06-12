import { randomBytes } from 'node:crypto'

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** Plaintext length of every domain-verification token. */
export const VERIFICATION_TOKEN_LENGTH = 32

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
 * 32 base62 chars — published as `anynote-verification=<token>` in public DNS,
 * so it is NOT secret and is stored plaintext (no hash, unlike invite tokens).
 * Local clone of the people invite-token generator — domain deps stay limited
 * to `@repo/db` + `zod`.
 */
export function generateVerificationToken(): string {
  return toBase62(randomBytes(24), VERIFICATION_TOKEN_LENGTH)
}
