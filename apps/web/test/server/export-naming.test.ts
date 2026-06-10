import { describe, expect, it } from 'vitest'

import {
  createNameAllocator,
  relativePath,
  safeEntryName,
} from '../../src/server/page-export/bulk/naming'

describe('safeEntryName', () => {
  it('strips filesystem-unsafe characters and trims', () => {
    expect(safeEntryName('  A/B:C*?"<>| ')).toBe('A B C')
  })
  it('falls back for empty titles', () => {
    expect(safeEntryName(null)).toBe('Без названия')
    expect(safeEntryName('///')).toBe('page')
  })
})

describe('createNameAllocator', () => {
  it('dedupes per directory with numeric suffixes, case-insensitively', () => {
    const alloc = createNameAllocator()
    expect(alloc('', 'Page')).toBe('Page')
    expect(alloc('', 'page')).toBe('page 2')
    expect(alloc('dir', 'Page')).toBe('Page')
  })
})

describe('relativePath', () => {
  it('resolves between archive paths', () => {
    expect(relativePath('', 'assets/a.png')).toBe('assets/a.png')
    expect(relativePath('Proj', 'assets/a.png')).toBe('../assets/a.png')
    expect(relativePath('Proj', 'Proj/Sub/x.md')).toBe('Sub/x.md')
    expect(relativePath('A/B', 'C/d.md')).toBe('../../C/d.md')
  })
})
