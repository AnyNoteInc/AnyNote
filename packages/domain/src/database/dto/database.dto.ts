import { z } from 'zod'

import { DatabasePropertyType, DatabaseViewType } from '@repo/db'

// Re-export the Prisma enums so callers depend on @repo/domain, not @repo/db.
export { DatabasePropertyType, DatabaseViewType }

// ── dateInput (matches kanban's z.preprocess coercion) ───────────────────────

export const dateInput = z
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

export const propertySettingsSchema = z.object({
  options: z.array(selectOptionSchema).optional(),
  numberFormat: z.string().optional(),
})
export type PropertySettings = z.infer<typeof propertySettingsSchema>

const propertyTypeEnum = z.nativeEnum(DatabasePropertyType)
const viewTypeEnum = z.nativeEnum(DatabaseViewType)

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
  settings: z.unknown().optional(),
})
export type UpdateViewInput = z.infer<typeof updateViewInput>

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
  query: z.string().optional(),
})
export type ListRowsInput = z.infer<typeof listRowsInput>

export const reorderRowsInput = z.object({
  pageId: z.string().uuid(),
  orderedIds: z.array(z.string().uuid()),
})
export type ReorderRowsInput = z.infer<typeof reorderRowsInput>

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
  cells: Record<string, unknown>
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
  rows: DatabaseRowView[]
  systemTitleProperty: SystemTitleProperty
}
