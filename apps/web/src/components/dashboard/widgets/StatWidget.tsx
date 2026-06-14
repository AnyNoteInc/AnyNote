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
}

/** Locale-aware number formatting; null/undefined → an em-dash. */
function formatStat(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
}

/**
 * Renders the single-value `WidgetDataResult` variants (`metric`/`number`) as a
 * big stat. The metric vs number widget types differ only by intent (METRIC = a
 * measure over a property, NUMBER = a row count / single figure); both produce
 * the same `{value, truncated}` shape, so they share this body. The widget title
 * is shown ONCE by the surrounding `WidgetFrame` header, so this body renders no
 * caption (it would otherwise repeat the title). Non-data statuses degrade to the
 * honest placeholder surfaces.
 */
export function StatWidget({ result }: StatWidgetProps) {
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
      {result.truncated ? <WidgetTruncatedNotice /> : null}
    </Box>
  )
}
