import { describe, expect, it } from 'vitest'

import {
  cleanNotionPath,
  extractNotionIdFromHref,
  splitNotionName,
} from '../../src/server/page-import/notion/notion-name'

const ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

describe('splitNotionName', () => {
  it('strips a trailing 32-hex id from a name', () => {
    expect(splitNotionName(`Проект ${ID}`)).toEqual({ title: 'Проект', notionId: ID })
  })
  it('handles extensions kept by the caller (no ext logic here)', () => {
    expect(splitNotionName('Проект')).toEqual({ title: 'Проект', notionId: null })
  })
  it('does not strip non-hex or short suffixes', () => {
    expect(splitNotionName('Отчёт 2024')).toEqual({ title: 'Отчёт 2024', notionId: null })
    expect(splitNotionName(`X ${ID.slice(0, 31)}`)).toEqual({
      title: `X ${ID.slice(0, 31)}`,
      notionId: null,
    })
  })
  it('keeps a fallback title when the name is ONLY an id', () => {
    expect(splitNotionName(ID)).toEqual({ title: 'Без названия', notionId: ID })
  })
})

describe('cleanNotionPath', () => {
  it('cleans every segment and keeps the extension, returning ids in order', () => {
    expect(cleanNotionPath(`Раздел ${ID}/Стр ${ID}.md`)).toEqual({
      cleaned: 'Раздел/Стр.md',
      ids: [ID, ID],
    })
  })
})

describe('extractNotionIdFromHref', () => {
  it('finds the id in encoded relative hrefs', () => {
    expect(extractNotionIdFromHref(`%D0%A1%D1%82%D1%80%20${ID}.md`)).toBe(ID)
  })
  it('finds the id in notion.so URLs', () => {
    expect(extractNotionIdFromHref(`https://www.notion.so/ws/My-Page-${ID}`)).toBe(ID)
    expect(extractNotionIdFromHref(`https://www.notion.so/${ID}`)).toBe(ID)
  })
  it('returns null when no id present', () => {
    expect(extractNotionIdFromHref('plain.md')).toBeNull()
    expect(extractNotionIdFromHref('https://example.com/x')).toBeNull()
  })
})
