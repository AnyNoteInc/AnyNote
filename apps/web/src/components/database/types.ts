import type { RouterOutputs } from '@/trpc/client'

/** The database SCHEMA shape returned by `database.getByPage` (source + views +
 *  properties + systemTitleProperty). Rows are fetched view-aware via `listRows`. */
export type DatabaseSchema = RouterOutputs['database']['getByPage']
/** A row of the view-aware, paginated `listRows` result. */
export type DatabaseRowView = RouterOutputs['database']['listRows']['rows'][number]

/**
 * The merged shape the renderer assembles (schema + the active view's rows) and
 * passes to the table/modal. Phase-4A keeps this `rows`-carrying shape so the
 * Phase-3 components compile unchanged; the per-view fetch hook (`useViewRows`)
 * and pagination land in Phase E.
 */
export type DatabaseViewModel = DatabaseSchema & { rows: DatabaseRowView[] }

export type DatabasePropertyView = DatabaseViewModel['properties'][number]
export type DatabaseViewEntry = DatabaseViewModel['views'][number]

/**
 * The default-view rows query input the renderer + optimistic cache helpers share
 * so `setData`/`invalidate` target the same cache entry. MVP: a single bounded
 * page of the default view. Per-view + pagination land with `useViewRows` (Phase E).
 */
export const DEFAULT_ROWS_LIMIT = 200
export function defaultRowsInput(pageId: string) {
  return { pageId, limit: DEFAULT_ROWS_LIMIT }
}

/** A select/status option (lives in `DatabaseProperty.settings.options`). */
export interface SelectOption {
  id: string
  label: string
  color?: string | null
}

/** Read the option list off a property's settings (select/status). */
export function optionsOf(property: DatabasePropertyView): SelectOption[] {
  const settings = property.settings
  if (settings && Array.isArray(settings.options)) return settings.options
  return []
}
