// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BoardData } from '@/components/kanban/types'

const board: BoardData = {
  columns: [
    {
      id: 'c1',
      pageId: 'p1',
      title: 'To do',
      kind: 'ACTIVE',
      position: 1,
      color: null,
    },
  ],
  types: [],
  priorities: [],
  labels: [],
  sprints: [],
  tasks: [],
  members: [],
  currentUserId: 'u1',
  workspaceId: 'w1',
}

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

// The kanban tree (toolbar, settings dialog, filters) touches many tRPC
// procedures at render. Auto-stub every node so the component renders without
// us enumerating each one; only `kanban.board.getBoard.useQuery` returns the
// seeded board. Each access yields a callable proxy that is also indexable,
// so `trpc.x.y.useMutation()`, `utils.a.b.invalidate()`, etc. all resolve.
const mutationStub = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }
const queryStub = (data: unknown) => () => ({ data, isLoading: false, error: null })

function makeNode(path: string): unknown {
  const fn = () => mutationStub
  return new Proxy(fn, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined
      const next = path ? `${path}.${prop}` : prop
      if (next === 'kanban.board.getBoard.useQuery') return queryStub(board)
      if (prop === 'useMutation') return () => mutationStub
      if (prop === 'useQuery') return queryStub(undefined)
      return makeNode(next)
    },
    apply() {
      // `useUtils()`, `invalidate()`, `setData()`, `mutate()` … no-op callables.
      return makeNode(path)
    },
  })
}

vi.mock('@/trpc/client', () => ({ trpc: makeNode('') }))
vi.mock('@/components/kanban/realtime/use-kanban-events', () => ({ useKanbanEvents: vi.fn() }))

import { KanbanBoardPage } from '@/components/kanban/kanban-board-page'

describe('KanbanBoardPage editable gating', () => {
  afterEach(cleanup)

  it('hides the add-column affordance when not editable', () => {
    render(<KanbanBoardPage pageId="p1" editable={false} />)
    expect(screen.queryByRole('button', { name: /колонк/i })).not.toBeInTheDocument()
  })

  it('shows the add-column affordance when editable', () => {
    render(<KanbanBoardPage pageId="p1" editable />)
    expect(screen.getByRole('button', { name: /колонк/i })).toBeInTheDocument()
  })
})
