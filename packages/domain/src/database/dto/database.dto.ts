import { z } from 'zod'

import { DatabasePropertyType, DatabaseViewType } from '@repo/db'

// Re-export the Prisma enums so callers depend on @repo/domain, not @repo/db.
export { DatabasePropertyType, DatabaseViewType }

// ── dateInput (matches kanban's z.preprocess coercion) ───────────────────────
// Not exported from the package barrel to avoid colliding with kanban's
// `dateInput`; the canonical re-exportable one lives in the kanban dto.

const dateInput = z
  .preprocess((v) => {
    if (v === null || v === undefined) return v
    if (v instanceof Date) return v
    if (typeof v === 'string') {
      const parsed = new Date(v)
      return Number.isNaN(parsed.getTime()) ? v : parsed
    }
    return v
  }, z.date().nullable())
  .optional()

// ── Property settings (select/status options + number format) ────────────────

export const selectOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string().nullable().optional(),
})
export type SelectOption = z.infer<typeof selectOptionSchema>

export const numberFormatSchema = z.enum([
  'plain',
  'integer',
  'decimal',
  'percent',
  'currency_rub',
])
export type NumberFormat = z.infer<typeof numberFormatSchema>

export const rollupAggregationSchema = z.enum([
  'show_original',
  'count_all',
  'count_values',
  'count_unique',
  'count_empty',
  'count_not_empty',
  'sum',
  'average',
  'min',
  'max',
  'earliest',
  'latest',
  'range',
])
export type RollupAggregation = z.infer<typeof rollupAggregationSchema>

export const relationSettingsSchema = z.object({
  targetSourceId: z.string().uuid(),
  // The mirror property on the target source (optional back-relation).
  backRelationPropertyId: z.string().uuid().optional(),
})
export type RelationSettings = z.infer<typeof relationSettingsSchema>

export const rollupSettingsSchema = z.object({
  // A RELATION property on THIS source.
  relationPropertyId: z.string().uuid(),
  // A property on the related source (or the '__title__' sentinel) — not a uuid().
  targetPropertyId: z.string(),
  aggregation: rollupAggregationSchema,
})
export type RollupSettings = z.infer<typeof rollupSettingsSchema>

export const propertySettingsSchema = z.object({
  options: z.array(selectOptionSchema).optional(),
  numberFormat: numberFormatSchema.optional(),
  // FORMULA — the expression source. Bounded so a stored formula can't be a
  // huge expression re-tokenized/parsed on every read for every row (DoS surface).
  formula: z.string().max(2000).optional(),
  relation: relationSettingsSchema.optional(),
  rollup: rollupSettingsSchema.optional(),
})
export type PropertySettings = z.infer<typeof propertySettingsSchema>

// ── View settings (filters / sorts / groupBy / visibility / layout) ──────────
// Validated blob persisted in DatabaseView.settings. Consumed by the pure
// query-planner (filters/sorts → Prisma where/orderBy). `'__title__'` is the
// sentinel propertyId for the implicit system Page.title column.

export const TITLE_SENTINEL = '__title__' as const

export const filterOperatorSchema = z.enum([
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'is_empty',
  'is_not_empty',
  'gt',
  'gte',
  'lt',
  'lte',
  'before',
  'after',
  'on',
  'is_checked',
  'is_not_checked',
  'is_any_of',
  'is_none_of',
])
export type FilterOperator = z.infer<typeof filterOperatorSchema>

export const filterConditionSchema = z.object({
  propertyId: z.string(),
  operator: filterOperatorSchema,
  // Shape depends on the operator/property type; validated structurally only.
  value: z.unknown().optional(),
})
export type FilterCondition = z.infer<typeof filterConditionSchema>

// Recursive group: conditions may themselves be nested groups.
export interface FilterGroup {
  conjunction: 'and' | 'or'
  conditions: Array<FilterCondition | FilterGroup>
}

export const filterGroupSchema: z.ZodType<FilterGroup> = z.lazy(() =>
  z.object({
    conjunction: z.enum(['and', 'or']),
    conditions: z.array(z.union([filterConditionSchema, filterGroupSchema])),
  }),
)

export const sortSchema = z.object({
  propertyId: z.string(),
  direction: z.enum(['asc', 'desc']),
})
export type Sort = z.infer<typeof sortSchema>

export const viewSettingsSchema = z.object({
  filters: filterGroupSchema.optional(),
  sorts: z.array(sortSchema).optional(),
  groupBy: z.object({ propertyId: z.string() }).nullable().optional(),
  // Display-only column visibility; null/absent = all properties visible.
  visibleProperties: z.array(z.string()).optional(),
  layout: z
    .object({
      datePropertyId: z.string().optional(),
      cardProperties: z.array(z.string()).optional(),
    })
    .optional(),
})
export type ViewSettings = z.infer<typeof viewSettingsSchema>

const propertyTypeEnum = z.nativeEnum(DatabasePropertyType)
const viewTypeEnum = z.nativeEnum(DatabaseViewType)

// ── Source inputs ─────────────────────────────────────────────────────────────

export const repairSourceInput = z.object({
  pageId: z.string().uuid(),
})
export type RepairSourceInput = z.infer<typeof repairSourceInput>

// ── View inputs ───────────────────────────────────────────────────────────────

export const createViewInput = z.object({
  pageId: z.string().uuid(),
  type: viewTypeEnum.optional(),
  title: z.string().min(1).max(200),
})
export type CreateViewInput = z.infer<typeof createViewInput>

export const updateViewInput = z.object({
  pageId: z.string().uuid(),
  id: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  settings: viewSettingsSchema.optional(),
})
export type UpdateViewInput = z.infer<typeof updateViewInput>

export const duplicateViewInput = z.object({
  pageId: z.string().uuid(),
  viewId: z.string().uuid(),
})
export type DuplicateViewInput = z.infer<typeof duplicateViewInput>

export const viewIdInput = z.object({
  pageId: z.string().uuid(),
  id: z.string().uuid(),
})
export type ViewIdInput = z.infer<typeof viewIdInput>

// ── Property inputs ─────────────────────────────────────────────────────────

export const createPropertyInput = z.object({
  pageId: z.string().uuid(),
  type: propertyTypeEnum,
  name: z.string().min(1).max(200),
  settings: propertySettingsSchema.optional(),
})
export type CreatePropertyInput = z.infer<typeof createPropertyInput>

export const updatePropertyInput = z.object({
  pageId: z.string().uuid(),
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  type: propertyTypeEnum.optional(),
  settings: propertySettingsSchema.optional(),
})
export type UpdatePropertyInput = z.infer<typeof updatePropertyInput>

export const propertyIdInput = z.object({
  pageId: z.string().uuid(),
  id: z.string().uuid(),
})
export type PropertyIdInput = z.infer<typeof propertyIdInput>

export const reorderPropertiesInput = z.object({
  pageId: z.string().uuid(),
  orderedIds: z.array(z.string().uuid()),
})
export type ReorderPropertiesInput = z.infer<typeof reorderPropertiesInput>

// ── Row inputs ────────────────────────────────────────────────────────────────

export const createRowInput = z.object({
  pageId: z.string().uuid(),
  title: z.string().max(2000).optional(),
})
export type CreateRowInput = z.infer<typeof createRowInput>

export const updateRowInput = z.object({
  pageId: z.string().uuid(),
  rowId: z.string().uuid(),
  title: z.string().max(2000).optional(),
  icon: z.string().nullable().optional(),
})
export type UpdateRowInput = z.infer<typeof updateRowInput>

export const rowIdInput = z.object({
  pageId: z.string().uuid(),
  rowId: z.string().uuid(),
})
export type RowIdInput = z.infer<typeof rowIdInput>

export const listRowsInput = z.object({
  pageId: z.string().uuid(),
  viewId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(100),
})
export type ListRowsInput = z.infer<typeof listRowsInput>

export const listGroupedRowsInput = z.object({
  pageId: z.string().uuid(),
  viewId: z.string().uuid(),
})
export type ListGroupedRowsInput = z.infer<typeof listGroupedRowsInput>

export const reorderRowsInput = z.object({
  pageId: z.string().uuid(),
  orderedIds: z.array(z.string().uuid()),
})
export type ReorderRowsInput = z.infer<typeof reorderRowsInput>

// Set a SINGLE row's fractional position (board drag computes the position with
// positionBetween). Avoids reorderRows' whole-column position reassignment that
// would otherwise contaminate the shared position space across board columns.
export const setRowPositionInput = z.object({
  pageId: z.string().uuid(),
  rowId: z.string().uuid(),
  position: z.number(),
})
export type SetRowPositionInput = z.infer<typeof setRowPositionInput>

// ── Cell inputs ──────────────────────────────────────────────────────────────

export const updateCellValueInput = z.object({
  pageId: z.string().uuid(),
  rowId: z.string().uuid(),
  propertyId: z.string().uuid(),
  // The raw value — type validation against the property type happens in the service.
  value: z.unknown(),
  // Convenience for DATE cells routed through z.preprocess coercion.
  dateValue: dateInput,
})
export type UpdateCellValueInput = z.infer<typeof updateCellValueInput>

// ── Relation inputs ───────────────────────────────────────────────────────────

// Replace the full set of links for a (rowId, propertyId) RELATION cell.
export const setRelationLinksInput = z.object({
  pageId: z.string().uuid(),
  rowId: z.string().uuid(),
  propertyId: z.string().uuid(),
  targetRowIds: z.array(z.string().uuid()),
})
export type SetRelationLinksInput = z.infer<typeof setRelationLinksInput>

// Candidate rows of a RELATION property's target source, for the link picker.
export const listLinkableRowsInput = z.object({
  pageId: z.string().uuid(),
  propertyId: z.string().uuid(),
  query: z.string().optional(),
})
export type ListLinkableRowsInput = z.infer<typeof listLinkableRowsInput>

// ── View-model types (single shape for renderer / table / modal / embed) ─────

export interface DatabaseSourceView {
  id: string
  pageId: string
  workspaceId: string
  title: string | null
}

export interface DatabaseViewModel {
  id: string
  type: DatabaseViewType
  title: string
  position: number
  settings: unknown
}

export interface DatabasePropertyView {
  id: string
  type: DatabasePropertyType
  name: string
  position: number
  settings: PropertySettings | null
}

export interface DatabaseRowView {
  rowId: string
  pageId: string
  title: string | null
  icon: string | null
  position: number
  // Per-property cell values keyed by propertyId. Stored cells hold their raw
  // value; computed cells (FORMULA/ROLLUP/RELATION/CREATED_*/LAST_EDITED_*) are
  // resolved on read — RELATION cells hold `RelationChip[]`, FORMULA/ROLLUP hold
  // the computed value or a `ComputedCellError` sentinel, metadata holds the
  // derived Page value.
  cells: Record<string, unknown>
}

/** A linked target row rendered as a chip in a RELATION cell. */
export interface RelationChip {
  rowId: string
  pageId: string
  title: string | null
  icon: string | null
}

/**
 * Sentinel error state for a computed cell (formula/rollup failure). The UI
 * detects the `__error` key and renders an error chip instead of a value.
 */
export interface ComputedCellError {
  __error: string
}

/** The implicit system Title/Name column (backed by Page.title, never a property row). */
export interface SystemTitleProperty {
  key: 'title'
  name: string
}

export interface DatabaseGetByPageResult {
  source: DatabaseSourceView
  views: DatabaseViewModel[]
  properties: DatabasePropertyView[]
  systemTitleProperty: SystemTitleProperty
}

/** Paginated row page returned by `listRows`. `nextCursor` is null on the last page. */
export interface ListRowsResult {
  rows: DatabaseRowView[]
  nextCursor: string | null
}

/** Grouped rows for the BOARD layout: one bucket per groupBy option + a null group. */
export interface GroupedRowsResult {
  groups: Array<{
    key: string | null
    label: string
    color: string | null
    rows: DatabaseRowView[]
  }>
}
