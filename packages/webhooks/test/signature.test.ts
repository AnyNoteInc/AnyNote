import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { signWebhookPayload, verifyWebhookSignature } from '../src/signature.ts'

const SECRET = 'whsec_test0123456789test0123456789ab'
const TIMESTAMP = 1750000000
const BODY = '{"version":1,"event":"page.created"}'

describe('signWebhookPayload', () => {
  it('returns sha256=<64 hex chars>', () => {
    const signature = signWebhookPayload(SECRET, TIMESTAMP, BODY)
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it('signs the documented base string "{timestamp}.{body}"', () => {
    const expected = createHmac('sha256', SECRET).update(`${TIMESTAMP}.${BODY}`).digest('hex')
    expect(signWebhookPayload(SECRET, TIMESTAMP, BODY)).toBe(`sha256=${expected}`)
  })

  it('is deterministic for the same inputs', () => {
    expect(signWebhookPayload(SECRET, TIMESTAMP, BODY)).toBe(
      signWebhookPayload(SECRET, TIMESTAMP, BODY),
    )
  })
})

describe('verifyWebhookSignature', () => {
  it('round-trips a freshly signed payload', () => {
    const signature = signWebhookPayload(SECRET, TIMESTAMP, BODY)
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, BODY, signature)).toBe(true)
  })

  it('rejects a tampered body', () => {
    const signature = signWebhookPayload(SECRET, TIMESTAMP, BODY)
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, `${BODY} `, signature)).toBe(false)
  })

  it('rejects a tampered timestamp', () => {
    const signature = signWebhookPayload(SECRET, TIMESTAMP, BODY)
    expect(verifyWebhookSignature(SECRET, TIMESTAMP + 1, BODY, signature)).toBe(false)
  })

  it('rejects a signature made with another secret', () => {
    const signature = signWebhookPayload('whsec_other', TIMESTAMP, BODY)
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, BODY, signature)).toBe(false)
  })

  it('rejects a malformed signature of a different length', () => {
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, BODY, 'sha256=dead')).toBe(false)
  })
})
