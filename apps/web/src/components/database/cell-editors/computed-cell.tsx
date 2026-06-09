'use client'

import { Chip, ErrorOutlineIcon, Tooltip, Typography } from '@repo/ui/components'

import type { DatabasePropertyView } from '../types'

interface ComputedCellProps {
  readonly property: DatabasePropertyView
  readonly value: unknown
}

// Mirror of the dto `NumberFormat` enum — redefined client-side so we never import
// the dto runtime (which drags the @repo/db/pg adapter into the client bundle).
type NumberFormat = 'plain' | 'integer' | 'decimal' | 'percent' | 'currency_rub'

function numberFormatOf(property: DatabasePropertyView): NumberFormat | undefined {
  const fmt = property.settings?.numberFormat
  return typeof fmt === 'string' ? (fmt as NumberFormat) : undefined
}

/** A computed-cell error sentinel `{ __error: string }`. */
function asError(value: unknown): string | null {
  if (value && typeof value === 'object' && '__error' in value) {
    const msg = (value as { __error: unknown }).__error
    return typeof msg === 'string' ? msg : 'Ошибка'
  }
  return null
}

function formatNumber(n: number, format: NumberFormat | undefined): string {
  switch (format) {
    case 'integer':
      return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)
    case 'decimal':
      return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
    case 'percent':
      return new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 2 }).format(n)
    case 'currency_rub':
      return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(n)
    case 'plain':
    default:
      return new Intl.NumberFormat('ru-RU').format(n)
  }
}

// An ISO-8601 date(-time) string the evaluator/metadata produced (Dates cross the
// wire as ISO strings — no superjson on the browser client).
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/

function formatMaybeDate(raw: string): string {
  if (!ISO_RE.test(raw)) return raw
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  const hasTime = raw.includes('T')
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    ...(hasTime ? { timeStyle: 'short' } : {}),
  }).format(d)
}

/**
 * Read-only renderer for computed property types: FORMULA, ROLLUP,
 * CREATED_TIME, CREATED_BY, LAST_EDITED_TIME, LAST_EDITED_BY. Values are resolved
 * server-side (CREATED_BY/LAST_EDITED_BY already a display name; *_TIME an ISO
 * string; FORMULA/ROLLUP a primitive value or a `{ __error }` sentinel). Numbers
 * format per the property's `numberFormat`; date-like strings via locale; an error
 * sentinel renders a red chip. No editing affordance.
 */
export function ComputedCell({ property, value }: ComputedCellProps) {
  const errorMsg = asError(value)
  if (errorMsg) {
    return (
      <Tooltip title={errorMsg}>
        <Chip
          size="small"
          color="error"
          variant="outlined"
          icon={<ErrorOutlineIcon />}
          label="Ошибка"
        />
      </Tooltip>
    )
  }

  if (value === null || value === undefined || value === '') {
    return <span style={{ color: 'rgba(0,0,0,0.4)', fontSize: 13 }}>—</span>
  }

  let text: string
  if (typeof value === 'number') {
    text = formatNumber(value, numberFormatOf(property))
  } else if (typeof value === 'boolean') {
    text = value ? 'Да' : 'Нет'
  } else if (value instanceof Date) {
    text = formatMaybeDate(value.toISOString())
  } else if (typeof value === 'string') {
    text = formatMaybeDate(value)
  } else {
    text = String(value)
  }

  return (
    <Typography variant="body2" sx={{ fontSize: 14 }} noWrap title={text}>
      {text}
    </Typography>
  )
}
