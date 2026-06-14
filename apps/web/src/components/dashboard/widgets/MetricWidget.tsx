'use client'

import type { WidgetDataResult } from '@repo/domain'

import { StatWidget } from './StatWidget'

interface MetricWidgetProps {
  readonly result: WidgetDataResult
}

/**
 * METRIC widget — a single aggregate (sum/avg/min/max/count) over a property's
 * cells, rendered as a big stat. Delegates the value/placeholder rendering to
 * the shared {@link StatWidget}. The title is rendered once by the WidgetFrame.
 */
export function MetricWidget({ result }: MetricWidgetProps) {
  return <StatWidget result={result} />
}
