import { decryptSecret, type EncryptedPayload } from './secret-encryption.ts'

/**
 * Single source of truth for resolving an AI provider's connection credentials.
 *
 * Shared by `apps/web` (chat, via `src/lib/chat/provider-connection.ts`) and
 * `apps/engines` (the vectorization indexer cron). Both must agree: real creds
 * live in the encrypted `connectionEnc` column, while the plaintext `connection`
 * column is the legacy/fallback location.
 *
 * Prefer encrypted credentials when present, regardless of whether the provider
 * is workspace-scoped or shared (workspaceId null). Global providers (e.g. seeded
 * DeepSeek) also store their creds in connectionEnc, so the two fields must not be
 * mutually exclusive. Fall back to the plaintext connection only when
 * connectionEnc is absent.
 */
export function resolveProviderConnection(provider: {
  workspaceId: string | null
  connection: unknown
  connectionEnc: unknown
}): Record<string, string> {
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
