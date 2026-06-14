export * from './database.tokens.ts'
export * from './database.module.ts'
export * from './dto/database.dto.ts'
export type { DatabaseService } from './services/database.service.ts'
// Formula engine public surface (runFormula / validateFormula / parse / tokenize).
// validateFormula is a parse-only check the tRPC `database.validateFormula` query uses.
export * from './formula/index.ts'

// ── Database read-stack surface (consumed by the dashboard module) ────────────
// A sibling domain module (`dashboard`) reaches THIS module ONLY through this
// barrel (the domain-module-isolation rule); these named re-exports are the
// public read-stack contract it depends on. Named (not `export *`) to avoid the
// `PropertyMeta` collision between query-planner and computed-cells — only the
// query-planner's `PropertyMeta` is re-exported.

// Repository (the testable seam) + its row/property/rule shapes.
export { DatabaseRepository } from './repositories/database.repository.ts'
export type {
  EnabledAccessRule,
  PropertyRow,
  RowWithPage,
} from './repositories/database.repository.ts'

// Pure query planner: the Prisma where/orderBy + the JS post-filter descriptors.
export { buildRowQuery } from './services/query-planner.ts'
export type {
  MultiSelectPostFilter,
  PropertyMeta,
  RelationPostFilter,
  RowQueryPlan,
} from './services/query-planner.ts'

// Row-access resolver: the per-viewer authority (pre-filter where + post-filter).
export {
  buildRowAccessWhere,
  canEditRow,
  canViewRow,
  resolveRowAccess,
  resolveRowAccessForRows,
} from './services/row-access-resolver.ts'
export type { AccessRule, RowAccessContext, RowAccessRow } from './services/row-access-resolver.ts'

// Shared row post-filter + per-viewer row-access authority (single-sourced;
// DatabaseService delegates to these too — no copy drift).
export {
  applyMultiSelectPostFilters,
  applyRelationPostFilters,
  buildRowAccessContext,
  filterViewableRows,
  toAccessRow,
  toResolverRules,
} from './services/row-post-filters.ts'
export type { RelationLinkLookup } from './services/row-post-filters.ts'

// Computed-cells aggregation menu (the rollup aggregation reduce, VERBATIM).
export {
  aggregate,
  isEmpty,
  NUMERIC_AGGREGATORS,
  toComparableDate,
  toNum,
} from './services/computed-cells.ts'
