import { assigneeFilterIds } from '../lib/assignees'
import { toDate } from '../lib/dates'
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

function inDateRange(d: Date | null, from: Date | null, to: Date | null): boolean {
  if (from && (!d || d < from)) return false
  if (to && (!d || d > to)) return false
  return true
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
  const from = toDate(filters.dateFrom)
  const to = toDate(filters.dateTo)
  const afrom = toDate(filters.actualFrom)
  const ato = toDate(filters.actualTo)

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

    const due = toDate(task.dueDate)
    if (filters.overdueOnly) {
      if (!due || due >= now || terminalColumnIds.has(task.columnId)) return false
    }
    if (!inDateRange(due, from, to)) return false
    if (!inDateRange(toDate(task.actualDate), afrom, ato)) return false

    return true
  })

  if (filters.sortBy === 'manual') return filtered

  const dir = filters.sortDir === 'desc' ? -1 : 1
  const keyOf = (t: BoardTaskData): number | null => {
    if (filters.sortBy === 'planned') return toDate(t.dueDate)?.getTime() ?? null
    if (filters.sortBy === 'actual') return toDate(t.actualDate)?.getTime() ?? null
    return computeDeviation(toDate(t.dueDate), toDate(t.actualDate))?.days ?? null
  }

  // Decorate-sort-undecorate: compute each key once instead of per comparison.
  return filtered
    .map((task) => ({ task, key: keyOf(task) }))
    .sort((a, b) => {
      if (a.key === null && b.key === null) return 0
      if (a.key === null) return 1 // empties always last
      if (b.key === null) return -1
      return (a.key - b.key) * dir
    })
    .map((entry) => entry.task)
}
