import { describe, it, expect } from 'vitest'

import { buildChildrenMap, getChildren, subtaskProgress } from '@/components/kanban/lib/hierarchy'
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

describe('getChildren', () => {
  it('returns children for a parent', () => {
    const tasks = [task('a', null, 'c1'), task('b', 'a', 'c1')]
    const map = buildChildrenMap(tasks)
    expect(getChildren(map, 'a').map((t) => t.id)).toEqual(['b'])
  })

  it('returns an empty array for a task with no children', () => {
    const map = buildChildrenMap([task('a', null, 'c1')])
    expect(getChildren(map, 'a')).toEqual([])
  })
})

describe('subtaskProgress', () => {
  const columns = [column('active', 'ACTIVE'), column('done', 'DONE'), column('cx', 'CANCELLED')]

  it('counts only DONE children as done, with total including all', () => {
    const children = [task('b', 'a', 'active'), task('c', 'a', 'done'), task('d', 'a', 'cx')]
    expect(subtaskProgress(children, columns)).toEqual({ total: 3, done: 1, ratio: 1 / 3 })
  })

  it('returns ratio 1 when all children are done', () => {
    const children = [task('b', 'a', 'done'), task('c', 'a', 'done')]
    expect(subtaskProgress(children, columns)).toEqual({ total: 2, done: 2, ratio: 1 })
  })

  it('returns zeroes for no children', () => {
    expect(subtaskProgress([], columns)).toEqual({ total: 0, done: 0, ratio: 0 })
  })
})
