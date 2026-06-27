import { beforeAll, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { encryptSecret } from '../src/secret-encryption'
import { resolveProviderConnection } from '../src/provider-connection'

beforeAll(() => {
  process.env.SECRETS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64')
})

describe('resolveProviderConnection', () => {
  it('returns the plaintext connection when connectionEnc is absent', () => {
    const out = resolveProviderConnection({
      workspaceId: null,
      connection: { baseUrl: 'http://ollama:11434' },
      connectionEnc: null,
    })
    expect(out).toEqual({ baseUrl: 'http://ollama:11434' })
  })

  it('prefers and decrypts connectionEnc over plaintext connection', () => {
    const connectionEnc = encryptSecret(JSON.stringify({ apiKey: 'sk-secret' }))
    const out = resolveProviderConnection({
      workspaceId: 'w1',
      connection: { apiKey: 'stale-plaintext' },
      connectionEnc,
    })
    expect(out).toEqual({ apiKey: 'sk-secret' })
  })

  it('returns {} when both connection and connectionEnc are empty', () => {
    const out = resolveProviderConnection({
      workspaceId: 'w1',
      connection: {},
      connectionEnc: null,
    })
    expect(out).toEqual({})
  })

  it('drops non-string values from the plaintext connection', () => {
    const out = resolveProviderConnection({
      workspaceId: null,
      connection: { baseUrl: 'http://ollama:11434', port: 11434, enabled: true },
      connectionEnc: null,
    })
    expect(out).toEqual({ baseUrl: 'http://ollama:11434' })
  })

  it('throws when connectionEnc is a garbage/undecryptable payload', () => {
    // Real operational reality: key rotation or a partial write leaves an
    // EncryptedPayload that decryptSecret cannot authenticate. The resolver must
    // surface this rather than silently fall back to the (stale) plaintext.
    expect(() =>
      resolveProviderConnection({
        workspaceId: 'w1',
        connection: { apiKey: 'stale-plaintext' },
        connectionEnc: { iv: 'AAAA', tag: 'AAAA', ciphertext: 'AAAA' },
      }),
    ).toThrow(/decrypt/)
    try {
      resolveProviderConnection({
        workspaceId: 'w1',
        connection: {},
        connectionEnc: { iv: 'AAAA', tag: 'AAAA', ciphertext: 'AAAA' },
      })
      expect.unreachable('expected resolveProviderConnection to throw')
    } catch (e) {
      expect((e as Error).cause).toBeDefined()
    }
  })
})
