'use client'

import dynamic from 'next/dynamic'

import { Box, CircularProgress } from '@repo/ui/components'

import type { WidgetChartOptions, WidgetDataResult } from '@repo/domain'

import {
  WidgetEmpty,
  WidgetError,
  WidgetHiddenProperty,
  WidgetNoAccess,
  WidgetTruncatedNotice,
} from '../widget-data-states'
import { groupedToSeries } from './grouped-to-series'

// @mui/x-charts is heavy + browser-only; load the chart lazily (the heavy-viz
// dynamic(ssr:false) precedent — DATABASE/MEETING in page-renderer).
const BarChart = dynamic(() => import('@mui/x-charts/BarChart').then((m) => m.BarChart), {
  ssr: false,
  loading: () => <ChartSpinner />,
})

function ChartSpinner() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
      <CircularProgress size={20} />
    </Box>
  )
}

interface BarChartWidgetProps {
  readonly result: WidgetDataResult
  readonly options?: WidgetChartOptions
}

/**
 * BAR widget — plots the `{status:'grouped'}` buckets as a categorical bar chart
 * (`@mui/x-charts` BarChart, `xAxis scaleType:'band'` ← labels, one series ←
 * values). Non-grouped/non-data statuses degrade to the placeholder surfaces.
 */
export function BarChartWidget({ result, options }: BarChartWidgetProps) {
  if (result.status === 'no_access') return <WidgetNoAccess />
  if (result.status === 'hidden_property') return <WidgetHiddenProperty />
  if (result.status === 'error') return <WidgetError message={result.message} />
  if (result.status !== 'grouped') return <WidgetEmpty />
  if (result.groups.length === 0) return <WidgetEmpty />

  const { categories, values } = groupedToSeries(result.groups)

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* The chart fills this sized parent (x-charts is responsive when height/
          width are omitted + the parent has intrinsic dimensions). */}
      <Box sx={{ flex: 1, minHeight: 140 }} data-testid="dashboard-bar-chart">
        <BarChart
          xAxis={[{ scaleType: 'band', data: categories }]}
          series={[{ data: values, color: options?.color }]}
        />
      </Box>
      {result.truncated ? <WidgetTruncatedNotice /> : null}
    </Box>
  )
}
