import { describe, expect, it } from 'vitest'
import { formatPartialDate } from './format-date'

describe('formatPartialDate', () => {
  it('returns full date with genitive month when day+month+year present', () => {
    expect(formatPartialDate({ day: 15, month: 4, year: 2026 })).toBe('15 апреля 2026')
  })

  it('returns nominative month + year when no day', () => {
    expect(formatPartialDate({ month: 4, year: 2026 })).toBe('апрель 2026')
  })

  it('returns just year when only year', () => {
    expect(formatPartialDate({ year: 2026 })).toBe('2026')
  })

  it('returns day + genitive month when no year', () => {
    expect(formatPartialDate({ day: 15, month: 4 })).toBe('15 апреля')
  })

  it('returns empty string when only day', () => {
    expect(formatPartialDate({ day: 15 })).toBe('')
  })

  it('returns empty string when only month', () => {
    expect(formatPartialDate({ month: 4 })).toBe('')
  })

  it('returns empty string when empty', () => {
    expect(formatPartialDate({})).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(formatPartialDate(undefined)).toBe('')
  })
})
