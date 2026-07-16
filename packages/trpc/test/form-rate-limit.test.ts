import { describe, expect, it } from 'vitest'

import {
  createFormRateLimiter,
  formClientIp,
  type FormRateLimitScope,
} from '../src/helpers/form-rate-limit'

const MINUTE_MS = 60 * 1_000
const SALT = Buffer.alloc(32, 9)

function consumeMany(
  limiter: ReturnType<typeof createFormRateLimiter>,
  scope: FormRateLimitScope,
  key: string,
  count: number,
  now: number,
) {
  return Array.from({ length: count }, () => limiter.consume(scope, key, now))
}

describe('form rate limiter', () => {
  it('allows 10 submissions per IP and form in 10 minutes', () => {
    const limiter = createFormRateLimiter({ salt: SALT })
    const key = '203.0.113.8:anf_form-a'

    expect(consumeMany(limiter, 'submit-ip', key, 10, 0)).toEqual(Array(10).fill(true))
    expect(limiter.consume('submit-ip', key, 9 * MINUTE_MS)).toBe(false)
    expect(limiter.consume('submit-ip', key, 10 * MINUTE_MS)).toBe(true)
  })

  it('allows 30 early replay probes per IP in 10 minutes', () => {
    const limiter = createFormRateLimiter({ salt: SALT })
    const key = '203.0.113.8'

    expect(consumeMany(limiter, 'replay-ip', key, 30, 0)).toEqual(Array(30).fill(true))
    expect(limiter.consume('replay-ip', key, 9 * MINUTE_MS)).toBe(false)
    expect(limiter.consume('replay-ip', key, 10 * MINUTE_MS)).toBe(true)
  })

  it('allows 100 form-wide submissions per minute', () => {
    const limiter = createFormRateLimiter({ salt: SALT })

    expect(consumeMany(limiter, 'submit-form', 'anf_form-a', 100, 0)).toEqual(Array(100).fill(true))
    expect(limiter.consume('submit-form', 'anf_form-a', 59 * 1_000)).toBe(false)
    expect(limiter.consume('submit-form', 'anf_form-a', MINUTE_MS)).toBe(true)
  })

  it('allows 30 upload starts per IP and form in 10 minutes', () => {
    const limiter = createFormRateLimiter({ salt: SALT })
    const key = '203.0.113.8:anf_form-a'

    expect(consumeMany(limiter, 'upload-ip', key, 30, 0)).toEqual(Array(30).fill(true))
    expect(limiter.consume('upload-ip', key, 9 * MINUTE_MS)).toBe(false)
    expect(limiter.consume('upload-ip', key, 10 * MINUTE_MS)).toBe(true)
  })

  it('keeps different IP/form keys and scopes independent', () => {
    const limiter = createFormRateLimiter({ salt: SALT })
    const saturated = '203.0.113.8:anf_form-a'

    consumeMany(limiter, 'submit-ip', saturated, 10, 0)

    expect(limiter.consume('submit-ip', saturated, 0)).toBe(false)
    expect(limiter.consume('submit-ip', '203.0.113.9:anf_form-a', 0)).toBe(true)
    expect(limiter.consume('submit-ip', '203.0.113.8:anf_form-b', 0)).toBe(true)
    expect(limiter.consume('replay-ip', saturated, 0)).toBe(true)
    expect(limiter.consume('upload-ip', saturated, 0)).toBe(true)
  })

  it('prunes expired windows before enforcing the bounded map', () => {
    const limiter = createFormRateLimiter({ salt: SALT, maxKeys: 2 })

    consumeMany(limiter, 'submit-ip', 'old-a', 10, 0)
    consumeMany(limiter, 'submit-ip', 'old-b', 10, 0)
    expect(limiter.consume('submit-ip', 'new-c', 11 * MINUTE_MS)).toBe(true)
    expect(limiter.consume('submit-ip', 'old-a', 11 * MINUTE_MS)).toBe(true)
  })

  it('evicts the oldest key when the bounded map is full', () => {
    const limiter = createFormRateLimiter({ salt: SALT, maxKeys: 2 })

    consumeMany(limiter, 'submit-ip', 'oldest', 10, 0)
    consumeMany(limiter, 'submit-ip', 'newer', 10, 1)
    expect(limiter.consume('submit-ip', 'third', 2)).toBe(true)

    expect(limiter.consume('submit-ip', 'newer', 3)).toBe(false)
    expect(limiter.consume('submit-ip', 'oldest', 3)).toBe(true)
  })
})

describe('formClientIp', () => {
  it('uses the first forwarded address', () => {
    expect(formClientIp(new Headers({ 'x-forwarded-for': ' 203.0.113.4, 10.0.0.1 ' }))).toBe(
      '203.0.113.4',
    )
  })

  it('falls back to x-real-ip and then unknown', () => {
    expect(formClientIp(new Headers({ 'x-real-ip': ' 203.0.113.5 ' }))).toBe('203.0.113.5')
    expect(formClientIp(new Headers())).toBe('unknown')
  })
})
