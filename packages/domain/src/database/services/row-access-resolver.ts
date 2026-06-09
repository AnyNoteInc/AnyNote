// Pure row-access resolver: THE single authority for database row (page-level)
// access. Given a viewer context + the source's enabled access rules + a row's
// shape, it computes the viewer's effective `DatabaseAccessLevel` on that row.
//
// Two security-critical invariants, pinned by the tests:
//  - RESTRICTIVE-WHEN-PRESENT: once any enabled rule exists on the source, a
//    plain workspace member who matches no rule (and has no broad/direct access)
//    loses access to that row (→ null). Without rules, behavior is unchanged
//    (every member sees every row, role-derived).
//  - BROADEST-ACCESS-WINS: the result is the MAX level across direct access
//    (owner/admin/creator/share) AND every matching enabled rule.
//
// No I/O — the service fetches the inputs (rules, role, share, creator flag) and
// hands them in. `@repo/db` is imported type-only (the `domain-services-no-db-value`
// architecture rule permits type-only db imports); enum VALUES come from the dto
// re-export, and role/property-type comparisons use string literals (matching
// the rest of the database service).

import type { Prisma, RoleType, DatabasePropertyType } from '@repo/db'

import { DatabaseAccessLevel } from '../dto/database.dto.ts'

// ── Level ordering ────────────────────────────────────────────────────────────

/** Total order over access levels; higher number = broader access. */
export const LEVEL_ORDER: Record<DatabaseAccessLevel, number> = {
  [DatabaseAccessLevel.CAN_VIEW]: 1,
  [DatabaseAccessLevel.CAN_COMMENT]: 2,
  [DatabaseAccessLevel.CAN_EDIT_CONTENT]: 3,
  [DatabaseAccessLevel.CAN_EDIT]: 4,
  [DatabaseAccessLevel.FULL_ACCESS]: 5,
}

/** The higher-ordered of two levels; null is treated as the lowest level. */
export function maxLevel(
  a: DatabaseAccessLevel | null,
  b: DatabaseAccessLevel | null,
): DatabaseAccessLevel | null {
  if (a === null) return b
  if (b === null) return a
  return LEVEL_ORDER[a] >= LEVEL_ORDER[b] ? a : b
}

/** A viewer can read the row at any non-null level (≥ CAN_VIEW). */
export function canViewRow(level: DatabaseAccessLevel | null): boolean {
  return level !== null
}

/** A viewer can mutate the row's content at ≥ CAN_EDIT_CONTENT. */
export function canEditRow(level: DatabaseAccessLevel | null): boolean {
  return level !== null && LEVEL_ORDER[level] >= LEVEL_ORDER[DatabaseAccessLevel.CAN_EDIT_CONTENT]
}

// ── Inputs ────────────────────────────────────────────────────────────────────

export type RowAccessContext = {
  /** The authed viewer, or null for anonymous/public access. */
  viewerId: string | null
  /** The viewer's workspace role on the source's workspace, or null (non-member). */
  workspaceRole: RoleType | null
  /** The viewer created the source's DATABASE page → full access. */
  isSourcePageCreator: boolean
  /** An explicit PageShare grant on the item page, mapped to a level (or null). */
  pageShareLevel: DatabaseAccessLevel | null
}

export type AccessRule = {
  propertyId: string
  /** Only PERSON and CREATED_BY rules participate in row matching. */
  propertyType: DatabasePropertyType
  accessLevel: DatabaseAccessLevel
  enabled: boolean
}

export type RowAccessRow = {
  rowCreatedById: string | null
  /** propertyId → raw cell value; used to match PERSON rules (value === viewerId). */
  cellsByProperty: Map<string, unknown>
}

// ── Core resolution ────────────────────────────────────────────────────────────

/** Map a workspace role to its baseline level when no rules restrict the source. */
function roleLevel(role: RoleType | null): DatabaseAccessLevel | null {
  switch (role) {
    case 'OWNER':
    case 'ADMIN':
      return DatabaseAccessLevel.FULL_ACCESS
    case 'EDITOR':
      return DatabaseAccessLevel.CAN_EDIT_CONTENT
    case 'COMMENTER':
      return DatabaseAccessLevel.CAN_COMMENT
    case 'VIEWER':
    case 'GUEST':
      return DatabaseAccessLevel.CAN_VIEW
    default:
      return null
  }
}

/**
 * Direct/broad access independent of any rule match: OWNER/ADMIN → FULL_ACCESS,
 * source-page creator → FULL_ACCESS, an explicit page share → its mapped level.
 * Returns the max of those (null if none). This level always applies, even in
 * restrictive mode.
 */
function directBroadLevel(ctx: RowAccessContext): DatabaseAccessLevel | null {
  let level: DatabaseAccessLevel | null = null
  if (ctx.workspaceRole === 'OWNER' || ctx.workspaceRole === 'ADMIN') {
    level = maxLevel(level, DatabaseAccessLevel.FULL_ACCESS)
  }
  if (ctx.isSourcePageCreator) {
    level = maxLevel(level, DatabaseAccessLevel.FULL_ACCESS)
  }
  if (ctx.pageShareLevel !== null) {
    level = maxLevel(level, ctx.pageShareLevel)
  }
  return level
}

/** Does an enabled rule match this (viewer, row)? Anonymous viewers match nothing. */
function ruleMatchesRow(rule: AccessRule, ctx: RowAccessContext, row: RowAccessRow): boolean {
  if (ctx.viewerId === null) return false
  if (rule.propertyType === 'CREATED_BY') {
    return row.rowCreatedById === ctx.viewerId
  }
  if (rule.propertyType === 'PERSON') {
    return row.cellsByProperty.get(rule.propertyId) === ctx.viewerId
  }
  // Non-PERSON/non-CREATED_BY rules never match a row (invalid targets are
  // rejected at create-time; this is defensive).
  return false
}

/**
 * The viewer's effective access level on `row`, or null for no access.
 *
 * Decision order (broadest-access-wins → the MAX level):
 *  1. directBroad: OWNER/ADMIN/creator → FULL_ACCESS; pageShareLevel → itself.
 *  2. No enabled rules → max(directBroad, role-derived level). (Preserves today's
 *     "all members see all rows" behavior.)
 *  3. Enabled rules present (RESTRICTIVE) → start from directBroad (NOT the plain
 *     role level: an unmatched plain member loses access), then raise to each
 *     matching rule's level. Return the accumulated max, or null.
 */
export function resolveRowAccess(
  ctx: RowAccessContext,
  rules: AccessRule[],
  row: RowAccessRow,
): DatabaseAccessLevel | null {
  const directBroad = directBroadLevel(ctx)
  const enabledRules = rules.filter((r) => r.enabled)

  if (enabledRules.length === 0) {
    return maxLevel(directBroad, roleLevel(ctx.workspaceRole))
  }

  let level = directBroad
  for (const rule of enabledRules) {
    if (ruleMatchesRow(rule, ctx, row)) {
      level = maxLevel(level, rule.accessLevel)
    }
  }
  return level
}

// ── Batch + DB-level predicate ─────────────────────────────────────────────────

/** Resolve a batch of rows in one pass (no N+1). Keyed by row id. */
export function resolveRowAccessForRows(
  ctx: RowAccessContext,
  rules: AccessRule[],
  rows: Array<{ id: string } & RowAccessRow>,
): Map<string, DatabaseAccessLevel | null> {
  const out = new Map<string, DatabaseAccessLevel | null>()
  for (const row of rows) {
    out.set(row.id, resolveRowAccess(ctx, rules, row))
  }
  return out
}

/** Does the viewer have source-wide broad access (sees every row)? */
function hasBroadAccess(ctx: RowAccessContext): boolean {
  return (
    ctx.workspaceRole === 'OWNER' || ctx.workspaceRole === 'ADMIN' || ctx.isSourcePageCreator
  )
}

/**
 * A DB-level pre-filter pushed into the row query — an OPTIMIZATION, not the
 * authoritative gate (the service ALSO post-filters with resolveRowAccessForRows).
 * It may only err toward returning MORE rows for a legit viewer; it must never
 * under-return.
 *
 *  - `null` = "no restriction, fetch all rows": the viewer has broad access
 *    (OWNER/ADMIN/source-page creator) OR the source has no enabled rules.
 *  - otherwise (restrictive, non-broad viewer): an OR of per-rule predicates —
 *    CREATED_BY → `{ page: { is: { createdById: viewerId } } }`,
 *    PERSON → `{ cells: { some: { propertyId, value: { equals: viewerId } } } }`.
 *  - anonymous (viewerId null) → never-match `{ id: { in: [] } }`.
 *  - enabled rules exist but none are CREATED_BY/PERSON-expressible →
 *    never-match `{ id: { in: [] } }`.
 */
export function buildRowAccessWhere(
  ctx: RowAccessContext,
  rules: AccessRule[],
): Prisma.DatabaseRowWhereInput | null {
  if (hasBroadAccess(ctx)) return null

  const enabledRules = rules.filter((r) => r.enabled)
  if (enabledRules.length === 0) return null

  const NEVER_MATCH: Prisma.DatabaseRowWhereInput = { id: { in: [] } }
  if (ctx.viewerId === null) return NEVER_MATCH

  const viewerId = ctx.viewerId
  const or: Prisma.DatabaseRowWhereInput[] = []
  for (const rule of enabledRules) {
    if (rule.propertyType === 'CREATED_BY') {
      or.push({ page: { is: { createdById: viewerId } } })
    } else if (rule.propertyType === 'PERSON') {
      or.push({ cells: { some: { propertyId: rule.propertyId, value: { equals: viewerId } } } })
    }
  }

  if (or.length === 0) return NEVER_MATCH
  return { OR: or }
}
