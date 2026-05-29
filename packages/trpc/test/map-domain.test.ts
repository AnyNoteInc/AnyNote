import { describe, it, expect } from 'vitest'
import { forbidden } from '@repo/domain'

import { mapDomain } from '../src/helpers/map-domain'

describe('mapDomain', () => {
  it('translates DomainError → TRPCError by httpStatus', async () => {
    await expect(mapDomain(async () => { throw forbidden('nope') })).rejects.toMatchObject({ name: 'TRPCError', code: 'FORBIDDEN' })
  })
  it('passes non-domain errors through', async () => {
    const e = new Error('boom')
    await expect(mapDomain(async () => { throw e })).rejects.toBe(e)
  })
  it('returns the value on success', async () => {
    await expect(mapDomain(async () => 42)).resolves.toBe(42)
  })
})
