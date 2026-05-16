import { describe, expect, it } from 'vitest'

import {
  DEFAULT_VISIBLE_SPRINT_STATUSES,
  getTableBacklogTasks,
  getTableSprintTasks,
  getTableSprintStatusOptions,
  isTerminalTask,
  visibleSprints,
} from '@/components/kanban/views/table-view-model'
import type { BoardData, BoardTaskData } from '@/components/kanban/types'

const COL_TODO = '00000000-0000-0000-0000-0000000000c1'
const COL_DONE = '00000000-0000-0000-0000-0000000000c2'
const COL_CANCELLED = '00000000-0000-0000-0000-0000000000c3'
const SPRINT_ACTIVE = '00000000-0000-0000-0000-0000000000a1'
const SPRINT_PLANNED = '00000000-0000-0000-0000-0000000000a2'
const SPRINT_COMPLETED = '00000000-0000-0000-0000-0000000000a3'

const columns: BoardData['columns'] = [
  { id: COL_TODO, pageId: 'p', title: 'Todo', kind: 'ACTIVE', position: 1, color: null },
  { id: COL_DONE, pageId: 'p', title: 'Done', kind: 'DONE', position: 2, color: null },
  {
    id: COL_CANCELLED,
    pageId: 'p',
    title: 'Cancelled',
    kind: 'CANCELLED',
    position: 3,
    color: null,
  },
]

const sprints: BoardData['sprints'] = [
  {
    id: SPRINT_ACTIVE,
    name: 'Active',
    status: 'ACTIVE',
    position: 1,
    description: null,
    startDate: null,
    endDate: null,
  },
  {
    id: SPRINT_PLANNED,
    name: 'Planned',
    status: 'PLANNED',
    position: 2,
    description: null,
    startDate: null,
    endDate: null,
  },
  {
    id: SPRINT_COMPLETED,
    name: 'Completed',
    status: 'COMPLETED',
    position: 3,
    description: null,
    startDate: null,
    endDate: null,
  },
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
    sprintPosition: null,
    archived: false,
    deletedAt: null,
    createdById: 'u',
    assignees: [],
    labels: [],
    ...overrides,
  }
}

describe('table-view model', () => {
  it('shows only active and planned sprints by default', () => {
    expect(visibleSprints(sprints, DEFAULT_VISIBLE_SPRINT_STATUSES).map((s) => s.id)).toEqual([
      SPRINT_ACTIVE,
      SPRINT_PLANNED,
    ])
  })

  it('always offers active, planned and completed sprint status filters', () => {
    expect(getTableSprintStatusOptions()).toEqual(['ACTIVE', 'PLANNED', 'COMPLETED'])
  })

  it('keeps terminal tasks inside every sprint', () => {
    const tasks = [
      task('active-done', { sprintId: SPRINT_ACTIVE, columnId: COL_DONE }),
      task('active-open', { sprintId: SPRINT_ACTIVE, columnId: COL_TODO }),
      task('completed-done', { sprintId: SPRINT_COMPLETED, columnId: COL_DONE }),
      task('completed-cancelled', { sprintId: SPRINT_COMPLETED, columnId: COL_CANCELLED }),
      task('completed-open', { sprintId: SPRINT_COMPLETED, columnId: COL_TODO }),
    ]

    expect(getTableSprintTasks(tasks, sprints[0]!).map((t) => t.id)).toEqual([
      'active-done',
      'active-open',
    ])
    expect(getTableSprintTasks(tasks, sprints[2]!).map((t) => t.id)).toEqual([
      'completed-done',
      'completed-cancelled',
      'completed-open',
    ])
  })

  it('hides terminal backlog tasks', () => {
    const tasks = [
      task('backlog-open'),
      task('backlog-done', { columnId: COL_DONE }),
      task('completed-done', { sprintId: SPRINT_COMPLETED, columnId: COL_DONE }),
    ]

    expect(getTableBacklogTasks(tasks, columns).map((t) => t.id)).toEqual(['backlog-open'])
  })

  it('detects done and cancelled tasks as terminal', () => {
    expect(isTerminalTask(task('done', { columnId: COL_DONE }), columns)).toBe(true)
    expect(isTerminalTask(task('cancelled', { columnId: COL_CANCELLED }), columns)).toBe(true)
    expect(isTerminalTask(task('todo', { columnId: COL_TODO }), columns)).toBe(false)
  })
})
