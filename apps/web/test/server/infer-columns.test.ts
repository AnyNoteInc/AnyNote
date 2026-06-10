import { describe, expect, it } from 'vitest'

import { inferColumns } from '../../src/server/page-import/infer-columns'

const infer = (name: string, values: string[]) => inferColumns([name], values.map((v) => [v]))[0]!

describe('inferColumns', () => {
  it('infers NUMBER (incl. comma decimals) with numeric toValue', () => {
    const c = infer('Кол-во', ['1', '2,5', '-3'])
    expect(c.type).toBe('NUMBER')
    expect(c.toValue('2,5')).toBe(2.5)
  })
  it('infers CHECKBOX from yes/no variants', () => {
    const c = infer('Готово', ['Yes', 'No', 'Да', ''])
    expect(c.type).toBe('CHECKBOX')
    expect(c.toValue('Да')).toBe(true)
    expect(c.toValue('No')).toBe(false)
  })
  it('infers DATE and emits ISO strings', () => {
    const c = infer('Срок', ['May 1, 2024', '2024-06-02'])
    expect(c.type).toBe('DATE')
    expect(c.toValue('2024-06-02')).toMatch(/^2024-06-02T/)
  })
  it('infers URL/EMAIL/PHONE by pattern', () => {
    expect(infer('Сайт', ['https://a.com', 'http://b.io']).type).toBe('URL')
    expect(infer('Почта', ['a@b.co', 'x@y.io']).type).toBe('EMAIL')
    expect(infer('Тел', ['+7 999 123-45-67']).type).toBe('PHONE')
  })
  it('infers SELECT with options and maps labels to option ids', () => {
    const c = infer('Статус', ['Open', 'Done', 'Open', 'Done', 'Open'])
    expect(c.type).toBe('SELECT')
    expect(c.options!.map((o) => o.label).sort()).toEqual(['Done', 'Open'])
    const id = c.options!.find((o) => o.label === 'Open')!.id
    expect(c.toValue('Open')).toBe(id)
  })
  it('infers MULTI_SELECT when values contain comma-separated parts', () => {
    const c = infer('Теги', ['a, b', 'b', 'a, c', 'c', 'b'])
    expect(c.type).toBe('MULTI_SELECT')
    expect(c.options!.map((o) => o.label).sort()).toEqual(['a', 'b', 'c'])
    const ids = c.toValue('a, c') as string[]
    expect(ids).toHaveLength(2)
  })
  it('falls back to TEXT for free text or all-distinct values', () => {
    const c = infer('Описание', ['Первый длинный текст', 'второй', 'третий', 'четвёртый'])
    expect(c.type).toBe('TEXT')
    expect(c.toValue(' x ')).toBe('x')
  })
  it('empty toValue returns null', () => {
    expect(infer('X', ['1']).toValue('')).toBeNull()
  })
})
