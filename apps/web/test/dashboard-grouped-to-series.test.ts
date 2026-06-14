import { describe, expect, it } from 'vitest'

import { MAX_WIDGET_ROWS } from '@repo/domain'

import { groupedToSeries } from '@/components/dashboard/widgets/grouped-to-series'
import { WIDGET_ROW_CAP } from '@/components/dashboard/widget-data-states'
import type { WidgetGroup } from '@repo/domain'

describe('widget row cap', () => {
  it('the client-inlined cap mirrors the domain MAX_WIDGET_ROWS (drift guard)', () => {
    // widget-data-states.tsx inlines the cap to stay client-safe (importing the
    // value would drag @repo/db/pg into the client bundle). This pins them equal.
    expect(WIDGET_ROW_CAP).toBe(MAX_WIDGET_ROWS)
  })
})

describe('groupedToSeries', () => {
  it('maps labels to categories and numeric values index-for-index', () => {
    const groups: WidgetGroup[] = [
      { key: 'a', label: 'Готово', value: 5 },
      { key: 'b', label: 'В работе', value: 2 },
    ]
    const out = groupedToSeries(groups)
    expect(out.categories).toEqual(['Готово', 'В работе'])
    expect(out.values).toEqual([5, 2])
    expect(out.pie).toEqual([
      { id: 'a', label: 'Готово', value: 5 },
      { id: 'b', label: 'В работе', value: 2 },
    ])
  })

  it('coerces a null value to 0 for the bar/line axis but keeps the label', () => {
    const groups: WidgetGroup[] = [{ key: 'a', label: 'Пусто', value: null }]
    const out = groupedToSeries(groups)
    expect(out.categories).toEqual(['Пусто'])
    expect(out.values).toEqual([0])
  })

  it('drops null/zero-value slices from the pie projection', () => {
    const groups: WidgetGroup[] = [
      { key: 'a', label: 'Есть', value: 3 },
      { key: 'b', label: 'Ноль', value: 0 },
      { key: 'c', label: 'Нет', value: null },
    ]
    const out = groupedToSeries(groups)
    expect(out.pie).toEqual([{ id: 'a', label: 'Есть', value: 3 }])
    // …but the bar/line axis still shows all three buckets.
    expect(out.categories).toEqual(['Есть', 'Ноль', 'Нет'])
    expect(out.values).toEqual([3, 0, 0])
  })

  it('falls back to «—» for an empty label and synthesizes a slice id for a null key', () => {
    const groups: WidgetGroup[] = [{ key: null, label: '', value: 4 }]
    const out = groupedToSeries(groups)
    expect(out.categories).toEqual(['—'])
    expect(out.pie).toEqual([{ id: '__null_0', label: '—', value: 4 }])
  })

  it('coerces a non-finite value (NaN/Infinity) to 0', () => {
    const groups: WidgetGroup[] = [
      { key: 'a', label: 'NaN', value: Number.NaN },
      { key: 'b', label: 'Inf', value: Number.POSITIVE_INFINITY },
    ]
    const out = groupedToSeries(groups)
    expect(out.values).toEqual([0, 0])
    expect(out.pie).toEqual([])
  })
})
