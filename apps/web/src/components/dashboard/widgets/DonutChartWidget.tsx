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

// Donut = PieChart with innerRadius > 0 (the @mui/x-charts v9 donut recipe).
const PieChart = dynamic(() => import('@mui/x-charts/PieChart').then((m) => m.PieChart), {
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

interface DonutChartWidgetProps {
  readonly result: WidgetDataResult
  readonly options?: WidgetChartOptions
}

/**
 * DONUT widget — plots the `{status:'grouped'}` buckets as a donut (PieChart with
 * `innerRadius`). Empty/null/zero slices are dropped by `groupedToSeries.pie`; if
 * every slice is empty the widget shows the «Нет данных» state.
 */
export function DonutChartWidget({ result, options }: DonutChartWidgetProps) {
  if (result.status === 'no_access') return <WidgetNoAccess />
  if (result.status === 'hidden_property') return <WidgetHiddenProperty />
  if (result.status === 'error') return <WidgetError message={result.message} />
  if (result.status !== 'grouped') return <WidgetEmpty />

  const { pie } = groupedToSeries(result.groups)
  if (pie.length === 0) return <WidgetEmpty />

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ flex: 1, minHeight: 140 }} data-testid="dashboard-donut-chart">
        <PieChart
          series={[{ data: pie, innerRadius: 50 }]}
          hideLegend={options?.showLegend === false}
        />
      </Box>
      {result.truncated ? <WidgetTruncatedNotice /> : null}
    </Box>
  )
}
