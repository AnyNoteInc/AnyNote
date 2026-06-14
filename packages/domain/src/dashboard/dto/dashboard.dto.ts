import { z } from 'zod'

import {
  DatabasePropertyType,
  filterGroupSchema,
  rollupAggregationSchema,
} from '../../database/dto/database.dto.ts'
import type { FilterGroup, RollupAggregation } from '../../database/dto/database.dto.ts'

// ── Performance caps (spec §7.5) ──────────────────────────────────────────────
// A widget scans at most MAX_WIDGET_ROWS rows; over that the result is truncated
// (surfaced honestly as `truncated: true`). A dashboard holds at most
// MAX_WIDGETS_PER_DASHBOARD widgets (the addWidget router gate, Task 3).
export const MAX_WIDGET_ROWS = 5000
export const MAX_WIDGETS_PER_DASHBOARD = 24

// The synthetic measure sentinels — never a real propertyId, always allowed past
// the visibility/computed gate. `__count__` aggregates the row count itself;
// `__title__` is the implicit system Page.title column (the database dto's
// TITLE_SENTINEL is re-used by the service; not re-exported here to avoid a
// duplicate barrel binding).
export const COUNT_SENTINEL = '__count__' as const

// ── Widget type ───────────────────────────────────────────────────────────────
// Aligns with the Prisma `DashboardWidgetType` enum (Task 1).
export const dashboardWidgetTypeSchema = z.enum([
  'METRIC',
  'NUMBER',
  'GROUPED',
  'TABLE',
  'BAR',
  'LINE',
  'DONUT',
])
export type DashboardWidgetType = z.infer<typeof dashboardWidgetTypeSchema>

// Widget types whose data is a single aggregate value.
export const METRIC_WIDGET_TYPES: ReadonlySet<DashboardWidgetType> = new Set(['METRIC', 'NUMBER'])

// Widget types whose data is a grouped aggregation (group → value).
export const GROUPED_WIDGET_TYPES: ReadonlySet<DashboardWidgetType> = new Set([
  'GROUPED',
  'BAR',
  'LINE',
  'DONUT',
])

// ── Widget config ─────────────────────────────────────────────────────────────

export const widgetMetricSchema = z.object({
  // A real propertyId, or the COUNT_SENTINEL ('__count__') for a pure row count.
  propertyId: z.string(),
  aggregation: rollupAggregationSchema,
})
export type WidgetMetric = z.infer<typeof widgetMetricSchema>

export const widgetChartOptionsSchema = z
  .object({
    color: z.string().optional(),
    stacked: z.boolean().optional(),
    showLegend: z.boolean().optional(),
  })
  .optional()
export type WidgetChartOptions = z.infer<typeof widgetChartOptionsSchema>

export const widgetConfigSchema = z.object({
  metric: widgetMetricSchema.optional(),
  groupByPropertyId: z.string().optional(),
  filters: filterGroupSchema.optional(),
  chartOptions: widgetChartOptionsSchema,
  // TABLE widgets paginate; a per-page cap (capped to MAX_WIDGET_ROWS server-side).
  tableLimit: z.number().int().min(1).max(MAX_WIDGET_ROWS).optional(),
})
export type WidgetConfig = z.infer<typeof widgetConfigSchema>

// A persisted global filter targets a property by NAME so a single filter can
// apply across widgets sourcing different databases that share a property name +
// compatible type (spec §3 / invariant 4).
export const globalFilterInputSchema = z.object({
  propertyName: z.string(),
  operator: z.string(),
  value: z.unknown().optional(),
})
export type GlobalFilterInput = z.infer<typeof globalFilterInputSchema>

// ── aggregateWidget input ─────────────────────────────────────────────────────

export interface AggregateWidgetInput {
  sourceId: string
  viewId?: string
  type: DashboardWidgetType
  config: WidgetConfig
  globalFilters?: GlobalFilterInput[]
}

// ── Result union (object-hiding; spec §4 / invariant 6) ───────────────────────

/** A single bucket of a grouped aggregation. */
export interface WidgetGroup {
  key: string | null
  label: string
  value: number | null
}

/** A read-only row slice for the TABLE widget (the mapRow shape). */
export interface WidgetTableRow {
  rowId: string
  pageId: string
  title: string | null
  icon: string | null
  cells: Record<string, unknown>
}

/** A property descriptor surfaced alongside a TABLE widget's rows. */
export interface WidgetTableProperty {
  id: string
  type: DatabasePropertyType
  name: string
}

export type WidgetDataResult =
  | { status: 'metric'; value: number | null; truncated: boolean }
  | { status: 'number'; value: number | null; truncated: boolean }
  | { status: 'grouped'; groups: WidgetGroup[]; truncated: boolean }
  | {
      status: 'table'
      rows: WidgetTableRow[]
      properties: WidgetTableProperty[]
      truncated: boolean
      nextCursor?: string | null
    }
  | { status: 'no_access' }
  | { status: 'hidden_property'; propertyId: string }
  | { status: 'error'; message: string }

// NOTE: `DatabasePropertyType` / `rollupAggregationSchema` / `FilterGroup` /
// `RollupAggregation` are NOT re-exported here — they already flow through the
// `@repo/domain` barrel via `./database/index.ts`; re-exporting them would be a
// duplicate binding. Callers import those from `@repo/domain` (database dto).
