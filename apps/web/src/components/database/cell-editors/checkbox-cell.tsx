'use client'

import { Checkbox } from '@repo/ui/components'

import { useCellUpdate } from './use-optimistic-cell'

interface CheckboxCellProps {
  readonly pageId: string
  readonly rowId: string
  readonly propertyId: string
  readonly value: unknown
  readonly editable?: boolean
}

/** Boolean cell. */
export function CheckboxCell({
  pageId,
  rowId,
  propertyId,
  value,
  editable = true,
}: CheckboxCellProps) {
  const { commit } = useCellUpdate(pageId)
  const checked = value === true

  return (
    <Checkbox
      checked={checked}
      disabled={!editable}
      size="small"
      onChange={(e) => commit(rowId, propertyId, e.target.checked)}
    />
  )
}
