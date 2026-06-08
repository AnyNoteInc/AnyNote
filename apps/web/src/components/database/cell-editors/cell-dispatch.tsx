'use client'

import type { DatabasePropertyView, DatabaseRowView } from '../types'
import { TextCell } from './text-cell'
import { NumberCell } from './number-cell'
import { CheckboxCell } from './checkbox-cell'
import { DateCell } from './date-cell'
import { SelectCell } from './select-cell'

interface CellEditorProps {
  /** The DATABASE page id — the key the optimistic `getByPage` cache is stored under. */
  readonly pageId: string
  readonly row: DatabaseRowView
  readonly property: DatabasePropertyView
  readonly editable: boolean
}

/**
 * Dispatch a single cell to the editor for its property type. Shared by the
 * table view and the item-page modal so both render identical, cache-consistent
 * editors (all keyed on the database `pageId` via `useCellUpdate`).
 */
export function CellEditor({ pageId, row, property, editable }: CellEditorProps) {
  const value = row.cells[property.id]
  switch (property.type) {
    case 'NUMBER':
      return (
        <NumberCell pageId={pageId} rowId={row.rowId} propertyId={property.id} value={value} editable={editable} />
      )
    case 'CHECKBOX':
      return (
        <CheckboxCell pageId={pageId} rowId={row.rowId} propertyId={property.id} value={value} editable={editable} />
      )
    case 'DATE':
      return (
        <DateCell pageId={pageId} rowId={row.rowId} propertyId={property.id} value={value} editable={editable} />
      )
    case 'SELECT':
    case 'STATUS':
      return (
        <SelectCell pageId={pageId} rowId={row.rowId} property={property} value={value} editable={editable} />
      )
    case 'TEXT':
    case 'MULTI_SELECT':
    case 'PERSON':
    case 'FILE':
    default:
      return (
        <TextCell pageId={pageId} rowId={row.rowId} propertyId={property.id} value={value} editable={editable} />
      )
  }
}
