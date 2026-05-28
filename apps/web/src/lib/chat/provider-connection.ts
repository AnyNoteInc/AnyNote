import { decryptSecret, type EncryptedPayload } from '@repo/auth'

export function resolveProviderConnection(provider: {
  workspaceId: string | null
  connection: unknown
  connectionEnc: unknown
}): Record<string, string> {
  let raw: unknown
  if (provider.workspaceId && provider.connectionEnc) {
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
