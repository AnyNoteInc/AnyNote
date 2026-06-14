'use client'

import type { DashboardWidgetType, WidgetConfig, WidgetDataResult } from '@repo/domain'

import { BarChartWidget } from './BarChartWidget'
import { DonutChartWidget } from './DonutChartWidget'
import { GroupedWidget } from './GroupedWidget'
import { LineChartWidget } from './LineChartWidget'
import { MetricWidget } from './MetricWidget'
import { NumberWidget } from './NumberWidget'
import { TableWidget } from './TableWidget'

export { BarChartWidget } from './BarChartWidget'
export { DonutChartWidget } from './DonutChartWidget'
export { GroupedWidget } from './GroupedWidget'
export { LineChartWidget } from './LineChartWidget'
export { MetricWidget } from './MetricWidget'
export { NumberWidget } from './NumberWidget'
export { TableWidget } from './TableWidget'
export { groupedToSeries } from './grouped-to-series'

interface WidgetBodyProps {
  readonly type: DashboardWidgetType
  readonly result: WidgetDataResult | undefined
  readonly config: WidgetConfig
  /** The widget's title, used as the stat caption for METRIC/NUMBER. */
  readonly title?: string | null
}

/**
 * Dispatch a widget's `WidgetDataResult` to the matching renderer by its type.
 * The data-state handling (no_access/hidden_property/error/truncated) lives in
 * each widget, so this is a thin type→component switch. A still-loading result
 * (`undefined`) renders nothing here (the frame/page owns the spinner).
 */
export function WidgetBody({ type, result, config, title }: WidgetBodyProps) {
  if (!result) return null
  switch (type) {
    case 'METRIC':
      return <MetricWidget result={result} label={title} />
    case 'NUMBER':
      return <NumberWidget result={result} label={title} />
    case 'GROUPED':
      return <GroupedWidget result={result} />
    case 'TABLE':
      return <TableWidget result={result} />
    case 'BAR':
      return <BarChartWidget result={result} options={config.chartOptions} />
    case 'LINE':
      return <LineChartWidget result={result} options={config.chartOptions} />
    case 'DONUT':
      return <DonutChartWidget result={result} options={config.chartOptions} />
    default:
      return null
  }
}
