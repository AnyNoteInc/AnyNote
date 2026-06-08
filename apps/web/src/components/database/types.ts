import type { RouterOutputs } from '@/trpc/client'

/** The single source/view-model shape returned by `database.getByPage`. */
export type DatabaseViewModel = RouterOutputs['database']['getByPage']
export type DatabasePropertyView = DatabaseViewModel['properties'][number]
export type DatabaseRowView = DatabaseViewModel['rows'][number]
export type DatabaseViewEntry = DatabaseViewModel['views'][number]

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
