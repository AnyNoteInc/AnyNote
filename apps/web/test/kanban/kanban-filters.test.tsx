// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { KanbanFiltersUI } from '@/components/kanban/kanban-filters'
import { EMPTY_FILTERS } from '@/components/kanban/filters/apply-filters'
import type { BoardData } from '@/components/kanban/types'
import type { useKanbanFilters } from '@/components/kanban/use-kanban-filters'

type FiltersBag = ReturnType<typeof useKanbanFilters>

const board: BoardData = {
  columns: [],
  types: [],
  priorities: [],
  labels: [],
  sprints: [
    {
      id: '00000000-0000-4000-8000-0000000000a1',
      name: 'Active Sprint',
      status: 'ACTIVE',
      position: 1,
      description: null,
      startDate: null,
      endDate: null,
    },
    {
      id: '00000000-0000-4000-8000-0000000000a2',
      name: 'Completed Sprint',
      status: 'COMPLETED',
      position: 2,
      description: null,
      startDate: null,
      endDate: null,
    },
  ],
  tasks: [],
  members: [],
  participants: [],
  currentUserId: '00000000-0000-0000-0000-0000000000u1',
  workspaceId: '00000000-0000-0000-0000-0000000000w1',
}

function createBag(overrides: Partial<FiltersBag['filters']> = {}): FiltersBag {
  return {
    view: 'board',
    setView: vi.fn(),
    filters: { ...EMPTY_FILTERS, ...overrides },
    setSprintFilter: vi.fn(),
    setUserFilter: vi.fn(),
    setLabelFilter: vi.fn(),
    setDateFilter: vi.fn(),
    setActualDateFilter: vi.fn(),
    setSort: vi.fn(),
  }
}

describe('KanbanFiltersUI', () => {
  afterEach(() => cleanup())

  it('hides completed sprints in the sprint menu until the toggle is enabled', async () => {
    const actor = userEvent.setup()
    render(<KanbanFiltersUI board={board} bag={createBag()} />)

    await actor.click(screen.getByText('Спринт: все'))

    expect(screen.getByText('Active Sprint')).toBeInTheDocument()
    expect(screen.queryByText('Completed Sprint')).not.toBeInTheDocument()

    await actor.click(screen.getByText('Показывать завершённые'))

    expect(screen.getByText('Completed Sprint')).toBeInTheDocument()
  })

  it('does not include the active sprint name in the current sprint filter label', () => {
    render(<KanbanFiltersUI board={board} bag={createBag({ sprint: 'current' })} />)

    expect(screen.getByText('Спринт: текущий')).toBeInTheDocument()
    expect(screen.queryByText('Спринт: текущий (Active Sprint)')).not.toBeInTheDocument()
  })

  it('does not show the dates filter in the main filter bar', () => {
    render(<KanbanFiltersUI board={board} bag={createBag()} />)

    expect(screen.queryByText(/^Сроки/)).not.toBeInTheDocument()
  })

  it('shows the dates and sort filter chips', () => {
    render(<KanbanFiltersUI board={board} bag={createBag()} />)

    expect(screen.getByText('Даты')).toBeInTheDocument()
    expect(screen.getByText('Сортировка')).toBeInTheDocument()
  })

  it('reflects an active sort in the sort chip label', () => {
    render(<KanbanFiltersUI board={board} bag={createBag({ sortBy: 'planned' })} />)

    expect(screen.getByText(/Сортировка: план/)).toBeInTheDocument()
  })
})
