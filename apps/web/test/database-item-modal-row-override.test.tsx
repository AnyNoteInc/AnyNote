// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useViewRows: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams('rowId=row-1'),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    page: {
      getById: {
        useQuery: () => ({
          data: { id: 'item-page', workspaceId: 'workspace-1', type: 'DOCUMENT', contentYjs: null },
          isLoading: false,
          error: null,
        }),
      },
    },
    database: { updateRow: { useMutation: () => ({ mutate: vi.fn() }) } },
  },
}))

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'user-1', email: 'user@example.com' } } }),
}))
vi.mock('@/components/page/cover-band', () => ({ CoverBand: () => null }))
vi.mock('@/components/page/page-icon', () => ({ PageIcon: () => null }))
vi.mock('@/components/page/page-view', () => ({ PageView: () => <div>Страница ответа</div> }))
vi.mock('@/components/database/cell-editors/cell-dispatch', () => ({ CellEditor: () => null }))
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

import { DatabaseItemModal } from '@/components/database/database-item-modal'

describe('DatabaseItemModal row override', () => {
  afterEach(cleanup)

  it('disables the active-view rows query when the authoritative response row is supplied', () => {
    render(
      <DatabaseItemModal
        pageId="page-1"
        viewId="view-1"
        schema={{ properties: [] } as never}
        rowOverride={
          {
            rowId: 'row-1',
            pageId: 'item-page',
            title: 'Анна',
            icon: null,
            cells: {},
          } as never
        }
      />,
    )

    expect(screen.getByText('Страница ответа')).toBeInTheDocument()
    expect(mocks.useViewRows).toHaveBeenCalledWith('page-1', 'view-1', false)
  })
})
