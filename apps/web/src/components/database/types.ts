import type { RouterOutputs } from '@/trpc/client'
// TYPE-ONLY import of the view-settings shape. We deliberately avoid importing the
// runtime `viewSettingsSchema` (or anything else) from the dto leaf: that module
// imports the `@repo/db` runtime enums, which drag the PrismaPg/pg adapter into the
// client bundle (webpack can't resolve node `net`/`tls`). `view.settings` is already
// validated server-side on write, so the client coerces it structurally instead.
import type { ViewSettings } from '@repo/domain/database/dto/database.dto.ts'

/** The database SCHEMA shape returned by `database.getByPage` (source + views +
 *  properties + systemTitleProperty). Rows are fetched view-aware via `listRows`. */
export type DatabaseSchema = RouterOutputs['database']['getByPage']
/** A row of the view-aware, paginated `listRows` result. */
export type DatabaseRowView = RouterOutputs['database']['listRows']['rows'][number]

export type DatabasePropertyView = DatabaseSchema['properties'][number]
export type DatabaseViewEntry = DatabaseSchema['views'][number]
export type SystemTitleProperty = DatabaseSchema['systemTitleProperty']

/**
 * Sentinel propertyId for the implicit system Page.title column in filters/sorts.
 * Mirrors `TITLE_SENTINEL` in `@repo/domain/database/dto` — redefined client-side so
 * we never import the dto's runtime (which pulls the `@repo/db`/pg adapter into the
 * client bundle). The literal type keeps it in lock-step with the domain value.
 */
export const TITLE_SENTINEL = '__title__' as const

/**
 * The shared prop interface every view layout (table/board/calendar/list) takes.
 * The renderer resolves the active view from `?viewId=` and dispatches by
 * `view.type` to the matching component, all with this same shape — Phase F's
 * board/calendar/list fill in the stubs against it.
 */
export interface DatabaseViewProps {
  readonly pageId: string
  readonly viewId: string
  readonly view: DatabaseViewEntry
  readonly properties: DatabaseSchema['properties']
  readonly systemTitleProperty: SystemTitleProperty
  readonly editable: boolean
}

/**
 * Coerce a view's persisted `settings` blob (typed `unknown` on the wire) into the
 * typed `ViewSettings`. The server validates settings against `viewSettingsSchema`
 * on every write, so a stored blob is either a valid `ViewSettings` object or
 * null/absent; we only guard the object-ness here. Falls back to `{}` so the UI
 * never crashes on a missing/legacy view.
 */
export function parseViewSettings(settings: unknown): ViewSettings {
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    return settings as ViewSettings
  }
  return {}
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
