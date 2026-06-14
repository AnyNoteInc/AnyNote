'use client'

import { Box, Typography } from '@repo/ui/components'

import type { WidgetDataResult } from '@repo/domain'

import {
  WidgetEmpty,
  WidgetError,
  WidgetHiddenProperty,
  WidgetNoAccess,
  WidgetTruncatedNotice,
} from '../widget-data-states'

interface StatWidgetProps {
  readonly result: WidgetDataResult
  /** The widget's persisted title, shown as the stat's caption when present. */
  readonly label?: string | null
}

/** Locale-aware number formatting; null/undefined → an em-dash. */
function formatStat(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
}

/**
 * Renders the single-value `WidgetDataResult` variants (`metric`/`number`) as a
 * big stat + an optional caption. The metric vs number widget types differ only
 * by intent (METRIC = a measure over a property, NUMBER = a row count / single
 * figure); both produce the same `{value, truncated}` shape, so they share this
 * body. Non-data statuses degrade to the honest placeholder surfaces.
 */
export function StatWidget({ result, label }: StatWidgetProps) {
  if (result.status === 'no_access') return <WidgetNoAccess />
  if (result.status === 'hidden_property') return <WidgetHiddenProperty />
  if (result.status === 'error') return <WidgetError message={result.message} />
  if (result.status !== 'metric' && result.status !== 'number') {
    // A grouped/table result wired to a stat widget is a misconfiguration — show
    // a neutral empty state rather than crashing.
    return <WidgetEmpty />
  }

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
      }}
    >
      <Typography
        variant="h3"
        sx={{ fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}
        data-testid="dashboard-stat-value"
      >
        {formatStat(result.value)}
      </Typography>
      {label ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {label}
        </Typography>
      ) : null}
      {result.truncated ? <WidgetTruncatedNotice /> : null}
    </Box>
  )
}
