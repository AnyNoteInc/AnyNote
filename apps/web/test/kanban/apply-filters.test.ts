import { describe, expect, it } from 'vitest'

import {
  applyFilters,
  EMPTY_FILTERS,
  type KanbanFilters,
} from '@/components/kanban/filters/apply-filters'
import type { BoardData, BoardTaskData } from '@/components/kanban/types'

const COL_TODO = '00000000-0000-0000-0000-0000000000c1'
const COL_DONE = '00000000-0000-0000-0000-0000000000c2'
const SPRINT_ACTIVE = '00000000-0000-0000-0000-0000000000a1'
const SPRINT_OLD = '00000000-0000-0000-0000-0000000000a2'

const columns: BoardData['columns'] = [
  { id: COL_TODO, pageId: 'p', title: 'Todo', kind: 'ACTIVE', position: 1, color: null },
  { id: COL_DONE, pageId: 'p', title: 'Done', kind: 'DONE', position: 2, color: null },
]
const sprints: BoardData['sprints'] = [
  { id: SPRINT_ACTIVE, name: 'Current', status: 'ACTIVE', position: 1 },
  { id: SPRINT_OLD, name: 'Old', status: 'COMPLETED', position: 2 },
]

function task(id: string, overrides: Partial<BoardTaskData> = {}): BoardTaskData {
  return {
    id,
    pageId: 'p',
    columnId: COL_TODO,
    typeId: null,
    priorityId: null,
    sprintId: null,
    parentId: null,
    title: id,
    description: null,
    startDate: null,
    dueDate: null,
    position: 1,
    archived: false,
    deletedAt: null,
    createdById: 'u',
    assignees: [],
    labels: [],
    ...overrides,
  }
}

describe('applyFilters', () => {
  it('returns all tasks when filters are empty', () => {
    const tasks = [task('a'), task('b', { sprintId: SPRINT_ACTIVE })]
    const result = applyFilters(tasks, EMPTY_FILTERS, { columns, sprints })
    expect(result).toHaveLength(2)
  })

  it('hides terminal-column tasks when hideTerminalColumns is true', () => {
    const tasks = [task('a'), task('b', { columnId: COL_DONE })]
    const result = applyFilters(
      tasks,
      { ...EMPTY_FILTERS, hideTerminalColumns: true },
      { columns, sprints },
    )
    expect(result.map((t) => t.id)).toEqual(['a'])
  })

  it('sprint=current keeps only tasks with active sprint', () => {
    const tasks = [task('a', { sprintId: SPRINT_ACTIVE }), task('b', { sprintId: SPRINT_OLD }), task('c')]
    const result = applyFilters(
      tasks,
      { ...EMPTY_FILTERS, sprint: 'current' },
      { columns, sprints },
    )
    expect(result.map((t) => t.id)).toEqual(['a'])
  })

  it('sprint array filters by specific ids and supports backlog key', () => {
    const tasks = [
      task('a', { sprintId: SPRINT_OLD }),
      task('b', { sprintId: SPRINT_ACTIVE }),
      task('c'),
    ]
    const result = applyFilters(
      tasks,
      { ...EMPTY_FILTERS, sprint: [SPRINT_OLD, 'backlog'] },
      { columns, sprints },
    )
    expect(result.map((t) => t.id).sort()).toEqual(['a', 'c'])
  })

  it('userIds filter requires task assignee intersect', () => {
    const u1 = '11111111-1111-1111-1111-111111111111'
    const u2 = '22222222-2222-2222-2222-222222222222'
    const tasks = [
      task('a', { assignees: [{ userId: u1, user: { id: u1, firstName: null, lastName: null, email: '' } }] }),
      task('b', { assignees: [{ userId: u2, user: { id: u2, firstName: null, lastName: null, email: '' } }] }),
      task('c'),
    ]
    const filters: KanbanFilters = { ...EMPTY_FILTERS, userIds: [u1] }
    const result = applyFilters(tasks, filters, { columns, sprints })
    expect(result.map((t) => t.id)).toEqual(['a'])
  })

  it('overdueOnly keeps tasks where dueDate is in the past and column is active', () => {
    const now = new Date('2026-05-15')
    const tasks = [
      task('a', { dueDate: new Date('2026-05-10') }),                          // overdue, active
      task('b', { dueDate: new Date('2026-05-20') }),                          // future
      task('c', { dueDate: new Date('2026-05-10'), columnId: COL_DONE }),     // overdue but done
      task('d'),                                                                // no due
    ]
    const result = applyFilters(tasks, { ...EMPTY_FILTERS, overdueOnly: true }, { columns, sprints, now })
    expect(result.map((t) => t.id)).toEqual(['a'])
  })

  it('dateFrom/dateTo bounds dueDate', () => {
    const tasks = [
      task('a', { dueDate: new Date('2026-05-10') }),
      task('b', { dueDate: new Date('2026-05-15') }),
      task('c', { dueDate: new Date('2026-05-20') }),
    ]
    const result = applyFilters(
      tasks,
      { ...EMPTY_FILTERS, dateFrom: '2026-05-12', dateTo: '2026-05-18' },
      { columns, sprints },
    )
    expect(result.map((t) => t.id)).toEqual(['b'])
  })
})
