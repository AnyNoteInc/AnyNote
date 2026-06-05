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

/** Children of a given task, or an empty array when it has none. */
export function getChildren(map: Map<string, BoardTaskData[]>, taskId: string): BoardTaskData[] {
  return map.get(taskId) ?? []
}

export interface SubtaskProgress {
  readonly total: number
  readonly done: number
  readonly ratio: number
}

/** Progress over a task's children: done = child column kind is DONE. */
export function subtaskProgress(
  children: BoardTaskData[],
  columns: BoardColumnRow[],
): SubtaskProgress {
  const kindByColumn = new Map(columns.map((c) => [c.id, c.kind]))
  const total = children.length
  const done = children.filter((c) => kindByColumn.get(c.columnId) === 'DONE').length
  return { total, done, ratio: total === 0 ? 0 : done / total }
}
