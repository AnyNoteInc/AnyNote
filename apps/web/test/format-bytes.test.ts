import { describe, it, expect } from 'vitest'

import { formatBytes } from '@/lib/format-bytes'

describe('formatBytes', () => {
  it('formats bytes under 1KB as Б', () => {
    expect(formatBytes(0)).toBe('0 Б')
    expect(formatBytes(1023)).toBe('1023 Б')
  })

  it('formats KB', () => {
    expect(formatBytes(1024)).toBe('1.0 КБ')
    expect(formatBytes(2048)).toBe('2.0 КБ')
  })

  it('formats MB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 МБ')
    expect(formatBytes(524_288_000)).toBe('500.0 МБ')
  })

  it('formats GB', () => {
    expect(formatBytes(1024 ** 3)).toBe('1.0 ГБ')
    expect(formatBytes(5_368_709_120)).toBe('5.0 ГБ')
  })

  it('accepts BigInt', () => {
    expect(formatBytes(21_474_836_480n)).toBe('20.0 ГБ')
  })

  it('honors fractionDigits', () => {
    expect(formatBytes(1536, 2)).toBe('1.50 КБ')
  })
})
