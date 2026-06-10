import { describe, expect, it } from 'vitest'

import { buildCsv, csvCellValue } from '@/server/page-export/csv-stringify'

const SELECT_PROP = {
  id: 'p1',
  name: 'Статус',
  type: 'SELECT',
  settings: { options: [{ id: 'opt-1', label: 'Открыто', color: null }] },
}
const CHECK_PROP = { id: 'p2', name: 'Готово', type: 'CHECKBOX', settings: null }

describe('csvCellValue', () => {
  it('maps select option ids to labels and multi-select arrays to label lists', () => {
    expect(csvCellValue(SELECT_PROP, 'opt-1')).toBe('Открыто')
    expect(csvCellValue({ ...SELECT_PROP, type: 'MULTI_SELECT' }, ['opt-1', 'opt-1'])).toBe(
      'Открыто, Открыто',
    )
  })
  it('renders checkboxes as Да/Нет and computed errors as empty', () => {
    expect(csvCellValue(CHECK_PROP, true)).toBe('Да')
    expect(csvCellValue(CHECK_PROP, false)).toBe('Нет')
    expect(csvCellValue(CHECK_PROP, { __error: 'x' })).toBe('')
  })
  it('renders relation chips by title and unknown ids as-is', () => {
    expect(
      csvCellValue({ id: 'p3', name: 'Связь', type: 'RELATION', settings: null }, [
        { rowId: 'r', pageId: 'p', title: 'Цель', icon: null },
      ]),
    ).toBe('Цель')
    expect(csvCellValue(SELECT_PROP, 'no-such-option')).toBe('no-such-option')
  })
})

describe('buildCsv formula-injection guard', () => {
  const TEXT_PROP = { id: 't1', name: 'Поле', type: 'TEXT', settings: null }

  it('prefixes =, +, @ and non-numeric minus cells with an apostrophe', () => {
    const csv = buildCsv(
      [TEXT_PROP],
      [
        { title: '=HYPERLINK("x")', cells: { t1: '+cmd' } },
        { title: '@x', cells: { t1: '-3.5' } },
        { title: '-cmd', cells: { t1: '-7' } },
      ],
    )
    const lines = csv.slice(1).split('\r\n')
    expect(lines[1]).toBe('"\'=HYPERLINK(""x"")",\'+cmd')
    expect(lines[2]).toBe("'@x,-3.5")
    expect(lines[3]).toBe("'-cmd,-7")
  })
})

describe('buildCsv', () => {
  it('escapes per RFC-4180, prefixes BOM, and emits the title column first', () => {
    const csv = buildCsv(
      [SELECT_PROP],
      [
        { title: 'A,B', cells: { p1: 'opt-1' } },
        { title: 'C"D', cells: {} },
      ],
    )
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('Название,Статус')
    expect(lines[1]).toBe('"A,B",Открыто')
    expect(lines[2]).toBe('"C""D",')
    // Trailing CRLF leaves one final empty element after the split.
    expect(lines[3]).toBe('')
    expect(lines).toHaveLength(4)
  })
})
