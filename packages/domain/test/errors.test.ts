import { describe, it, expect } from 'vitest'

import { DomainError, forbidden, isDomainError, notFound } from '../src/errors.ts'

describe('DomainError', () => {
  it('carries code + httpStatus and is detectable', () => {
    const e = forbidden('nope')
    expect(e).toBeInstanceOf(DomainError)
    expect(e.code).toBe('FORBIDDEN')
    expect(e.httpStatus).toBe(403)
    expect(isDomainError(e)).toBe(true)
    expect(isDomainError(new Error('x'))).toBe(false)
    expect(notFound('m').httpStatus).toBe(404)
  })
})
