import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'

import {
  buildImportPlan,
  ImportSourceError,
  normalizeEntryPath,
} from '../../src/server/page-import/zip-plan'

function zip(files: Record<string, string | Uint8Array>): Uint8Array {
  const data: Record<string, Uint8Array> = {}
  for (const [k, v] of Object.entries(files)) data[k] = typeof v === 'string' ? strToU8(v) : v
  return zipSync(data)
}

describe('buildImportPlan', () => {
  it('maps a flat zip to root-level doc nodes', () => {
    const plan = buildImportPlan(zip({ 'a.md': '# A', 'b.html': '<p>B</p>' }))
    expect(plan.roots.map((r) => r.name).sort()).toEqual(['a', 'b'])
    expect(plan.totalPages).toBe(2)
    expect(plan.roots.find((r) => r.name === 'b')!.doc!.format).toBe('html')
  })

  it('maps folders to parent nodes and nests children', () => {
    const plan = buildImportPlan(zip({ 'Proj/notes.md': 'n', 'Proj/Sub/deep.md': 'd' }))
    expect(plan.roots.length).toBe(1)
    const proj = plan.roots[0]!
    expect(proj.name).toBe('Proj')
    expect(proj.doc).toBeNull()
    expect(proj.children.map((c) => c.name).sort()).toEqual(['Sub', 'notes'])
    expect(plan.totalPages).toBe(4)
  })

  it('merges Foo.md onto sibling folder Foo/ (wiki convention)', () => {
    const plan = buildImportPlan(zip({ 'Foo.md': '# Foo body', 'Foo/child.md': 'c' }))
    expect(plan.roots.length).toBe(1)
    const foo = plan.roots[0]!
    expect(foo.name).toBe('Foo')
    expect(foo.doc).not.toBeNull()
    expect(foo.sourceKey).toBe('Foo.md')
    expect(foo.children.map((c) => c.name)).toEqual(['child'])
    expect(plan.totalPages).toBe(2)
  })

  it('collects image assets and warns on unsupported entries', () => {
    const plan = buildImportPlan(
      zip({ 'a.md': 'x', 'img/p.png': new Uint8Array([1]), 'evil.svg': '<svg/>', 'doc.pdf': 'x' }),
    )
    expect(plan.assets.has('img/p.png')).toBe(true)
    expect(plan.warnings.length).toBe(2) // svg + pdf skipped
    expect(plan.totalPages).toBe(1) // asset-only `img/` does not become a page
  })

  it('ignores macOS junk entries', () => {
    const plan = buildImportPlan(zip({ '__MACOSX/x.md': 'x', '.DS_Store': 'x', 'real.md': 'r' }))
    expect(plan.totalPages).toBe(1)
    expect(plan.warnings.length).toBe(0)
  })

  it('throws ImportSourceError on zip-slip paths', () => {
    expect(() => buildImportPlan(zip({ '../evil.md': 'x' }))).toThrow(ImportSourceError)
  })
})

describe('normalizeEntryPath', () => {
  it('returns null for dot-only paths', () => {
    expect(normalizeEntryPath('.')).toBeNull()
    expect(normalizeEntryPath('././')).toBeNull()
  })
  it('throws on absolute paths', () => {
    expect(() => normalizeEntryPath('/etc/passwd')).toThrow(ImportSourceError)
  })
  it('throws on traversal incl. Windows separators', () => {
    expect(() => normalizeEntryPath('../evil.md')).toThrow(ImportSourceError)
    expect(() => normalizeEntryPath('..\\evil.md')).toThrow(ImportSourceError)
  })
})
