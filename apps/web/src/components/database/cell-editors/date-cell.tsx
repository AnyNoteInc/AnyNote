'use client'

import { AdapterDateFns, DatePicker, dateFnsRu, LocalizationProvider } from '@repo/ui/components'

import { useCellUpdate } from './use-optimistic-cell'

interface DateCellProps {
  readonly pageId: string
  readonly rowId: string
  readonly propertyId: string
  readonly value: unknown
  readonly editable?: boolean
}

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value === '') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Date cell. The stored value is an ISO string; the optimistic cache also holds
 * the ISO string, and the mutation sends it as `value` (the domain re-coerces a
 * string Date via z.preprocess — the browser tRPC client has no superjson).
 */
export function DateCell({ pageId, rowId, propertyId, value, editable = true }: DateCellProps) {
  const { commit } = useCellUpdate(pageId)
  const current = toDate(value)

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={dateFnsRu}>
      <DatePicker
        value={current}
        disabled={!editable}
        onChange={(next) => {
          if (!next) {
            commit(rowId, propertyId, null)
            return
          }
          if (Number.isNaN(next.getTime())) return
          commit(rowId, propertyId, next.toISOString())
        }}
        slotProps={{
          textField: { size: 'small', variant: 'standard', fullWidth: true },
          field: { clearable: true },
        }}
      />
    </LocalizationProvider>
  )
}
