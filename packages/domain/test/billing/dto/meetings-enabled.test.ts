import { describe, it, expect } from 'vitest'

import { parseMeetingsEnabled } from '../../../src/billing/dto/billing.dto.ts'

describe('parseMeetingsEnabled', () => {
  it('returns true when the features array includes "meetings"', () => {
    expect(parseMeetingsEnabled(['meetings'])).toBe(true)
    expect(parseMeetingsEnabled(['publicSites', 'meetings', 'pageHistory:30'])).toBe(true)
  })

  it('returns false when the features array lacks "meetings"', () => {
    expect(parseMeetingsEnabled([])).toBe(false)
    expect(parseMeetingsEnabled(['publicSites', 'pageHistory:unlimited'])).toBe(false)
  })

  it('returns false for non-array / null / non-string-entry features', () => {
    expect(parseMeetingsEnabled(null)).toBe(false)
    expect(parseMeetingsEnabled(undefined)).toBe(false)
    expect(parseMeetingsEnabled('meetings')).toBe(false)
    expect(parseMeetingsEnabled([{ meetings: true }])).toBe(false)
  })
})
