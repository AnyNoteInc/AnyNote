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
/** Client-facing subset of the form management record used by the builder. */
export interface DatabaseManagedForm {
  id: string
  sourceId: string
  viewId: string | null
  routeKey: string
  customSlug: string | null
  linkRevision: number
  state: 'DRAFT' | 'OPEN' | 'CLOSED' | 'ARCHIVED'
  audience: 'ANYONE_WITH_LINK' | 'SIGNED_IN_WITH_LINK' | 'WORKSPACE_MEMBERS_WITH_LINK'
  respondentAccess: 'NONE' | 'VIEW' | 'EDIT'
  draftSchema: unknown
  draftRevision: number
  publishedVersionId: string | null
  publishedVersion: {
    versionNumber: number
    schema: unknown
  } | null
  opensAt: Date | string | null
  closesAt: Date | string | null
  responseLimit: number | null
  acceptedResponses: number
  notifyOwners: boolean
  source: {
    id?: string
    workspaceId?: string
    properties: ReadonlyArray<{ id: string; name: string; type: string; settings?: unknown }>
  }
}

/** One visible, access-filtered response returned by the form response API. */
export interface DatabaseFormResponse {
  submissionId: string
  submittedAt: Date | string
  endingId: string
  row: DatabaseRowView
}

export type DatabasePropertyView = DatabaseSchema['properties'][number]
export type DatabaseViewEntry = DatabaseSchema['views'][number]
export type SystemTitleProperty = DatabaseSchema['systemTitleProperty']
/**
 * The viewer's own database capabilities (from `database.getByPage`). Drives
 * permission-aware affordances only — the authoritative gate is server-side.
 * `canEditStructure` is false both for insufficient rights AND when the source's
 * structure is locked (`structureLocked` distinguishes the two for tooltips).
 */
export type MyDatabaseAccess = DatabaseSchema['myAccess']

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
  /**
   * Content-edit rights — true only when the viewer may edit cell content / rows
   * (page-level write flag AND `myAccess.canEditContent`). The shared cell editors
   * read this; a viewer without content rights gets readonly cells.
   */
  readonly editable: boolean
  /**
   * Structure-edit rights — true only when the viewer may edit the schema/views
   * (page-level write flag AND `myAccess.canEditStructure`). Drives add-property,
   * the property/view menus, and the view-config controls. Distinct from `editable`
   * because content and structure rights are independent.
   */
  readonly canEditStructure: boolean
  readonly myAccess: MyDatabaseAccess
}

/**
 * The tooltip copy for a disabled structure affordance: a locked structure reads
 * differently from plain insufficient rights, per the cl4C spec.
 */
export function structureDisabledReason(myAccess: MyDatabaseAccess): string {
  return myAccess.structureLocked ? 'Структура заблокирована' : 'Недостаточно прав'
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
