import { decryptSecret, type EncryptedPayload } from '@repo/auth'

export function decryptModelConnection(stored: unknown): Record<string, unknown> | null {
  if (stored == null) return null
  const payload = stored as EncryptedPayload
  return JSON.parse(decryptSecret(payload)) as Record<string, unknown>
}

export function decryptMcpHeadersMap(
  servers: Array<{ id: string; headers: unknown }>,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  for (const s of servers) {
    const decrypted = decryptSecret(s.headers as EncryptedPayload)
    out[s.id] = JSON.parse(decrypted) as Record<string, string>
  }
  return out
}
