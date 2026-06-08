// Pure query planner: translates a typed `ViewSettings` (filters/sorts) into a
// Prisma `where` + `orderBy` for `DatabaseRow`. No I/O, no Prisma client — only
// builds plain typed objects. `@repo/db` is imported type-only (the
// `domain-services-no-db-value` architecture rule permits type-only db imports).
//
// JSON cell-value filtering: a cell's `value` is a `Json?` column. The planner
// emits `cells: { some: { propertyId, value: <Prisma JSON filter> } }` using
// Prisma's native `JsonNullableFilter` operators (`equals`, `string_contains`,
// `gt`/`gte`/`lt`/`lte`). The null/empty cases emit `{ equals: null }` as an
// intermediate; the repository swaps that for `Prisma.DbNull` at execution time
// (the planner stays a pure value-free object builder).
//
// Two documented limitations, both consistent with the spec:
//  - MULTI_SELECT array containment is not portably expressible in Prisma JSON
//    filters, so `is_any_of`/`is_none_of` are returned in `multiSelectPostFilters`
//    and applied in JS by the service after fetch.
//  - Prisma 7 cannot `orderBy` a specific cell's JSON value through the relation
//    (only `__title__` → `page.title`), so cell-property sorts fall back to the
//    stable `position` order; only `__title__` sorts reach the DB `orderBy`.

import type { Prisma } from '@repo/db'

import { DatabasePropertyType } from '../dto/database.dto.ts'
import type {
  FilterCondition,
  FilterGroup,
  Sort,
  ViewSettings,
} from '../dto/database.dto.ts'

const TITLE = '__title__'

export interface PropertyMeta {
  id: string
  type: DatabasePropertyType
}

export interface MultiSelectPostFilter {
  propertyId: string
  op: 'is_any_of' | 'is_none_of'
  optionIds: string[]
}

export interface RowQueryPlan {
  where: Prisma.DatabaseRowWhereInput
  orderBy: Prisma.DatabaseRowOrderByWithRelationInput[]
  multiSelectPostFilters: MultiSelectPostFilter[]
}

type CellValueFilter = Prisma.DatabaseCellValueWhereInput['value']

// Intermediate null sentinel. Prisma's JSON null filter value is `Prisma.DbNull`
// (a runtime value the architecture rule forbids importing here); the repository
// swaps this literal `null` for `Prisma.DbNull` when executing the query.
const NULL_VALUE = null as unknown as Prisma.InputJsonValue

// Discriminate a nested group from a leaf condition.
function isGroup(node: FilterCondition | FilterGroup): node is FilterGroup {
  return 'conjunction' in node && 'conditions' in node
}

/** Build a `cells.some({ propertyId, value })` predicate for a cell-backed condition. */
function cellSome(
  propertyId: string,
  value: CellValueFilter,
): Prisma.DatabaseRowWhereInput {
  return { cells: { some: { propertyId, value } } }
}

/** Title (system Page.title) predicate. */
function titleFilter(
  filter: Prisma.StringFilter,
): Prisma.DatabaseRowWhereInput {
  return { page: { is: { title: filter } } }
}

/**
 * Translate a single leaf condition into a row `where` fragment. Returns `null`
 * for conditions handled out-of-band (MULTI_SELECT → post-filters), which the
 * caller drops from the `where` while still recording the post-filter.
 */
function buildCondition(
  cond: FilterCondition,
  metaById: Map<string, PropertyMeta>,
  postFilters: MultiSelectPostFilter[],
): Prisma.DatabaseRowWhereInput | null {
  const { propertyId, operator } = cond
  const value = cond.value

  // ── Title (system column) ──────────────────────────────────────────────────
  if (propertyId === TITLE) {
    switch (operator) {
      case 'contains':
        return titleFilter({ contains: String(value ?? ''), mode: 'insensitive' })
      case 'not_contains':
        return { NOT: titleFilter({ contains: String(value ?? ''), mode: 'insensitive' }) }
      case 'equals':
        return titleFilter({ equals: String(value ?? '') })
      case 'not_equals':
        return { NOT: titleFilter({ equals: String(value ?? '') }) }
      case 'is_empty':
        return { OR: [{ page: { is: { title: null } } }, titleFilter({ equals: '' })] }
      case 'is_not_empty':
        // Must exclude both NULL and the empty string so it is the exact
        // complement of is_empty (a title='' row is empty, not non-empty).
        return {
          AND: [{ page: { is: { title: { not: null } } } }, { NOT: titleFilter({ equals: '' }) }],
        }
      default:
        return titleFilter({ contains: String(value ?? ''), mode: 'insensitive' })
    }
  }

  const type = metaById.get(propertyId)?.type

  // ── MULTI_SELECT → post-filter (Prisma can't express array containment) ─────
  if (type === DatabasePropertyType.MULTI_SELECT) {
    if (operator === 'is_any_of' || operator === 'is_none_of') {
      postFilters.push({
        propertyId,
        op: operator,
        optionIds: Array.isArray(value) ? (value as string[]) : [],
      })
      return null
    }
  }

  // ── SELECT / STATUS is_any_of / is_none_of ──────────────────────────────────
  // A single-select cell stores ONE option id, so membership is expressible
  // directly in Prisma as an OR of equals (no post-filter needed).
  if (operator === 'is_any_of' || operator === 'is_none_of') {
    const optionIds = Array.isArray(value) ? (value as string[]) : []
    // Empty selection: is_any_of matches nothing, is_none_of matches everything.
    if (optionIds.length === 0) {
      return operator === 'is_any_of' ? { id: { in: [] } } : {}
    }
    const anyOf: Prisma.DatabaseRowWhereInput = {
      OR: optionIds.map((id) => cellSome(propertyId, { equals: id })),
    }
    return operator === 'is_none_of' ? { NOT: anyOf } : anyOf
  }

  // ── Empty / not-empty (shared across cell types) ────────────────────────────
  if (operator === 'is_empty') {
    return {
      OR: [
        { cells: { none: { propertyId } } },
        cellSome(propertyId, { equals: NULL_VALUE }),
      ],
    }
  }
  if (operator === 'is_not_empty') {
    return { cells: { some: { propertyId, NOT: { value: { equals: NULL_VALUE } } } } }
  }

  // ── CHECKBOX ────────────────────────────────────────────────────────────────
  if (operator === 'is_checked') {
    return cellSome(propertyId, { equals: true })
  }
  if (operator === 'is_not_checked') {
    return { NOT: cellSome(propertyId, { equals: true }) }
  }

  // ── Generic cell-value comparisons ──────────────────────────────────────────
  switch (operator) {
    case 'contains':
      return cellSome(propertyId, { string_contains: String(value ?? '') })
    case 'not_contains':
      return { NOT: cellSome(propertyId, { string_contains: String(value ?? '') }) }
    case 'equals':
    case 'on':
      return cellSome(propertyId, { equals: value as Prisma.InputJsonValue })
    case 'not_equals':
      return { NOT: cellSome(propertyId, { equals: value as Prisma.InputJsonValue }) }
    case 'gt':
    case 'after':
      return cellSome(propertyId, { gt: value as Prisma.InputJsonValue })
    case 'gte':
      return cellSome(propertyId, { gte: value as Prisma.InputJsonValue })
    case 'lt':
    case 'before':
      return cellSome(propertyId, { lt: value as Prisma.InputJsonValue })
    case 'lte':
      return cellSome(propertyId, { lte: value as Prisma.InputJsonValue })
    default:
      return null
  }
}

/** Recursively translate a FilterGroup into a Prisma AND/OR where node. */
function buildGroup(
  group: FilterGroup,
  metaById: Map<string, PropertyMeta>,
  postFilters: MultiSelectPostFilter[],
): Prisma.DatabaseRowWhereInput {
  const parts: Prisma.DatabaseRowWhereInput[] = []
  for (const node of group.conditions) {
    if (isGroup(node)) {
      parts.push(buildGroup(node, metaById, postFilters))
    } else {
      const fragment = buildCondition(node, metaById, postFilters)
      if (fragment) parts.push(fragment)
    }
  }
  return group.conjunction === 'or' ? { OR: parts } : { AND: parts }
}

/** Build the `orderBy` chain. Only `__title__` sorts reach Prisma; the stable
 *  `position` tiebreak is always appended last. */
function buildOrderBy(sorts: Sort[] | undefined): Prisma.DatabaseRowOrderByWithRelationInput[] {
  const orderBy: Prisma.DatabaseRowOrderByWithRelationInput[] = []
  for (const sort of sorts ?? []) {
    if (sort.propertyId === TITLE) {
      orderBy.push({ page: { title: sort.direction } })
    }
    // Cell-property sorts are not DB-expressible (see file header) — skipped.
  }
  orderBy.push({ position: 'asc' })
  return orderBy
}

/**
 * Pure: translate `ViewSettings` + the source's property set into a Prisma
 * `where`/`orderBy` plan plus the MULTI_SELECT post-filters the service applies
 * in JS. The caller merges `{ sourceId, deletedAt: null }` into `where`.
 */
export function buildRowQuery(
  settings: ViewSettings,
  properties: PropertyMeta[],
): RowQueryPlan {
  const metaById = new Map(properties.map((p) => [p.id, p]))
  const multiSelectPostFilters: MultiSelectPostFilter[] = []

  const where = settings.filters
    ? buildGroup(settings.filters, metaById, multiSelectPostFilters)
    : {}

  return {
    where,
    orderBy: buildOrderBy(settings.sorts),
    multiSelectPostFilters,
  }
}
