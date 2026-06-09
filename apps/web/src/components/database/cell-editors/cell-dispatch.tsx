'use client'

import type { DatabasePropertyView, DatabaseRowView } from '../types'
import { TextCell } from './text-cell'
import { NumberCell } from './number-cell'
import { CheckboxCell } from './checkbox-cell'
import { DateCell } from './date-cell'
import { SelectCell } from './select-cell'
import { MultiSelectCell } from './multi-select-cell'
import { PersonCell } from './person-cell'
import { FileCell } from './file-cell'
import { UrlCell } from './url-cell'
import { EmailCell } from './email-cell'
import { PhoneCell } from './phone-cell'
import { PageLinkCell } from './page-link-cell'
import { RelationCell } from './relation-cell'
import { ComputedCell } from './computed-cell'

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
 *
 * `editable` is the SOURCE-level content gate (`myAccess.canEditContent` combined
 * with the page write flag): a viewer without content rights gets readonly cells
 * everywhere. This is the cl4C gate — the authoritative mutation guard is
 * server-side (the domain resolves the specific row's level on write), so a stricter
 * per-row gate here would only be cosmetic.
 * TODO(per-row): gate per row when the row view-model carries an editable level.
 */
export function CellEditor({ pageId, row, property, editable }: CellEditorProps) {
  const value = row.cells[property.id]
  switch (property.type) {
    case 'NUMBER':
      return (
        <NumberCell
          pageId={pageId}
          rowId={row.rowId}
          propertyId={property.id}
          value={value}
          editable={editable}
        />
      )
    case 'CHECKBOX':
      return (
        <CheckboxCell
          pageId={pageId}
          rowId={row.rowId}
          propertyId={property.id}
          value={value}
          editable={editable}
        />
      )
    case 'DATE':
      return (
        <DateCell
          pageId={pageId}
          rowId={row.rowId}
          propertyId={property.id}
          value={value}
          editable={editable}
        />
      )
    case 'SELECT':
    case 'STATUS':
      return (
        <SelectCell
          pageId={pageId}
          rowId={row.rowId}
          property={property}
          value={value}
          editable={editable}
        />
      )
    case 'MULTI_SELECT':
      return (
        <MultiSelectCell
          pageId={pageId}
          rowId={row.rowId}
          property={property}
          value={value}
          editable={editable}
        />
      )
    case 'PERSON':
      return (
        <PersonCell
          pageId={pageId}
          rowId={row.rowId}
          propertyId={property.id}
          value={value}
          editable={editable}
        />
      )
    case 'FILE':
      return (
        <FileCell
          pageId={pageId}
          rowId={row.rowId}
          propertyId={property.id}
          value={value}
          editable={editable}
        />
      )
    case 'URL':
      return (
        <UrlCell
          pageId={pageId}
          rowId={row.rowId}
          propertyId={property.id}
          value={value}
          editable={editable}
        />
      )
    case 'EMAIL':
      return (
        <EmailCell
          pageId={pageId}
          rowId={row.rowId}
          propertyId={property.id}
          value={value}
          editable={editable}
        />
      )
    case 'PHONE':
      return (
        <PhoneCell
          pageId={pageId}
          rowId={row.rowId}
          propertyId={property.id}
          value={value}
          editable={editable}
        />
      )
    case 'PAGE_LINK':
      return (
        <PageLinkCell
          pageId={pageId}
          rowId={row.rowId}
          propertyId={property.id}
          value={value}
          editable={editable}
        />
      )
    case 'RELATION':
      return (
        <RelationCell
          pageId={pageId}
          rowId={row.rowId}
          propertyId={property.id}
          value={value}
          editable={editable}
        />
      )
    case 'FORMULA':
    case 'ROLLUP':
    case 'CREATED_TIME':
    case 'CREATED_BY':
    case 'LAST_EDITED_TIME':
    case 'LAST_EDITED_BY':
      return <ComputedCell property={property} value={value} />
    case 'TEXT':
    default:
      return (
        <TextCell
          pageId={pageId}
          rowId={row.rowId}
          propertyId={property.id}
          value={value}
          editable={editable}
        />
      )
  }
}
