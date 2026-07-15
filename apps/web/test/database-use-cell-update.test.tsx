// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  patchCell: vi.fn(),
  invalidateActive: vi.fn(),
  mutationError: new Error('Сохранение не удалось'),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    database: {
      updateCellValue: {
        useMutation: vi.fn(() => ({
          mutate: mocks.mutate,
          isPending: true,
          error: mocks.mutationError,
        })),
      },
    },
  },
}))

vi.mock('@/components/database/use-view-rows', () => ({
  useOptimisticRows: () => ({
    patchCell: mocks.patchCell,
    invalidateActive: mocks.invalidateActive,
  }),
}))

import { useCellUpdate } from '@/components/database/cell-editors/use-optimistic-cell'

describe('useCellUpdate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exposes pending and mutation error state while preserving commit behavior', () => {
    const { result } = renderHook(() => useCellUpdate('page-id'))

    expect(result.current.isPending).toBe(true)
    expect(result.current.error).toBe(mocks.mutationError)

    act(() => result.current.commit('row-id', 'property-id', ['file-id']))
    expect(mocks.patchCell).toHaveBeenCalledWith('row-id', 'property-id', ['file-id'])
    expect(mocks.mutate).toHaveBeenCalledWith({
      pageId: 'page-id',
      rowId: 'row-id',
      propertyId: 'property-id',
      value: ['file-id'],
    })
  })
})
