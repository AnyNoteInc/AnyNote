import { describe, expect, it } from 'vitest'
import { encryptSecret } from '@repo/auth'

process.env.SECRETS_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64')

import { resolveProviderConnection } from '../src/lib/chat/provider-connection'

describe('resolveProviderConnection', () => {
  it('returns plaintext connection for shared providers (workspaceId null)', () => {
    const c = resolveProviderConnection({ workspaceId: null, connection: { baseUrl: 'http://o:1' }, connectionEnc: null })
    expect(c).toEqual({ baseUrl: 'http://o:1' })
  })

  it('decrypts connectionEnc for workspace providers', () => {
    const enc = encryptSecret(JSON.stringify({ apiKey: 'sk-secret' }))
    const c = resolveProviderConnection({ workspaceId: 'ws', connection: {}, connectionEnc: enc })
    expect(c).toEqual({ apiKey: 'sk-secret' })
  })

  it('drops non-string values', () => {
    const c = resolveProviderConnection({ workspaceId: null, connection: { baseUrl: 'u', n: 5 }, connectionEnc: null })
    expect(c).toEqual({ baseUrl: 'u' })
  })

  it('throws a contextful error on a corrupt connectionEnc', () => {
    expect(() =>
      resolveProviderConnection({ workspaceId: 'ws', connection: {}, connectionEnc: { iv: 'bad', ciphertext: 'bad', tag: 'bad' } }),
    ).toThrow(/decrypt provider/i)
  })
})
