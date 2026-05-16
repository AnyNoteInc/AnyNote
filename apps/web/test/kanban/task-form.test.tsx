// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TaskForm } from '@/components/kanban/task/task-form'
import type { BoardData, BoardTaskData } from '@/components/kanban/types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@repo/editor', () => ({
  AnyNotePlainEditor: () => <div data-testid="plain-editor" />,
}))

vi.mock('@/components/kanban/task/task-attachments', () => ({
  TaskAttachments: () => <div data-testid="task-attachments" />,
}))

const { mutation } = vi.hoisted(() => ({
  mutation: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      kanban: {
        board: {
          getBoard: {
            invalidate: vi.fn(),
          },
        },
      },
    }),
    kanban: {
      task: {
        update: { useMutation: mutation },
        setAssignees: { useMutation: mutation },
        setLabels: { useMutation: mutation },
      },
      type: {
        create: { useMutation: mutation },
        delete: { useMutation: mutation },
      },
      priority: {
        create: { useMutation: mutation },
        delete: { useMutation: mutation },
      },
      label: {
        create: { useMutation: mutation },
        delete: { useMutation: mutation },
      },
    },
  },
}))

const PAGE_ID = '00000000-0000-0000-0000-0000000000p1'
const CURRENT_USER_ID = '00000000-0000-0000-0000-0000000000u1'
const COLUMN_ID = '00000000-0000-0000-0000-0000000000c1'

function task(id: string, title: string, overrides: Partial<BoardTaskData> = {}): BoardTaskData {
  return {
    id,
    pageId: PAGE_ID,
    columnId: COLUMN_ID,
    typeId: null,
    priorityId: null,
    sprintId: null,
    parentId: null,
    title,
    description: null,
    startDate: null,
    dueDate: null,
    position: 1,
    sprintPosition: null,
    archived: false,
    deletedAt: null,
    createdById: CURRENT_USER_ID,
    assignees: [],
    labels: [],
    ...overrides,
  }
}

function board(tasks: BoardTaskData[], overrides: Partial<BoardData> = {}): BoardData {
  return {
    columns: [
      { id: COLUMN_ID, pageId: PAGE_ID, title: 'Todo', kind: 'ACTIVE', position: 1, color: null },
    ],
    types: [],
    priorities: [],
    labels: [],
    sprints: [],
    tasks,
    members: [],
    currentUserId: CURRENT_USER_ID,
    workspaceId: 'workspace-1',
    ...overrides,
  }
}

describe('TaskForm', () => {
  afterEach(() => cleanup())

  it('filters parent task candidates by title inside the parent picker', async () => {
    const actor = userEvent.setup()
    const current = task('task-current', 'Current task')
    const alpha = task('task-alpha', 'Alpha parent')
    const beta = task('task-beta', 'Beta rollout parent')

    render(
      <TaskForm
        pageId={PAGE_ID}
        task={current}
        board={board([current, alpha, beta])}
        currentUserId={CURRENT_USER_ID}
      />,
    )

    await actor.click(screen.getByRole('button', { name: 'Родительская задача' }))
    const picker = screen.getByRole('presentation')

    await actor.type(within(picker).getByLabelText('Поиск по названию задачи'), 'rollout')

    expect(within(picker).getByText('Beta rollout parent')).toBeInTheDocument()
    expect(within(picker).queryByText('Alpha parent')).not.toBeInTheDocument()
    expect(within(picker).queryByText('Current task')).not.toBeInTheDocument()
  })

  it('does not show delete buttons in type and priority pickers', async () => {
    const actor = userEvent.setup()
    const current = task('task-current', 'Current task')
    const boardData = board([current], {
      types: [{ id: 'type-1', title: 'Баг', position: 1 }],
      priorities: [{ id: 'priority-1', title: 'Высокий', position: 1, color: '#F97316' }],
    })

    render(
      <TaskForm
        pageId={PAGE_ID}
        task={current}
        board={boardData}
        currentUserId={CURRENT_USER_ID}
      />,
    )

    await actor.click(screen.getByRole('button', { name: 'Тип' }))
    expect(within(screen.getByRole('presentation')).queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()

    cleanup()
    render(
      <TaskForm
        pageId={PAGE_ID}
        task={current}
        board={boardData}
        currentUserId={CURRENT_USER_ID}
      />,
    )

    await actor.click(screen.getByRole('button', { name: 'Срочность' }))
    expect(within(screen.getByRole('presentation')).queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
  })
})
