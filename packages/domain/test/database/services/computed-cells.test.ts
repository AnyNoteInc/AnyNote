import { describe, it, expect } from 'vitest'

import { DatabasePropertyType } from '@repo/db'

import {
  resolveComputedCells,
  type ComputedCellsInput,
  type RowWithCells,
  type PropertyMeta,
} from '../../../src/database/services/computed-cells.ts'
import type { PropertySettings, RelationChip } from '../../../src/database/dto/database.dto.ts'

// ── Builders ──────────────────────────────────────────────────────────────────

function row(id: string, cells: Record<string, unknown> = {}): RowWithCells {
  return {
    id,
    pageId: `page-${id}`,
    cells: Object.entries(cells).map(([propertyId, value]) => ({ propertyId, value })),
  }
}

function prop(
  id: string,
  type: DatabasePropertyType,
  name: string,
  settings: PropertySettings | null = null,
): PropertyMeta {
  return { id, type, name, settings }
}

// Minimal input with sensible empty defaults; tests override what they need.
function input(over: Partial<ComputedCellsInput>): ComputedCellsInput {
  return {
    rows: [],
    properties: [],
    relationLinksByProp: new Map(),
    chipByRowId: new Map(),
    targetCellsByRow: new Map(),
    targetTitleByRow: new Map(),
    pageMetaByRow: new Map(),
    userNameById: new Map(),
    ...over,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('resolveComputedCells — stored cells passthrough', () => {
  it('returns stored cell values verbatim alongside computed ones', () => {
    const properties = [prop('p-text', DatabasePropertyType.TEXT, 'Имя')]
    const rows = [row('r1', { 'p-text': 'hello' })]
    const out = resolveComputedCells(input({ rows, properties }))
    expect(out.get('r1')).toEqual({ 'p-text': 'hello' })
  })
})

describe('resolveComputedCells — FORMULA', () => {
  it('evaluates a formula over other cells by property NAME', () => {
    const properties = [
      prop('p-name', DatabasePropertyType.TEXT, 'Название'),
      prop('p-f', DatabasePropertyType.FORMULA, 'Привет', {
        formula: 'concat(prop("Название"), " !")',
      }),
    ]
    const rows = [row('r1', { 'p-name': 'мир' })]
    const out = resolveComputedCells(input({ rows, properties }))
    expect(out.get('r1')!['p-f']).toBe('мир !')
  })

  it('evaluates a numeric formula over a NUMBER cell', () => {
    const properties = [
      prop('p-num', DatabasePropertyType.NUMBER, 'Цена'),
      prop('p-f', DatabasePropertyType.FORMULA, 'Удвоено', { formula: 'prop("Цена") * 2' }),
    ]
    const rows = [row('r1', { 'p-num': 21 })]
    const out = resolveComputedCells(input({ rows, properties }))
    expect(out.get('r1')!['p-f']).toBe(42)
  })

  it('a formula referencing another formula uses its computed value', () => {
    const properties = [
      prop('p-num', DatabasePropertyType.NUMBER, 'N'),
      prop('p-a', DatabasePropertyType.FORMULA, 'A', { formula: 'prop("N") + 1' }),
      prop('p-b', DatabasePropertyType.FORMULA, 'B', { formula: 'prop("A") * 10' }),
    ]
    const rows = [row('r1', { 'p-num': 4 })]
    const out = resolveComputedCells(input({ rows, properties }))
    expect(out.get('r1')!['p-a']).toBe(5)
    expect(out.get('r1')!['p-b']).toBe(50)
  })

  it('a circular formula (A→B→A) yields {__error} on the cycle members, no crash', () => {
    const properties = [
      prop('p-a', DatabasePropertyType.FORMULA, 'A', { formula: 'prop("B") + 1' }),
      prop('p-b', DatabasePropertyType.FORMULA, 'B', { formula: 'prop("A") + 1' }),
    ]
    const rows = [row('r1')]
    const out = resolveComputedCells(input({ rows, properties }))
    const a = out.get('r1')!['p-a'] as { __error?: string }
    const b = out.get('r1')!['p-b'] as { __error?: string }
    expect(a.__error).toMatch(/circular/i)
    expect(b.__error).toMatch(/circular/i)
  })

  it('an {__error} dependency propagates to the dependent formula', () => {
    const properties = [
      prop('p-bad', DatabasePropertyType.FORMULA, 'Bad', { formula: 'unknownFn(1)' }),
      prop('p-dep', DatabasePropertyType.FORMULA, 'Dep', { formula: 'prop("Bad") + 1' }),
    ]
    const rows = [row('r1')]
    const out = resolveComputedCells(input({ rows, properties }))
    expect((out.get('r1')!['p-bad'] as { __error?: string }).__error).toBeTruthy()
    expect((out.get('r1')!['p-dep'] as { __error?: string }).__error).toBeTruthy()
  })

  it('a FORMULA with no expression resolves to null', () => {
    const properties = [prop('p-f', DatabasePropertyType.FORMULA, 'F', {})]
    const rows = [row('r1')]
    const out = resolveComputedCells(input({ rows, properties }))
    expect(out.get('r1')!['p-f']).toBeNull()
  })
})

describe('resolveComputedCells — RELATION chips', () => {
  it('resolves a RELATION cell to RelationChip[] via chipByRowId', () => {
    const properties = [prop('p-rel', DatabasePropertyType.RELATION, 'Связь')]
    const rows = [row('r1')]
    const chip: RelationChip = { rowId: 't1', pageId: 'page-t1', title: 'Цель 1', icon: '🔗' }
    const out = resolveComputedCells(
      input({
        rows,
        properties,
        relationLinksByProp: new Map([['p-rel', new Map([['r1', ['t1']]])]]),
        chipByRowId: new Map([['t1', chip]]),
      }),
    )
    expect(out.get('r1')!['p-rel']).toEqual([chip])
  })

  it('a RELATION cell with no links resolves to an empty array', () => {
    const properties = [prop('p-rel', DatabasePropertyType.RELATION, 'Связь')]
    const rows = [row('r1')]
    const out = resolveComputedCells(input({ rows, properties }))
    expect(out.get('r1')!['p-rel']).toEqual([])
  })

  it('drops a chip whose target row is missing (trashed)', () => {
    const properties = [prop('p-rel', DatabasePropertyType.RELATION, 'Связь')]
    const rows = [row('r1')]
    const out = resolveComputedCells(
      input({
        rows,
        properties,
        relationLinksByProp: new Map([['p-rel', new Map([['r1', ['gone']]])]]),
        chipByRowId: new Map(),
      }),
    )
    expect(out.get('r1')!['p-rel']).toEqual([])
  })
})

describe('resolveComputedCells — ROLLUP', () => {
  // A source with a RELATION property p-rel and a ROLLUP over the target's p-amt.
  function rollupSetup(aggregation: PropertySettings['rollup'] extends infer R ? R extends { aggregation: infer A } ? A : never : never) {
    const properties = [
      prop('p-rel', DatabasePropertyType.RELATION, 'Связь'),
      prop('p-roll', DatabasePropertyType.ROLLUP, 'Итог', {
        rollup: { relationPropertyId: 'p-rel', targetPropertyId: 'p-amt', aggregation },
      }),
    ]
    const rows = [row('r1')]
    const relationLinksByProp = new Map([['p-rel', new Map([['r1', ['t1', 't2', 't3']]])]])
    const targetCellsByRow = new Map<string, Map<string, unknown>>([
      ['t1', new Map([['p-amt', 10]])],
      ['t2', new Map([['p-amt', 20]])],
      ['t3', new Map([['p-amt', 30]])],
    ])
    return { properties, rows, relationLinksByProp, targetCellsByRow }
  }

  it('sum aggregates the target values', () => {
    const s = rollupSetup('sum')
    const out = resolveComputedCells(input(s))
    expect(out.get('r1')!['p-roll']).toBe(60)
  })

  it('average aggregates the target values', () => {
    const s = rollupSetup('average')
    const out = resolveComputedCells(input(s))
    expect(out.get('r1')!['p-roll']).toBe(20)
  })

  it('min / max', () => {
    expect(resolveComputedCells(input(rollupSetup('min'))).get('r1')!['p-roll']).toBe(10)
    expect(resolveComputedCells(input(rollupSetup('max'))).get('r1')!['p-roll']).toBe(30)
  })

  it('count_all counts every linked row', () => {
    const s = rollupSetup('count_all')
    const out = resolveComputedCells(input(s))
    expect(out.get('r1')!['p-roll']).toBe(3)
  })

  it('count_values counts non-empty target values', () => {
    const s = rollupSetup('count_values')
    // Make t2 empty.
    s.targetCellsByRow.set('t2', new Map([['p-amt', null]]))
    const out = resolveComputedCells(input(s))
    expect(out.get('r1')!['p-roll']).toBe(2)
  })

  it('count_empty / count_not_empty', () => {
    const s = rollupSetup('count_empty')
    s.targetCellsByRow.set('t2', new Map([['p-amt', null]]))
    expect(resolveComputedCells(input(s)).get('r1')!['p-roll']).toBe(1)
    const s2 = rollupSetup('count_not_empty')
    s2.targetCellsByRow.set('t2', new Map([['p-amt', null]]))
    expect(resolveComputedCells(input(s2)).get('r1')!['p-roll']).toBe(2)
  })

  it('count_unique counts distinct values', () => {
    const s = rollupSetup('count_unique')
    s.targetCellsByRow.set('t3', new Map([['p-amt', 10]])) // dup of t1
    const out = resolveComputedCells(input(s))
    expect(out.get('r1')!['p-roll']).toBe(2) // {10, 20}
  })

  it('range = max - min', () => {
    const s = rollupSetup('range')
    expect(resolveComputedCells(input(s)).get('r1')!['p-roll']).toBe(20)
  })

  it('earliest / latest over dates', () => {
    const properties = [
      prop('p-rel', DatabasePropertyType.RELATION, 'Связь'),
      prop('p-roll', DatabasePropertyType.ROLLUP, 'Дата', {
        rollup: { relationPropertyId: 'p-rel', targetPropertyId: 'p-date', aggregation: 'earliest' },
      }),
    ]
    const rows = [row('r1')]
    const relationLinksByProp = new Map([['p-rel', new Map([['r1', ['t1', 't2']]])]])
    const targetCellsByRow = new Map<string, Map<string, unknown>>([
      ['t1', new Map([['p-date', '2026-06-10T00:00:00.000Z']])],
      ['t2', new Map([['p-date', '2026-06-01T00:00:00.000Z']])],
    ])
    const earliest = resolveComputedCells(
      input({ rows, properties, relationLinksByProp, targetCellsByRow }),
    )
    expect(earliest.get('r1')!['p-roll']).toBe('2026-06-01T00:00:00.000Z')

    properties[1]!.settings!.rollup!.aggregation = 'latest'
    const latest = resolveComputedCells(
      input({ rows, properties, relationLinksByProp, targetCellsByRow }),
    )
    expect(latest.get('r1')!['p-roll']).toBe('2026-06-10T00:00:00.000Z')
  })

  it('show_original returns the list of raw target values', () => {
    const s = rollupSetup('show_original')
    const out = resolveComputedCells(input(s))
    expect(out.get('r1')!['p-roll']).toEqual([10, 20, 30])
  })

  it("targetPropertyId '__title__' rolls up target titles", () => {
    const properties = [
      prop('p-rel', DatabasePropertyType.RELATION, 'Связь'),
      prop('p-roll', DatabasePropertyType.ROLLUP, 'Имена', {
        rollup: { relationPropertyId: 'p-rel', targetPropertyId: '__title__', aggregation: 'count_values' },
      }),
    ]
    const rows = [row('r1')]
    const relationLinksByProp = new Map([['p-rel', new Map([['r1', ['t1', 't2']]])]])
    const targetTitleByRow = new Map([
      ['t1', 'Альфа'],
      ['t2', null],
    ])
    const out = resolveComputedCells(input({ rows, properties, relationLinksByProp, targetTitleByRow }))
    expect(out.get('r1')!['p-roll']).toBe(1)
  })

  it('a rollup with no links resolves to 0 for count and null for sum', () => {
    const count = rollupSetup('count_all')
    count.relationLinksByProp = new Map()
    expect(resolveComputedCells(input(count)).get('r1')!['p-roll']).toBe(0)
    const sum = rollupSetup('sum')
    sum.relationLinksByProp = new Map()
    expect(resolveComputedCells(input(sum)).get('r1')!['p-roll']).toBeNull()
  })
})

describe('resolveComputedCells — readonly metadata', () => {
  const created = new Date('2026-01-01T00:00:00.000Z')
  const updated = new Date('2026-02-02T00:00:00.000Z')

  function metaSetup() {
    const properties = [
      prop('p-ct', DatabasePropertyType.CREATED_TIME, 'Создано'),
      prop('p-cb', DatabasePropertyType.CREATED_BY, 'Кем создано'),
      prop('p-lt', DatabasePropertyType.LAST_EDITED_TIME, 'Изменено'),
      prop('p-lb', DatabasePropertyType.LAST_EDITED_BY, 'Кем изменено'),
    ]
    const rows = [row('r1')]
    const pageMetaByRow = new Map([
      ['r1', { createdAt: created, createdById: 'u1', updatedAt: updated, updatedById: 'u2' }],
    ])
    const userNameById = new Map([
      ['u1', 'Алиса'],
      ['u2', 'Боб'],
    ])
    return { properties, rows, pageMetaByRow, userNameById }
  }

  it('CREATED_TIME / LAST_EDITED_TIME derive from page meta as ISO strings', () => {
    const out = resolveComputedCells(input(metaSetup()))
    expect(out.get('r1')!['p-ct']).toBe(created.toISOString())
    expect(out.get('r1')!['p-lt']).toBe(updated.toISOString())
  })

  it('CREATED_BY / LAST_EDITED_BY resolve the user name', () => {
    const out = resolveComputedCells(input(metaSetup()))
    expect(out.get('r1')!['p-cb']).toBe('Алиса')
    expect(out.get('r1')!['p-lb']).toBe('Боб')
  })

  it('a formula can read created/edited metadata by name', () => {
    const s = metaSetup()
    s.properties.push(
      prop('p-f', DatabasePropertyType.FORMULA, 'F', {
        formula: 'concat("by ", prop("Кем создано"))',
      }),
    )
    const out = resolveComputedCells(input(s))
    expect(out.get('r1')!['p-f']).toBe('by Алиса')
  })
})

describe('resolveComputedCells — formula reading a rollup', () => {
  it('a formula referencing a rollup uses the aggregated value', () => {
    const properties = [
      prop('p-rel', DatabasePropertyType.RELATION, 'Связь'),
      prop('p-roll', DatabasePropertyType.ROLLUP, 'Сумма', {
        rollup: { relationPropertyId: 'p-rel', targetPropertyId: 'p-amt', aggregation: 'sum' },
      }),
      prop('p-f', DatabasePropertyType.FORMULA, 'F', { formula: 'prop("Сумма") + 1' }),
    ]
    const rows = [row('r1')]
    const relationLinksByProp = new Map([['p-rel', new Map([['r1', ['t1', 't2']]])]])
    const targetCellsByRow = new Map<string, Map<string, unknown>>([
      ['t1', new Map([['p-amt', 5]])],
      ['t2', new Map([['p-amt', 7]])],
    ])
    const out = resolveComputedCells(
      input({ rows, properties, relationLinksByProp, targetCellsByRow }),
    )
    expect(out.get('r1')!['p-roll']).toBe(12)
    expect(out.get('r1')!['p-f']).toBe(13)
  })
})
