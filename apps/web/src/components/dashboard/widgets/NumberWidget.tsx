'use client'

import type { WidgetDataResult } from '@repo/domain'

import { StatWidget } from './StatWidget'

interface NumberWidgetProps {
  readonly result: WidgetDataResult
  readonly label?: string | null
}

/**
 * NUMBER widget — a single figure (typically a row count, or a measure framed as
 * a KPI), rendered as a big stat. Same value/placeholder body as the METRIC
 * widget via the shared {@link StatWidget}.
 */
export function NumberWidget({ result, label }: NumberWidgetProps) {
  return <StatWidget result={result} label={label} />
}
