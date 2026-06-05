import { describe, expect, it } from 'vitest'

import {
  getBoardCardModel,
  getDateTone,
  getPriorityTone,
} from '@/components/kanban/views/board-card-model'
import type { BoardData, BoardTaskData } from '@/components/kanban/types'

function task(overrides: Partial<BoardTaskData> = {}): BoardTaskData {
  return {
    id: 'task-1',
    pageId: 'page-1',
    columnId: 'column-1',
    typeId: null,
    priorityId: null,
    sprintId: null,
    parentId: null,
    title: 'Импортировать задачи из CSV',
    description: null,
    startDate: null,
    dueDate: null,
    position: 1,
    sprintPosition: null,
    archived: false,
    deletedAt: null,
    createdById: 'user-1',
    assignees: [],
    labels: [],
    ...overrides,
  }
}

const board: BoardData = {
  columns: [],
  types: [
    { id: 'type-bug', title: 'Bug', position: 1024 },
    { id: 'type-task', title: 'Task', position: 2048 },
  ],
  priorities: [
    { id: 'priority-low', title: 'Низкий', position: 1024, color: '#6B7280' },
    { id: 'priority-medium', title: 'Средний', position: 2048, color: '#3B82F6' },
    { id: 'priority-high', title: 'Высокий', position: 3072, color: '#F97316' },
    { id: 'priority-critical', title: 'Критичный', position: 4096, color: '#EF4444' },
  ],
  labels: [],
  sprints: [],
  tasks: [],
  members: [],
  participants: [],
  currentUserId: 'user-1',
  workspaceId: 'workspace-1',
}

describe('board-card model', () => {
  it('resolves type and priority metadata for the compact card header', () => {
    const model = getBoardCardModel(
      task({ typeId: 'type-bug', priorityId: 'priority-high' }),
      board,
      new Date('2026-05-16T12:00:00'),
    )

    expect(model.type?.title).toBe('Bug')
    expect(model.priority?.title).toBe('Высокий')
    expect(model.priorityTone).toBe('high')
    expect(model.priorityColor).toBe('#F97316')
  })

  it('shows up to two labels and returns the hidden label count', () => {
    const model = getBoardCardModel(
      task({
        labels: [
          { labelId: 'l1', label: { id: 'l1', name: 'backend', color: '#2563eb', position: 1 } },
          { labelId: 'l2', label: { id: 'l2', name: 'import', color: '#16a34a', position: 2 } },
          { labelId: 'l3', label: { id: 'l3', name: 'customer', color: '#dc2626', position: 3 } },
        ],
      }),
      board,
      new Date('2026-05-16T12:00:00'),
    )

    expect(model.visibleLabels.map((item) => item.label.name)).toEqual(['backend', 'import'])
    expect(model.hiddenLabelCount).toBe(1)
  })

  it('formats start and due dates as a compact range', () => {
    const model = getBoardCardModel(
      task({ startDate: '2026-05-10T00:00:00', dueDate: '2026-05-16T00:00:00' }),
      board,
      new Date('2026-05-16T12:00:00'),
    )

    expect(model.dateLabel).toBe('10 мая - 16 мая')
    expect(model.dateTone).toBe('soon')
  })

  it('marks overdue and distant due dates with different tones', () => {
    const now = new Date('2026-05-16T12:00:00')

    expect(getDateTone(new Date('2026-05-15T00:00:00'), now)).toBe('overdue')
    expect(getDateTone(new Date('2026-05-20T00:00:00'), now)).toBe('soon')
    expect(getDateTone(new Date('2026-06-20T00:00:00'), now)).toBe('default')
  })

  it('derives priority tone from relative priority order', () => {
    expect(getPriorityTone(board.priorities[0]!, board.priorities)).toBe('low')
    expect(getPriorityTone(board.priorities[1]!, board.priorities)).toBe('medium')
    expect(getPriorityTone(board.priorities[2]!, board.priorities)).toBe('high')
    expect(getPriorityTone(board.priorities[3]!, board.priorities)).toBe('critical')
  })
})

describe('board-card model — childCount', () => {
  it('counts tasks whose parentId equals this task id', () => {
    const parentTask = task({ id: 'parent-1' })
    const child1 = task({ id: 'child-1', parentId: 'parent-1' })
    const child2 = task({ id: 'child-2', parentId: 'parent-1' })
    const unrelated = task({ id: 'other-1', parentId: null })

    const boardWithChildren: BoardData = {
      ...board,
      tasks: [parentTask, child1, child2, unrelated],
    }

    expect(getBoardCardModel(parentTask, boardWithChildren).childCount).toBe(2)
  })

  it('returns 0 for a task referenced by no other task parentId', () => {
    const leaf = task({ id: 'leaf-1' })
    const boardWithLeaf: BoardData = {
      ...board,
      tasks: [leaf, task({ id: 'other-2', parentId: null })],
    }

    expect(getBoardCardModel(leaf, boardWithLeaf).childCount).toBe(0)
  })
})
