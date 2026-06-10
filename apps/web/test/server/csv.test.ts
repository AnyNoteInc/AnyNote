import { describe, expect, it } from 'vitest'

import { parseCsv } from '../../src/server/page-import/csv'

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b\n1,2\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })
  it('handles quoted fields with commas, escaped quotes and newlines', () => {
    expect(parseCsv('a,"b,c"\n"x ""y""","line1\nline2"')).toEqual([
      ['a', 'b,c'],
      ['x "y"', 'line1\nline2'],
    ])
  })
  it('tolerates BOM and CRLF and trailing newline', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
  it('returns [] for empty input', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('\n')).toEqual([])
  })
  it('throws when a row has too many columns', () => {
    const row = Array.from({ length: 501 }, (_, i) => `c${i}`).join(',')
    expect(() => parseCsv(row)).toThrowError('CSV содержит слишком много колонок')
  })
  it('throws when a field is too large', () => {
    const field = 'a'.repeat(100_001)
    expect(() => parseCsv(`x,${field}`)).toThrowError('Поле CSV слишком большое')
  })
})
