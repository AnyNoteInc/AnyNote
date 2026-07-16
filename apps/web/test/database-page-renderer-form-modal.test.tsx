// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  viewType: 'FORM',
  useViewRows: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ database: { getByPage: { invalidate: vi.fn() } } }),
    database: {
      getByPage: {
        useQuery: () => ({
          data: {
            source: { id: 'source-1', pageId: 'page-1', workspaceId: 'workspace-1', title: 'DB' },
            views: [
              { id: 'view-1', type: mocks.viewType, title: 'View', position: 0, settings: {} },
            ],
            properties: [],
            systemTitleProperty: { key: 'title', name: 'Название' },
            myAccess: {
              canEditContent: true,
              canEditStructure: true,
              canManageExposure: true,
              structureLocked: false,
            },
          },
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
      repairSource: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}))

vi.mock('@/components/database/database-view-tabs', () => ({ DatabaseViewTabs: () => null }))
vi.mock('@/components/database/forms/form-builder', () => ({
  FormBuilder: () => <div data-testid="form-builder" />,
}))
vi.mock('@/components/database/database-table-view', () => ({
  DatabaseTableView: () => <div data-testid="table-view" />,
}))
vi.mock('@/components/database/views/database-board-view', () => ({
  DatabaseBoardView: () => null,
}))
vi.mock('@/components/database/views/database-calendar-view', () => ({
  DatabaseCalendarView: () => null,
}))
vi.mock('@/components/database/views/database-list-view', () => ({ DatabaseListView: () => null }))
vi.mock('@/components/database/cell-editors/use-optimistic-cell', () => ({
  ActiveViewIdProvider: ({ children }: { children: React.ReactNode }) => children,
  DatabaseWorkspaceIdProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@/components/database/use-view-rows', () => ({
  useViewRows: (...args: unknown[]) => {
    mocks.useViewRows(...args)
    return { rows: [] }
  },
  useOptimisticRows: () => ({
    patchTitle: vi.fn(),
    invalidateActive: vi.fn(),
  }),
}))

import { DatabasePageRenderer } from '@/components/database/database-page-renderer'

describe('DatabasePageRenderer FORM item modal ownership', () => {
  afterEach(() => {
    cleanup()
    mocks.useViewRows.mockClear()
  })

  it('does not mount the global row modal for a FORM view', () => {
    mocks.viewType = 'FORM'
    render(<DatabasePageRenderer pageId="page-1" />)

    expect(screen.getByTestId('form-builder')).toBeInTheDocument()
    expect(mocks.useViewRows).not.toHaveBeenCalled()
  })

  it('retains the global row modal for non-FORM views', () => {
    mocks.viewType = 'TABLE'
    render(<DatabasePageRenderer pageId="page-1" />)

    expect(screen.getByTestId('table-view')).toBeInTheDocument()
    expect(mocks.useViewRows).toHaveBeenCalledWith('page-1', 'view-1', true)
  })
})
