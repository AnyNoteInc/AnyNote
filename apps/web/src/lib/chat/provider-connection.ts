import { decryptSecret, type EncryptedPayload } from '@repo/auth'

export function resolveProviderConnection(provider: {
  workspaceId: string | null
  connection: unknown
  connectionEnc: unknown
}): Record<string, string> {
  const raw =
    provider.workspaceId && provider.connectionEnc
      ? (JSON.parse(decryptSecret(provider.connectionEnc as EncryptedPayload)) as unknown)
      : provider.connection
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}
