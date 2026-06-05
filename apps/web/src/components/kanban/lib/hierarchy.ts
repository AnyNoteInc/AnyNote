import type { BoardColumnRow, BoardTaskData } from '../types'

/** Group tasks by their parentId. Top-level tasks (parentId === null) are not keys. */
export function buildChildrenMap(tasks: BoardTaskData[]): Map<string, BoardTaskData[]> {
  const map = new Map<string, BoardTaskData[]>()
  for (const task of tasks) {
    if (task.parentId === null) continue
    const siblings = map.get(task.parentId)
    if (siblings) {
      siblings.push(task)
    } else {
      map.set(task.parentId, [task])
    }
  }
  return map
}

/** Count of direct children per task id (parent id → child count). Built in one pass. */
export function buildChildCountMap(tasks: BoardTaskData[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const task of tasks) {
    if (task.parentId === null) continue
    counts.set(task.parentId, (counts.get(task.parentId) ?? 0) + 1)
  }
  return counts
}

export interface SubtaskProgress {
  readonly total: number
  readonly done: number
  readonly ratio: number
}

/**
 * Progress over a task's children: done = child column kind is DONE.
 * Takes a prebuilt columnId→column map so callers that already have one
 * (e.g. the detail view) don't pay for a second pass over the columns.
 */
export function subtaskProgress(
  children: BoardTaskData[],
  columnById: Map<string, BoardColumnRow>,
): SubtaskProgress {
  const total = children.length
  const done = children.filter((c) => columnById.get(c.columnId)?.kind === 'DONE').length
  return { total, done, ratio: total === 0 ? 0 : done / total }
}
