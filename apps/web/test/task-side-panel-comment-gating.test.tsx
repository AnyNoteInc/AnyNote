// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BoardData } from '@/components/kanban/types'

const board: BoardData = {
  columns: [],
  types: [],
  priorities: [],
  labels: [],
  sprints: [],
  tasks: [],
  members: [],
  participants: [],
  currentUserId: 'u1',
  workspaceId: 'w1',
}

// Auto-stub the tRPC tree so TaskSidePanel renders without enumerating every
// procedure. `comment.list` / `board.getActivity` return empty feeds.
const mutationStub = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }
const queryStub = (data: unknown) => () => ({ data, isLoading: false, error: null })

function makeNode(path: string): unknown {
  const fn = () => mutationStub
  return new Proxy(fn, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined
      const next = path ? `${path}.${prop}` : prop
      if (prop === 'useMutation') return () => mutationStub
      if (prop === 'useQuery') return queryStub([])
      return makeNode(next)
    },
    apply() {
      return makeNode(path)
    },
  })
}

vi.mock('@/trpc/client', () => ({ trpc: makeNode('') }))

import { TaskSidePanel } from '@/components/kanban/task/task-side-panel'

describe('TaskSidePanel comment composer gating', () => {
  afterEach(cleanup)

  it('hides the comment composer when canComment is false', () => {
    render(
      <TaskSidePanel
        pageId="p1"
        taskId="t1"
        currentUserId="u1"
        board={board}
        canComment={false}
      />,
    )
    expect(screen.queryByRole('button', { name: /отправить/i })).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/напишите комментарий/i)).not.toBeInTheDocument()
    // The feed/history region still renders.
    expect(screen.getByText(/комментариев, ни событий/i)).toBeInTheDocument()
  })

  it('shows the comment composer when canComment is true', () => {
    render(
      <TaskSidePanel pageId="p1" taskId="t1" currentUserId="u1" board={board} canComment />,
    )
    expect(screen.getByRole('button', { name: /отправить/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/напишите комментарий/i)).toBeInTheDocument()
  })

  it('shows the comment composer by default (no canComment prop)', () => {
    render(<TaskSidePanel pageId="p1" taskId="t1" currentUserId="u1" board={board} />)
    expect(screen.getByRole('button', { name: /отправить/i })).toBeInTheDocument()
  })
})
