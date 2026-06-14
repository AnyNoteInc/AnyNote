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

const LineChart = dynamic(() => import('@mui/x-charts/LineChart').then((m) => m.LineChart), {
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

interface LineChartWidgetProps {
  readonly result: WidgetDataResult
  readonly options?: WidgetChartOptions
}

/**
 * LINE widget — plots the `{status:'grouped'}` buckets as a line over the
 * categorical (band) axis. Same grouped→series projection as the bar widget.
 */
export function LineChartWidget({ result, options }: LineChartWidgetProps) {
  if (result.status === 'no_access') return <WidgetNoAccess />
  if (result.status === 'hidden_property') return <WidgetHiddenProperty />
  if (result.status === 'error') return <WidgetError message={result.message} />
  if (result.status !== 'grouped') return <WidgetEmpty />
  if (result.groups.length === 0) return <WidgetEmpty />

  const { categories, values } = groupedToSeries(result.groups)

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ flex: 1, minHeight: 140 }} data-testid="dashboard-line-chart">
        <LineChart
          xAxis={[{ scaleType: 'band', data: categories }]}
          series={[{ data: values, color: options?.color }]}
        />
      </Box>
      {result.truncated ? <WidgetTruncatedNotice /> : null}
    </Box>
  )
}
