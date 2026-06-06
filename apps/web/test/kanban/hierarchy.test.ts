import { describe, it, expect } from 'vitest'

import {
  buildChildCountMap,
  buildChildrenMap,
  subtaskProgress,
} from '@/components/kanban/lib/hierarchy'
import type { BoardColumnRow, BoardTaskData } from '@/components/kanban/types'

function task(id: string, parentId: string | null, columnId: string): BoardTaskData {
  return {
    id,
    pageId: 'p1',
    columnId,
    typeId: null,
    priorityId: null,
    sprintId: null,
    parentId,
    title: id,
    description: null,
    startDate: null,
    dueDate: null,
    actualDate: null,
    position: 0,
    sprintPosition: null,
    archived: false,
    deletedAt: null,
    createdById: 'u1',
    assignees: [],
    labels: [],
  }
}

function column(id: string, kind: BoardColumnRow['kind']): BoardColumnRow {
  return { id, pageId: 'p1', title: id, kind, position: 0, color: null }
}

describe('buildChildrenMap', () => {
  it('groups tasks by parentId and ignores top-level tasks', () => {
    const tasks = [task('a', null, 'c1'), task('b', 'a', 'c1'), task('c', 'a', 'c1')]
    const map = buildChildrenMap(tasks)
    expect(map.get('a')?.map((t) => t.id)).toEqual(['b', 'c'])
    expect(map.has('b')).toBe(false)
  })
})

describe('buildChildCountMap', () => {
  it('counts direct children per parent id and ignores top-level tasks', () => {
    const tasks = [
      task('a', null, 'c1'),
      task('b', 'a', 'c1'),
      task('c', 'a', 'c1'),
      task('d', null, 'c1'),
    ]
    const counts = buildChildCountMap(tasks)
    expect(counts.get('a')).toBe(2)
    expect(counts.has('d')).toBe(false)
    expect(counts.has('b')).toBe(false)
  })
})

describe('subtaskProgress', () => {
  const columnById = new Map(
    [column('active', 'ACTIVE'), column('done', 'DONE'), column('cx', 'CANCELLED')].map((c) => [
      c.id,
      c,
    ]),
  )

  it('counts only DONE children as done, with total including all', () => {
    const children = [task('b', 'a', 'active'), task('c', 'a', 'done'), task('d', 'a', 'cx')]
    expect(subtaskProgress(children, columnById)).toEqual({ total: 3, done: 1, ratio: 1 / 3 })
  })

  it('returns ratio 1 when all children are done', () => {
    const children = [task('b', 'a', 'done'), task('c', 'a', 'done')]
    expect(subtaskProgress(children, columnById)).toEqual({ total: 2, done: 2, ratio: 1 })
  })

  it('returns zeroes for no children', () => {
    expect(subtaskProgress([], columnById)).toEqual({ total: 0, done: 0, ratio: 0 })
  })
})
