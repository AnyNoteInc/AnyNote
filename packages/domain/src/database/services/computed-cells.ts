// Pure compute-on-read resolver. Given a page of rows + their stored cells and a
// set of pre-fetched dependency maps (relation links, target cell values, target
// titles, page metadata, user names — all fetched ONCE in batch by the service),
// it returns each row's FULL cell map: stored cells plus the resolved values for
// the computed property types (RELATION / ROLLUP / FORMULA / CREATED_* /
// LAST_EDITED_*).
//
// It is PURE: no I/O, no Prisma, no clock/global access beyond the formula
// engine (itself sandboxed). Cycle-safe by construction — formula/rollup values
// are resolved lazily per (row, property) behind a per-row visiting set, so a
// circular formula (A→B→A) yields a `{ __error: 'circular reference' }` on the
// cycle members instead of recursing forever.

import { runFormula } from '../formula/index.ts'
import { isFormulaError, type FormulaValue } from '../formula/index.ts'
import { DatabasePropertyType } from '../dto/database.dto.ts'
import type { PropertySettings, RelationChip, RollupAggregation } from '../dto/database.dto.ts'

const TITLE_SENTINEL = '__title__'

// ── I/O types ─────────────────────────────────────────────────────────────────

export interface RowWithCells {
  id: string
  pageId: string
  cells: { propertyId: string; value: unknown }[]
}

export interface PropertyMeta {
  id: string
  type: DatabasePropertyType
  name: string
  settings: PropertySettings | null
}

export interface PageMeta {
  createdAt: Date
  createdById: string | null
  updatedAt: Date
  updatedById: string | null
}

export interface ComputedCellsInput {
  rows: RowWithCells[]
  properties: PropertyMeta[]
  /** propertyId → (rowId → linked target row ids). For RELATION + ROLLUP's relation prop. */
  relationLinksByProp: Map<string, Map<string, string[]>>
  /** Chip metadata (title/icon) for any linkable target row, keyed by target rowId. */
  chipByRowId: Map<string, RelationChip>
  /** Target rowId → (propertyId → stored cell value). Read by rollups. */
  targetCellsByRow: Map<string, Map<string, unknown>>
  /** Target rowId → its page title. Read by rollups whose targetPropertyId is '__title__'. */
  targetTitleByRow: Map<string, string | null>
  /** Source rowId → its page/row metadata (for the created/edited metadata + formula scope). */
  pageMetaByRow: Map<string, PageMeta>
  /** userId → display name (CREATED_BY/LAST_EDITED_BY resolution). */
  userNameById: Map<string, string>
}

const CIRCULAR_ERROR = { __error: 'circular reference' } as const

// ── Aggregation ───────────────────────────────────────────────────────────────

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return true
  if (Array.isArray(v)) return v.length === 0
  return false
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isNaN(v) ? null : v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isNaN(n) ? null : n
  }
  return null
}

function toComparableDate(v: unknown): number | null {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'string' || typeof v === 'number') {
    const t = new Date(v).getTime()
    return Number.isNaN(t) ? null : t
  }
  return null
}

/** Non-empty target values coerced to numbers (un-coercible ones dropped). */
function numericValues(nonEmpty: unknown[]): number[] {
  return nonEmpty.map(toNum).filter((n): n is number => n !== null)
}

/** Earliest/latest: the original value with the min/max comparable date. */
function extremeByDate(nonEmpty: unknown[], pickEarliest: boolean): unknown {
  let best: unknown = null
  let bestTime: number | null = null
  for (const v of nonEmpty) {
    const t = toComparableDate(v)
    if (t === null) continue
    if (bestTime === null || (pickEarliest ? t < bestTime : t > bestTime)) {
      bestTime = t
      best = v
    }
  }
  return best
}

const NUMERIC_AGGREGATORS: Partial<Record<RollupAggregation, (nums: number[]) => number>> = {
  sum: (nums) => nums.reduce((a, b) => a + b, 0),
  average: (nums) => nums.reduce((a, b) => a + b, 0) / nums.length,
  min: (nums) => Math.min(...nums),
  max: (nums) => Math.max(...nums),
  range: (nums) => Math.max(...nums) - Math.min(...nums),
}

function aggregate(aggregation: RollupAggregation, values: unknown[]): unknown {
  const nonEmpty = values.filter((v) => !isEmpty(v))

  const numeric = NUMERIC_AGGREGATORS[aggregation]
  if (numeric) {
    const nums = numericValues(nonEmpty)
    return nums.length === 0 ? null : numeric(nums)
  }

  switch (aggregation) {
    case 'show_original':
      return values
    case 'count_all':
      return values.length
    case 'count_values':
    case 'count_not_empty':
      return nonEmpty.length
    case 'count_empty':
      return values.length - nonEmpty.length
    case 'count_unique':
      return new Set(nonEmpty.map((v) => JSON.stringify(v))).size
    case 'earliest':
      return extremeByDate(nonEmpty, true)
    case 'latest':
      return extremeByDate(nonEmpty, false)
    default:
      return null
  }
}

// ── Resolver ──────────────────────────────────────────────────────────────────

export function resolveComputedCells(
  input: ComputedCellsInput,
): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>()

  const propsById = new Map(input.properties.map((p) => [p.id, p]))
  // A property NAME may collide across types; first declaration wins (matches the
  // order properties are listed). Formulas reference by name.
  const propByName = new Map<string, PropertyMeta>()
  for (const p of input.properties) {
    if (!propByName.has(p.name)) propByName.set(p.name, p)
  }

  for (const row of input.rows) {
    const stored = new Map(row.cells.map((c) => [c.propertyId, c.value]))
    const computed: Record<string, unknown> = {}
    // Memoized resolved value per property id (for this row).
    const memo = new Map<string, unknown>()
    // Cycle guard: property ids currently being resolved on the stack.
    const visiting = new Set<string>()

    const pageMeta = input.pageMetaByRow.get(row.id) ?? null

    // Resolve a single property's value for THIS row (lazy, memoized, cycle-safe).
    const resolve = (propertyId: string): unknown => {
      if (memo.has(propertyId)) return memo.get(propertyId)
      const prop = propsById.get(propertyId)
      if (!prop) return null

      // Plain stored types short-circuit (no recursion possible).
      if (
        prop.type !== DatabasePropertyType.FORMULA &&
        prop.type !== DatabasePropertyType.ROLLUP &&
        prop.type !== DatabasePropertyType.RELATION &&
        prop.type !== DatabasePropertyType.CREATED_TIME &&
        prop.type !== DatabasePropertyType.CREATED_BY &&
        prop.type !== DatabasePropertyType.LAST_EDITED_TIME &&
        prop.type !== DatabasePropertyType.LAST_EDITED_BY
      ) {
        const v = stored.get(propertyId) ?? null
        memo.set(propertyId, v)
        return v
      }

      if (visiting.has(propertyId)) {
        // A cycle reached this property while it was still resolving.
        return { ...CIRCULAR_ERROR }
      }
      visiting.add(propertyId)
      let value: unknown
      try {
        value = computeProperty(prop)
      } finally {
        visiting.delete(propertyId)
      }
      memo.set(propertyId, value)
      return value
    }

    const resolveRelationChips = (prop: PropertyMeta): RelationChip[] => {
      const links = input.relationLinksByProp.get(prop.id)?.get(row.id) ?? []
      const chips: RelationChip[] = []
      for (const targetId of links) {
        const chip = input.chipByRowId.get(targetId)
        if (chip) chips.push(chip)
      }
      return chips
    }

    const resolveRollup = (prop: PropertyMeta): unknown => {
      const cfg = prop.settings?.rollup
      if (!cfg) return null
      const links = input.relationLinksByProp.get(cfg.relationPropertyId)?.get(row.id) ?? []
      const values: unknown[] = links.map((targetId) => {
        if (cfg.targetPropertyId === TITLE_SENTINEL) {
          return input.targetTitleByRow.get(targetId) ?? null
        }
        return input.targetCellsByRow.get(targetId)?.get(cfg.targetPropertyId) ?? null
      })
      return aggregate(cfg.aggregation, values)
    }

    function computeProperty(prop: PropertyMeta): unknown {
      switch (prop.type) {
        case DatabasePropertyType.CREATED_TIME:
          return pageMeta ? pageMeta.createdAt.toISOString() : null
        case DatabasePropertyType.LAST_EDITED_TIME:
          return pageMeta ? pageMeta.updatedAt.toISOString() : null
        case DatabasePropertyType.CREATED_BY:
          return pageMeta?.createdById
            ? (input.userNameById.get(pageMeta.createdById) ?? null)
            : null
        case DatabasePropertyType.LAST_EDITED_BY:
          return pageMeta?.updatedById
            ? (input.userNameById.get(pageMeta.updatedById) ?? null)
            : null
        case DatabasePropertyType.RELATION:
          return resolveRelationChips(prop)
        case DatabasePropertyType.ROLLUP:
          return resolveRollup(prop)
        case DatabasePropertyType.FORMULA: {
          const expression = prop.settings?.formula
          if (!expression) return null
          // Build the scope keyed by property NAME: resolve each referenced prop
          // lazily. A self/mutual reference re-enters `resolve`, which returns the
          // circular sentinel (the visiting set is already marking this prop).
          const scope = buildScope()
          return runFormula(expression, scope)
        }
        default:
          return stored.get(prop.id) ?? null
      }
    }

    // The formula scope is a name→value object with lazily-resolved own accessor
    // properties (so `Object.prototype.hasOwnProperty` in the evaluator returns
    // true for known property names, and only the referenced ones are computed —
    // cycles are caught at the exact property re-entry via the visiting set).
    function buildScope(): Record<string, unknown> {
      const scope: Record<string, unknown> = {}
      for (const [name, prop] of propByName) {
        Object.defineProperty(scope, name, {
          enumerable: true,
          get: () => toFormulaScopeValue(resolve(prop.id)),
        })
      }
      return scope
    }

    // Compute every property for this row so the full cell map is returned.
    for (const prop of input.properties) {
      computed[prop.id] = resolve(prop.id)
    }
    // Carry any stored cell whose property is unknown to the schema (defensive).
    for (const [propertyId, value] of stored) {
      if (!propsById.has(propertyId)) computed[propertyId] = value
    }

    result.set(row.id, computed)
  }

  return result
}

/**
 * Coerce a resolved cell value into something the formula engine can read. The
 * engine's FormulaValue domain is string|number|boolean|Date|null|{__error}; a
 * relation chip array / rollup array / multi-select array is reduced to a value
 * the engine can use (its length, via the array → truthiness/length functions).
 * An {__error} dependency is passed through so it propagates.
 */
function toFormulaScopeValue(v: unknown): FormulaValue {
  if (v === null || v === undefined) return null
  if (isFormulaError(v)) return v
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return v
  if (Array.isArray(v)) {
    // Relation chips / multi-select arrays: most useful as their element count.
    return v.length
  }
  return null
}
