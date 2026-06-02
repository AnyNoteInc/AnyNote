import { decryptSecret, type EncryptedPayload } from '@repo/auth'

export function resolveProviderConnection(provider: {
  workspaceId: string | null
  connection: unknown
  connectionEnc: unknown
}): Record<string, string> {
  // Prefer encrypted credentials when present, regardless of whether the
  // provider is workspace-scoped or shared (workspaceId null). Global providers
  // (e.g. seeded DeepSeek) also store their creds in connectionEnc, so the two
  // fields must not be mutually exclusive. Fall back to the plaintext
  // connection only when connectionEnc is absent.
  let raw: unknown
  if (provider.connectionEnc) {
    try {
      raw = JSON.parse(decryptSecret(provider.connectionEnc as EncryptedPayload))
    } catch (e) {
      throw new Error('Failed to decrypt provider credentials', { cause: e })
    }
  } else {
    raw = provider.connection
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}
