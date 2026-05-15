'use client'

import { useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import type { KanbanFilters } from './filters/apply-filters'
import { EMPTY_FILTERS } from './filters/apply-filters'

export type KanbanView = 'board' | 'table' | 'gantt'

function parseCsv(value: string | null): string[] {
  if (!value) return []
  return value.split(',').filter(Boolean)
}

export function useKanbanFilters() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const view: KanbanView = useMemo(() => {
    const v = searchParams?.get('view')
    if (v === 'table') return 'table'
    if (v === 'gantt') return 'gantt'
    return 'board'
  }, [searchParams])

  const filters: KanbanFilters = useMemo(() => {
    const sprintParam = searchParams?.get('sprint') ?? null
    let sprint: KanbanFilters['sprint'] = 'all'
    if (sprintParam === 'current') sprint = 'current'
    else if (sprintParam && sprintParam !== 'all') sprint = parseCsv(sprintParam)

    return {
      ...EMPTY_FILTERS,
      sprint,
      userIds: parseCsv(searchParams?.get('users') ?? null),
      labelIds: parseCsv(searchParams?.get('labels') ?? null),
      dateFrom: searchParams?.get('from') ?? null,
      dateTo: searchParams?.get('to') ?? null,
      overdueOnly: searchParams?.get('overdue') === '1',
      hideTerminalColumns: view === 'table',
    }
  }, [searchParams, view])

  const updateParams = useCallback(
    (mutations: Record<string, string | null>) => {
      const current = new URLSearchParams(searchParams?.toString() ?? '')
      for (const [key, value] of Object.entries(mutations)) {
        if (value === null || value === '') current.delete(key)
        else current.set(key, value)
      }
      const qs = current.toString()
      router.replace(qs ? `?${qs}` : globalThis.location.pathname)
    },
    [searchParams, router],
  )

  const setView = useCallback(
    (next: KanbanView) => updateParams({ view: next === 'board' ? null : next }),
    [updateParams],
  )

  const setSprintFilter = useCallback(
    (next: KanbanFilters['sprint']) => {
      let value: string | null
      if (next === 'all') value = null
      else if (Array.isArray(next)) value = next.join(',')
      else value = next
      updateParams({ sprint: value })
    },
    [updateParams],
  )

  const setUserFilter = useCallback(
    (next: string[]) => updateParams({ users: next.length === 0 ? null : next.join(',') }),
    [updateParams],
  )

  const setLabelFilter = useCallback(
    (next: string[]) => updateParams({ labels: next.length === 0 ? null : next.join(',') }),
    [updateParams],
  )

  const setDateFilter = useCallback(
    (next: { from: string | null; to: string | null; overdue: boolean }) =>
      updateParams({
        from: next.from,
        to: next.to,
        overdue: next.overdue ? '1' : null,
      }),
    [updateParams],
  )

  return {
    view,
    setView,
    filters,
    setSprintFilter,
    setUserFilter,
    setLabelFilter,
    setDateFilter,
  }
}
