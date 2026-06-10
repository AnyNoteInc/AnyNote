import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'

import { buildNotionImportPlan } from '../../src/server/page-import/notion/notion-plan'

const ID1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const ID2 = 'b2c3d4e5f60718293a4b5c6d7e8f90a1'
const ID3 = 'c3d4e5f60718293a4b5c6d7e8f90a1b2'

describe('buildNotionImportPlan', () => {
  it('cleans id suffixes from titles/paths and registers aliases (raw path + hex id)', () => {
    const plan = buildNotionImportPlan(
      zipSync({
        [`Проект ${ID1}.md`]: strToU8('# Проект'),
        [`Проект ${ID1}/Стр ${ID2}.md`]: strToU8('тело'),
      }),
    )
    expect(plan.roots).toHaveLength(1)
    expect(plan.roots[0]!.name).toBe('Проект')
    expect(plan.roots[0]!.children[0]!.name).toBe('Стр')
    // Aliases point at the CLEANED sourceKeys.
    const childKey = plan.roots[0]!.children[0]!.sourceKey
    expect(plan.aliases.get(ID2)).toBe(childKey)
    expect(plan.aliases.get(`Проект ${ID1}/Стр ${ID2}.md`)).toBe(childKey)
  })

  it('detects a database CSV with row docs: blueprint extracted, row docs leave the page tree', () => {
    const csv = 'Name,Status,Count\nЗадача А,Open,1\nЗадача Б,Done,2\nЗадача В,Open,3\n'
    const plan = buildNotionImportPlan(
      zipSync({
        [`База ${ID1}.csv`]: strToU8(csv),
        [`База ${ID1}/Задача А ${ID2}.md`]: strToU8('# Задача А\n\nтело А'),
        [`База ${ID1}/Задача Б ${ID3}.md`]: strToU8('# Задача Б'),
      }),
    )
    expect(plan.databases).toHaveLength(1)
    const bp = plan.databases[0]!
    expect(bp.title).toBe('База')
    expect(bp.header).toEqual(['Name', 'Status', 'Count'])
    expect(bp.rows).toHaveLength(3)
    expect(bp.rowDocs.get('Задача А')).toBeDefined()
    expect(bp.rowAliasIds.get('Задача А')).toBe(ID2)
    // Row docs are NOT regular tree nodes; the db page is materialized separately.
    expect(plan.roots).toHaveLength(0)
    expect(plan.totalPages).toBe(1 + 3) // db page + 3 rows
  })

  it('drops the _all.csv duplicate', () => {
    const csv = 'Name\nA\n'
    const plan = buildNotionImportPlan(
      zipSync({
        [`База ${ID1}.csv`]: strToU8(csv),
        [`База ${ID1}_all.csv`]: strToU8(csv),
      }),
    )
    expect(plan.databases).toHaveLength(1)
  })

  it('dedups cleaned-name collisions deterministically', () => {
    const plan = buildNotionImportPlan(
      zipSync({
        [`Стр ${ID1}.md`]: strToU8('a'),
        [`Стр ${ID2}.md`]: strToU8('b'),
      }),
    )
    const names = plan.roots.map((r) => r.name).sort()
    expect(new Set(plan.roots.map((r) => r.sourceKey)).size).toBe(2)
    expect(names[0]).toBe('Стр')
    expect(names[1]).toMatch(/^Стр 2$/)
  })

  it('warns on unsupported entries like everything else', () => {
    const plan = buildNotionImportPlan(zipSync({ 'x.pdf': strToU8('x') }))
    expect(plan.warnings.length).toBe(1)
  })
})
