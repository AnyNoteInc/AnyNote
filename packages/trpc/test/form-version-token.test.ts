import { createHmac, createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  assertFormVersionContext,
  signFormVersionToken,
  verifyFormVersionToken,
  type FormVersionTokenPayload,
} from '../src/helpers/form-version-token'

const HOUR_MS = 60 * 60 * 1_000
const NOW = Date.UTC(2026, 6, 16, 8)
const SECRET = 'task-9-test-form-token-secret-32-bytes'
const FORM_ID = 'form_internal_123'

const payload: FormVersionTokenPayload = {
  locatorHash: createHash('sha256').update('anf_public-key').digest('hex'),
  versionNumber: 7,
  schemaHash: createHash('sha256').update('published-schema').digest('hex'),
  linkRevision: 3,
  issuedAt: NOW,
  expiresAt: NOW + 24 * HOUR_MS,
}

describe('form version tokens', () => {
  it('round-trips the exact payload without exposing a database form ID', () => {
    const token = signFormVersionToken(payload, SECRET)
    const [body, signature] = token.split('.') as [string, string]

    expect(verifyFormVersionToken(token, SECRET, NOW)).toEqual(payload)
    expect(body).toBe(Buffer.from(JSON.stringify(payload)).toString('base64url'))
    expect(signature).toBe(
      createHmac('sha256', SECRET).update(`form-v1.${body}`).digest('base64url'),
    )
    expect(Buffer.from(body, 'base64url').toString()).not.toContain(FORM_ID)
  })

  it('rejects a tampered token', () => {
    const token = signFormVersionToken(payload, SECRET)

    expect(() => verifyFormVersionToken(`${token}x`, SECRET, NOW)).toThrow('FORM_TOKEN_INVALID')
  })

  it('rejects a token after its expiry', () => {
    const token = signFormVersionToken(payload, SECRET)

    expect(() => verifyFormVersionToken(token, SECRET, NOW + 25 * HOUR_MS)).toThrow(
      'FORM_TOKEN_EXPIRED',
    )
  })

  it.each(['body-only', 'one.two.three'])(
    'rejects an envelope with the wrong segment count: %s',
    (token) => {
      expect(() => verifyFormVersionToken(token, SECRET, NOW)).toThrow('FORM_TOKEN_INVALID')
    },
  )

  it('rejects a signature produced with a different algorithm', () => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const signature = createHmac('sha512', SECRET).update(`form-v1.${body}`).digest('base64url')

    expect(() => verifyFormVersionToken(`${body}.${signature}`, SECRET, NOW)).toThrow(
      'FORM_TOKEN_INVALID',
    )
  })

  it('rejects same-length forged signatures through the constant-time comparison path', () => {
    const token = signFormVersionToken(payload, SECRET)
    const [body, signature] = token.split('.') as [string, string]
    const first = signature[0] === 'A' ? 'B' : 'A'
    const forgedSignature = `${first}${signature.slice(1)}`

    expect(forgedSignature).toHaveLength(signature.length)
    expect(() => verifyFormVersionToken(`${body}.${forgedSignature}`, SECRET, NOW)).toThrow(
      'FORM_TOKEN_INVALID',
    )
  })

  it.each([
    ['whitespace', (signature: string) => `${signature.slice(0, 4)} ${signature.slice(5)}`],
    [
      'an invalid character',
      (signature: string) => `${signature.slice(0, 4)}!${signature.slice(5)}`,
    ],
    ['padding', (signature: string) => `${signature}=`],
  ])('rejects a signature containing %s', (_description, mutateSignature) => {
    const token = signFormVersionToken(payload, SECRET)
    const [body, signature] = token.split('.') as [string, string]

    expect(() =>
      verifyFormVersionToken(`${body}.${mutateSignature(signature)}`, SECRET, NOW),
    ).toThrow('FORM_TOKEN_INVALID')
  })

  it('rejects a standard-base64 signature spelling of the same bytes', () => {
    const secret = 'task-9-test-form-token-secret-32-bytes-0'
    const token = signFormVersionToken(payload, secret)
    const [body, signature] = token.split('.') as [string, string]
    const standardBase64Signature = signature.replaceAll('-', '+').replaceAll('_', '/')

    expect(standardBase64Signature).not.toBe(signature)
    expect(Buffer.from(standardBase64Signature, 'base64')).toEqual(
      Buffer.from(signature, 'base64url'),
    )
    expect(() => verifyFormVersionToken(`${body}.${standardBase64Signature}`, secret, NOW)).toThrow(
      'FORM_TOKEN_INVALID',
    )
  })

  it('rejects a non-canonical base64url signature spelling of the same bytes', () => {
    const token = signFormVersionToken(payload, SECRET)
    const [body, signature] = token.split('.') as [string, string]
    const nonCanonicalSignature = `${signature.slice(0, -1)}h`

    expect(Buffer.from(nonCanonicalSignature, 'base64url')).toEqual(
      Buffer.from(signature, 'base64url'),
    )
    expect(() => verifyFormVersionToken(`${body}.${nonCanonicalSignature}`, SECRET, NOW)).toThrow(
      'FORM_TOKEN_INVALID',
    )
  })

  it('rejects short signing and verification secrets', () => {
    expect(() => signFormVersionToken(payload, 'too-short')).toThrow('FORM_TOKEN_SECRET_INVALID')

    const token = signFormVersionToken(payload, SECRET)
    expect(() => verifyFormVersionToken(token, 'too-short', NOW)).toThrow(
      'FORM_TOKEN_SECRET_INVALID',
    )
  })

  it('strictly rejects payloads with unknown fields', () => {
    const body = Buffer.from(JSON.stringify({ ...payload, formId: FORM_ID })).toString('base64url')
    const signature = createHmac('sha256', SECRET).update(`form-v1.${body}`).digest('base64url')

    expect(() => verifyFormVersionToken(`${body}.${signature}`, SECRET, NOW)).toThrow(
      'FORM_TOKEN_INVALID',
    )
  })

  it('strictly rejects payloads whose hashes are not SHA-256 hex digests', () => {
    const body = Buffer.from(JSON.stringify({ ...payload, locatorHash: 'not-a-hash' })).toString(
      'base64url',
    )
    const signature = createHmac('sha256', SECRET).update(`form-v1.${body}`).digest('base64url')

    expect(() => verifyFormVersionToken(`${body}.${signature}`, SECRET, NOW)).toThrow(
      'FORM_TOKEN_INVALID',
    )
  })

  it.each([
    ['locatorHash', createHash('sha256').update('different-locator').digest('hex')],
    ['versionNumber', payload.versionNumber + 1],
    ['schemaHash', createHash('sha256').update('different-schema').digest('hex')],
    ['linkRevision', payload.linkRevision + 1],
  ] as const)('binds the token to stored %s', (field, value) => {
    expect(() =>
      assertFormVersionContext(
        payload,
        {
          locatorHash: payload.locatorHash,
          versionNumber: payload.versionNumber,
          schemaHash: payload.schemaHash,
          linkRevision: payload.linkRevision,
          [field]: value,
          isCurrent: true,
          acceptUntil: null,
        },
        NOW,
      ),
    ).toThrow('FORM_TOKEN_CONTEXT_MISMATCH')
  })

  it('accepts current and unexpired grace versions but rejects expired grace versions', () => {
    const baseContext = {
      locatorHash: payload.locatorHash,
      versionNumber: payload.versionNumber,
      schemaHash: payload.schemaHash,
      linkRevision: payload.linkRevision,
    }

    expect(() =>
      assertFormVersionContext(
        payload,
        { ...baseContext, isCurrent: true, acceptUntil: null },
        NOW,
      ),
    ).not.toThrow()
    expect(() =>
      assertFormVersionContext(
        payload,
        { ...baseContext, isCurrent: false, acceptUntil: new Date(NOW + HOUR_MS) },
        NOW,
      ),
    ).not.toThrow()
    expect(() =>
      assertFormVersionContext(
        payload,
        { ...baseContext, isCurrent: false, acceptUntil: new Date(NOW) },
        NOW,
      ),
    ).toThrow('FORM_VERSION_STALE')
  })

  it('rejects a grace version with an invalid acceptance deadline', () => {
    expect(() =>
      assertFormVersionContext(
        payload,
        {
          locatorHash: payload.locatorHash,
          versionNumber: payload.versionNumber,
          schemaHash: payload.schemaHash,
          linkRevision: payload.linkRevision,
          isCurrent: false,
          acceptUntil: new Date(Number.NaN),
        },
        NOW,
      ),
    ).toThrow('FORM_VERSION_STALE')
  })
})
