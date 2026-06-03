// @vitest-environment jsdom
import { DragDropContext } from '@hello-pangea/dnd'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ComponentProps, type ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SprintSection } from '@/components/kanban/views/sprint-section'
import { SelectionProvider } from '@/components/kanban/selection/selection-context'
import type { BoardData, BoardTaskData } from '@/components/kanban/types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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
      sprint: {
        activate: {
          useMutation: () => ({
            isPending: false,
            mutate: vi.fn(),
          }),
        },
      },
    },
  },
}))

const PAGE_ID = '00000000-0000-0000-0000-0000000000p1'
const CURRENT_USER_ID = '00000000-0000-0000-0000-0000000000u1'
const OTHER_USER_ID = '00000000-0000-0000-0000-0000000000u2'
const COL_TODO = '00000000-0000-0000-0000-0000000000c1'
const COL_DONE = '00000000-0000-0000-0000-0000000000c2'
const SPRINT_ID = '00000000-0000-0000-0000-0000000000s1'

const columns: BoardData['columns'] = [
  { id: COL_TODO, pageId: PAGE_ID, title: 'Todo', kind: 'ACTIVE', position: 1, color: null },
  { id: COL_DONE, pageId: PAGE_ID, title: 'Done', kind: 'DONE', position: 2, color: null },
]

const members: BoardData['members'] = [
  {
    userId: CURRENT_USER_ID,
    role: 'OWNER',
    user: {
      id: CURRENT_USER_ID,
      firstName: 'Ivan',
      lastName: null,
      email: 'ivan@example.com',
      image: null,
    },
  },
  {
    userId: OTHER_USER_ID,
    role: 'EDITOR',
    user: {
      id: OTHER_USER_ID,
      firstName: 'Oleg',
      lastName: null,
      email: 'oleg@example.com',
      image: null,
    },
  },
]

function task(id: string, overrides: Partial<BoardTaskData> = {}): BoardTaskData {
  return {
    id,
    pageId: PAGE_ID,
    columnId: COL_TODO,
    typeId: null,
    priorityId: null,
    sprintId: SPRINT_ID,
    parentId: null,
    title: id,
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

function renderSprintSection(
  element: ReactElement,
  onDragEnd: ComponentProps<typeof DragDropContext>['onDragEnd'] = vi.fn(),
) {
  return render(
    <SelectionProvider>
      <DragDropContext onDragEnd={onDragEnd}>{element}</DragDropContext>
    </SelectionProvider>,
  )
}

describe('SprintSection', () => {
  afterEach(() => cleanup())

  it('opens sprint task row actions for assign to me, remove from sprint and delete', async () => {
    const actor = userEvent.setup()
    const onAssignTaskToMe = vi.fn()
    const onRemoveTaskFromSprint = vi.fn()
    const onDeleteTask = vi.fn()
    const rowTask = task('Sprint Task')

    renderSprintSection(
      <SprintSection
        kind="sprint"
        pageId={PAGE_ID}
        sprint={{
          id: SPRINT_ID,
          name: 'Sprint',
          status: 'ACTIVE',
          description: null,
          startDate: null,
          endDate: null,
        }}
        allSprints={[]}
        columns={columns}
        allTasks={[rowTask]}
        tasks={[rowTask]}
        members={members}
        currentUserId={CURRENT_USER_ID}
        droppableId={`sprint:${SPRINT_ID}`}
        onAssignTaskToMe={onAssignTaskToMe}
        onRemoveTaskFromSprint={onRemoveTaskFromSprint}
        onDeleteTask={onDeleteTask}
      />,
    )

    await actor.click(screen.getByLabelText('Действия с задачей'))

    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('Назначить на меня')).toBeInTheDocument()
    expect(within(menu).getByText('Удалить из спринта')).toBeInTheDocument()
    expect(within(menu).getByRole('separator')).toBeInTheDocument()

    await actor.click(within(menu).getByText('Удалить'))
    expect(onDeleteTask).toHaveBeenCalledWith(rowTask.id)
  })

  it('strikes through completed task titles inside active sprints', () => {
    const rowTask = task('Done Sprint Task', { columnId: COL_DONE })

    renderSprintSection(
      <SprintSection
        kind="sprint"
        pageId={PAGE_ID}
        sprint={{
          id: SPRINT_ID,
          name: 'Sprint',
          status: 'ACTIVE',
          description: null,
          startDate: null,
          endDate: null,
        }}
        allSprints={[]}
        columns={columns}
        allTasks={[rowTask]}
        tasks={[rowTask]}
        members={members}
        currentUserId={CURRENT_USER_ID}
        droppableId={`sprint:${SPRINT_ID}`}
      />,
    )

    expect(screen.getByText('Done Sprint Task')).toHaveStyle({ textDecoration: 'line-through' })
  })

  it('does not show assign to me when the current user is already assigned', async () => {
    const actor = userEvent.setup()
    const rowTask = task('Assigned Task', {
      assignees: [
        {
          participantId: 'pme',
          participant: {
            id: 'pme',
            userId: CURRENT_USER_ID,
            fullName: 'Me',
            company: null,
            user: members[0]!.user,
          },
        },
      ],
    })

    renderSprintSection(
      <SprintSection
        kind="sprint"
        pageId={PAGE_ID}
        sprint={{
          id: SPRINT_ID,
          name: 'Sprint',
          status: 'ACTIVE',
          description: null,
          startDate: null,
          endDate: null,
        }}
        allSprints={[]}
        columns={columns}
        allTasks={[rowTask]}
        tasks={[rowTask]}
        members={members}
        currentUserId={CURRENT_USER_ID}
        droppableId={`sprint:${SPRINT_ID}`}
        onAssignTaskToMe={vi.fn()}
        onRemoveTaskFromSprint={vi.fn()}
        onDeleteTask={vi.fn()}
      />,
    )

    await actor.click(screen.getByLabelText('Действия с задачей'))

    expect(screen.queryByText('Назначить на меня')).not.toBeInTheDocument()
  })

  it('shows a delete action menu for backlog tasks', async () => {
    const actor = userEvent.setup()
    const onDeleteTask = vi.fn()
    const rowTask = task('Backlog Task', { sprintId: null })

    renderSprintSection(
      <SprintSection
        kind="backlog"
        droppableId="backlog"
        tasks={[rowTask]}
        members={members}
        currentUserId={CURRENT_USER_ID}
        onDeleteTask={onDeleteTask}
      />,
    )

    await actor.click(screen.getByLabelText('Действия с задачей'))

    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('Удалить')).toBeInTheDocument()

    await actor.click(within(menu).getByText('Удалить'))
    expect(onDeleteTask).toHaveBeenCalledWith(rowTask.id)
  })

  it('starts backlog task creation from the backlog menu and focuses the draft row', async () => {
    const actor = userEvent.setup()
    const onCreateTaskCommit = vi.fn()
    const onCreateTaskCancel = vi.fn()

    function BacklogHarness() {
      const [open, setOpen] = useState(false)
      const [title, setTitle] = useState('')
      return (
        <SprintSection
          kind="backlog"
          droppableId="backlog"
          tasks={[]}
          members={members}
          currentUserId={CURRENT_USER_ID}
          onStartCreateTask={() => setOpen(true)}
          createTaskDraft={
            open
              ? {
                  title,
                  onTitleChange: setTitle,
                  onCommit: onCreateTaskCommit,
                  onCancel: onCreateTaskCancel,
                }
              : undefined
          }
        />
      )
    }

    renderSprintSection(<BacklogHarness />)

    await actor.click(screen.getByLabelText('Действия с беклогом'))

    await actor.click(screen.getByText('Создать задачу'))
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Название задачи' })).toHaveFocus(),
    )
  })

  it('starts backlog task creation from the sprint menu first action', async () => {
    const actor = userEvent.setup()
    const onStartCreateTask = vi.fn()

    renderSprintSection(
      <SprintSection
        kind="sprint"
        pageId={PAGE_ID}
        sprint={{
          id: SPRINT_ID,
          name: 'Sprint',
          status: 'ACTIVE',
          description: null,
          startDate: null,
          endDate: null,
        }}
        allSprints={[]}
        columns={columns}
        allTasks={[]}
        tasks={[]}
        members={members}
        currentUserId={CURRENT_USER_ID}
        droppableId={`sprint:${SPRINT_ID}`}
        onStartCreateTask={onStartCreateTask}
      />,
    )

    await actor.click(screen.getByLabelText('Действия со спринтом'))

    const items = screen.getAllByRole('menuitem')
    expect(items[0]).toHaveTextContent('Создать задачу')

    await actor.click(items[0]!)
    expect(onStartCreateTask).toHaveBeenCalled()
  })
})
