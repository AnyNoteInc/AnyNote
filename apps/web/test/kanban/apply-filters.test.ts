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
  { id: SPRINT_ACTIVE, name: 'Current', status: 'ACTIVE', position: 1, description: null, startDate: null, endDate: null },
  { id: SPRINT_OLD, name: 'Old', status: 'COMPLETED', position: 2, description: null, startDate: null, endDate: null },
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
    actualDate: null,
    position: 1,
    sprintPosition: null,
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
    expect(result.map((t) => t.id).sort((a, b) => a.localeCompare(b))).toEqual(['a', 'c'])
  })

  it('userIds filter requires task assignee intersect', () => {
    const u1 = '11111111-1111-1111-1111-111111111111'
    const u2 = '22222222-2222-2222-2222-222222222222'
    const tasks = [
      task('a', {
        assignees: [
          {
            participantId: 'pa1',
            participant: {
              id: 'pa1',
              userId: u1,
              fullName: 'U1',
              company: null,
              user: { id: u1, firstName: null, lastName: null, email: '', image: null },
            },
          },
        ],
      }),
      task('b', {
        assignees: [
          {
            participantId: 'pb1',
            participant: {
              id: 'pb1',
              userId: u2,
              fullName: 'U2',
              company: null,
              user: { id: u2, firstName: null, lastName: null, email: '', image: null },
            },
          },
        ],
      }),
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

describe('actual-date filter', () => {
  it('keeps only tasks whose actualDate is within [actualFrom, actualTo]', () => {
    const tasks = [
      task('a', { actualDate: new Date('2025-06-05') }),
      task('b', { actualDate: new Date('2025-06-20') }),
      task('c', { actualDate: null }),
    ]
    const result = applyFilters(
      tasks,
      { ...EMPTY_FILTERS, actualFrom: '2025-06-01', actualTo: '2025-06-10' },
      { columns, sprints },
    )
    expect(result.map((t) => t.id)).toEqual(['a'])
  })
})

describe('sort', () => {
  it('sorts by deviation descending (most late first), empty deviations last', () => {
    const tasks = [
      task('ontime', { dueDate: new Date('2025-06-01'), actualDate: new Date('2025-06-01') }),
      task('late', { dueDate: new Date('2025-06-01'), actualDate: new Date('2025-06-05') }),
      task('none'),
    ]
    const result = applyFilters(
      tasks,
      { ...EMPTY_FILTERS, sortBy: 'deviation', sortDir: 'desc' },
      { columns, sprints },
    )
    expect(result.map((t) => t.id)).toEqual(['late', 'ontime', 'none'])
  })

  it('sorts by planned date ascending, empty dates last', () => {
    const tasks = [
      task('b', { dueDate: new Date('2025-06-10') }),
      task('a', { dueDate: new Date('2025-06-01') }),
      task('z'),
    ]
    const result = applyFilters(
      tasks,
      { ...EMPTY_FILTERS, sortBy: 'planned', sortDir: 'asc' },
      { columns, sprints },
    )
    expect(result.map((t) => t.id)).toEqual(['a', 'b', 'z'])
  })
})
