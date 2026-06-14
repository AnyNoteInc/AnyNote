'use client'

import type { WidgetDataResult } from '@repo/domain'

import { StatWidget } from './StatWidget'

interface MetricWidgetProps {
  readonly result: WidgetDataResult
  readonly label?: string | null
}

/**
 * METRIC widget — a single aggregate (sum/avg/min/max/count) over a property's
 * cells, rendered as a big stat. Delegates the value/placeholder rendering to
 * the shared {@link StatWidget}.
 */
export function MetricWidget({ result, label }: MetricWidgetProps) {
  return <StatWidget result={result} label={label} />
}
