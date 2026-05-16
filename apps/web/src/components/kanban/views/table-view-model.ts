import type { BoardColumnRow, BoardData, BoardTaskData } from '../types'

export const DEFAULT_VISIBLE_SPRINT_STATUSES = ['ACTIVE', 'PLANNED'] as const
const TABLE_SPRINT_STATUS_OPTIONS = ['ACTIVE', 'PLANNED', 'COMPLETED'] as const

export function getTableSprintStatusOptions(): string[] {
  return [...TABLE_SPRINT_STATUS_OPTIONS]
}

export function visibleSprints(
  sprints: BoardData['sprints'],
  selectedStatuses: readonly string[],
): BoardData['sprints'] {
  const selected = new Set(selectedStatuses)
  return sprints.filter((sprint) => selected.has(sprint.status))
}

export function isTerminalTask(task: BoardTaskData, columns: BoardColumnRow[]): boolean {
  const column = columns.find((candidate) => candidate.id === task.columnId)
  return column?.kind === 'DONE' || column?.kind === 'CANCELLED'
}

export function getTableSprintTasks(
  tasks: BoardTaskData[],
  sprint: BoardData['sprints'][number],
): BoardTaskData[] {
  return tasks.filter((task) => task.sprintId === sprint.id)
}

export function getTableBacklogTasks(
  tasks: BoardTaskData[],
  columns: BoardColumnRow[],
): BoardTaskData[] {
  return tasks.filter((task) => !task.sprintId && !isTerminalTask(task, columns))
}
