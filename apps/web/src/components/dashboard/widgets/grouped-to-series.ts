import type { WidgetGroup } from '@repo/domain'

/**
 * The chart-ready projection of a grouped widget result. The categorical axis
 * labels (`categories`) line up index-for-index with the numeric `values`; the
 * pie projection (`pie`) carries an id/label/value per slice.
 *
 * A grouped bucket whose `value` is null contributes 0 to the bar/line series
 * (a chart can't plot "no data" as a gap without breaking the axis), but the
 * label is preserved so the empty bucket is still visible on the axis. Pie
 * slices with a null/zero value are dropped (a zero-area slice is noise).
 */
export interface GroupedSeries {
  categories: string[]
  values: number[]
  pie: { id: string; label: string; value: number }[]
}

/**
 * Map a `{status:'grouped'}` widget result's buckets to the @mui/x-charts data
 * shape. Pure + side-effect free so it is unit-testable without React/charts.
 */
export function groupedToSeries(groups: readonly WidgetGroup[]): GroupedSeries {
  const categories: string[] = []
  const values: number[] = []
  const pie: { id: string; label: string; value: number }[] = []

  groups.forEach((g, i) => {
    const label = g.label || '—'
    const numeric = typeof g.value === 'number' && Number.isFinite(g.value) ? g.value : 0
    categories.push(label)
    values.push(numeric)
    if (numeric !== 0) {
      pie.push({ id: g.key ?? `__null_${i}`, label, value: numeric })
    }
  })

  return { categories, values, pie }
}
