import { assigneeFilterIds } from '../lib/assignees'
import type { BoardData, BoardTaskData } from '../types'
import { computeDeviation } from '../views/deviation'

export interface KanbanFilters {
  sprint: 'all' | 'current' | string[]
  userIds: string[]
  labelIds: string[]
  dateFrom: string | null
  dateTo: string | null
  actualFrom: string | null
  actualTo: string | null
  overdueOnly: boolean
  hideTerminalColumns: boolean
  sortBy: 'manual' | 'planned' | 'actual' | 'deviation'
  sortDir: 'asc' | 'desc'
}

export const EMPTY_FILTERS: KanbanFilters = {
  sprint: 'all',
  userIds: [],
  labelIds: [],
  dateFrom: null,
  dateTo: null,
  actualFrom: null,
  actualTo: null,
  overdueOnly: false,
  hideTerminalColumns: false,
  sortBy: 'manual',
  sortDir: 'asc',
}

interface ApplyContext {
  columns: BoardData['columns']
  sprints: BoardData['sprints']
  now?: Date
}

function intersects<T>(a: T[], b: T[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  const setA = new Set(a)
  for (const v of b) if (setA.has(v)) return true
  return false
}

function dateOf(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  return new Date(value)
}

export function applyFilters(
  tasks: BoardTaskData[],
  filters: KanbanFilters,
  ctx: ApplyContext,
): BoardTaskData[] {
  const activeSprintId = ctx.sprints.find((s) => s.status === 'ACTIVE')?.id ?? null
  const terminalColumnIds = new Set(
    ctx.columns.filter((c) => c.kind === 'DONE' || c.kind === 'CANCELLED').map((c) => c.id),
  )
  const now = ctx.now ?? new Date()
  const from = filters.dateFrom ? new Date(filters.dateFrom) : null
  const to = filters.dateTo ? new Date(filters.dateTo) : null
  const afrom = filters.actualFrom ? new Date(filters.actualFrom) : null
  const ato = filters.actualTo ? new Date(filters.actualTo) : null

  const filtered = tasks.filter((task) => {
    if (filters.hideTerminalColumns && terminalColumnIds.has(task.columnId)) return false

    if (filters.sprint !== 'all') {
      if (filters.sprint === 'current') {
        if (task.sprintId !== activeSprintId) return false
      } else {
        const allowed = new Set(filters.sprint)
        const taskKey = task.sprintId ?? 'backlog'
        if (!allowed.has(taskKey)) return false
      }
    }

    if (filters.userIds.length > 0) {
      if (!intersects(filters.userIds, assigneeFilterIds(task.assignees))) return false
    }

    if (filters.labelIds.length > 0) {
      const labelIds = task.labels.map((l) => l.labelId)
      if (!intersects(filters.labelIds, labelIds)) return false
    }

    const due = dateOf(task.dueDate)
    if (filters.overdueOnly) {
      if (!due || due >= now || terminalColumnIds.has(task.columnId)) return false
    }
    if (from && (!due || due < from)) return false
    if (to && (!due || due > to)) return false

    const actual = dateOf(task.actualDate)
    if (afrom && (!actual || actual < afrom)) return false
    if (ato && (!actual || actual > ato)) return false

    return true
  })

  if (filters.sortBy === 'manual') return filtered

  const dir = filters.sortDir === 'desc' ? -1 : 1
  const keyOf = (t: BoardTaskData): number | null => {
    if (filters.sortBy === 'planned') {
      const d = dateOf(t.dueDate)
      return d ? d.getTime() : null
    }
    if (filters.sortBy === 'actual') {
      const d = dateOf(t.actualDate)
      return d ? d.getTime() : null
    }
    // deviation
    const dev = computeDeviation(dateOf(t.dueDate), dateOf(t.actualDate))
    return dev ? dev.days : null
  }

  return [...filtered].sort((a, b) => {
    const ka = keyOf(a)
    const kb = keyOf(b)
    if (ka === null && kb === null) return 0
    if (ka === null) return 1 // empties always last
    if (kb === null) return -1
    return (ka - kb) * dir
  })
}
