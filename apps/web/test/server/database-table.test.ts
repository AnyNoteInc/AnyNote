import { describe, expect, it } from 'vitest'

import {
  buildDatabaseTableHtml,
  buildDatabaseTableMarkdown,
  stringifyCellValue,
} from '@/server/page-export/bulk/database-table'

describe('stringifyCellValue', () => {
  it('handles primitives, arrays and labelled objects', () => {
    expect(stringifyCellValue(null)).toBe('')
    expect(stringifyCellValue(42)).toBe('42')
    expect(stringifyCellValue(['a', 'b'])).toBe('a, b')
    expect(stringifyCellValue({ label: 'Готово' })).toBe('Готово')
    expect(stringifyCellValue({ name: 'Иван' })).toBe('Иван')
  })
})

describe('buildDatabaseTableMarkdown', () => {
  it('renders a header + rows and escapes pipes', () => {
    const md = buildDatabaseTableMarkdown(
      [{ id: 'p1', name: 'Статус' }],
      [{ title: 'A|B', cells: { p1: 'X' } }],
    )
    expect(md).toContain('| Название | Статус |')
    expect(md).toContain('| A\\|B | X |')
  })
})

describe('buildDatabaseTableHtml', () => {
  it('escapes html in values', () => {
    const html = buildDatabaseTableHtml(
      [{ id: 'p1', name: '<b>' }],
      [{ title: '<i>', cells: { p1: '<u>' } }],
    )
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;b&gt;')
  })
})
