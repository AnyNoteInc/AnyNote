// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  mutationFn: vi.fn(),
  setInfiniteData: vi.fn(),
  setVisibleValue: null as ((value: unknown) => void) | null,
}))

vi.mock('@/trpc/client', () => {
  const metadata = ({ ids }: { ids: string[] }, options?: { enabled?: boolean }) => ({
    data:
      options?.enabled === false
        ? undefined
        : ids.map((id) => ({ id, name: 'Rejected.pdf', mimeType: 'application/pdf' })),
  })

  return {
    trpc: {
      useQueries: (queries: (proxy: unknown) => unknown[]) =>
        queries({ file: { getWorkspaceMetadata: metadata } }),
      useUtils: () => ({
        database: {
          listRows: {
            invalidate: mocks.invalidate,
            setInfiniteData: mocks.setInfiniteData,
          },
        },
      }),
      database: {
        updateCellValue: {
          useMutation: (options: { onError?: () => unknown }) =>
            useMutation({ mutationFn: mocks.mutationFn, ...options }),
        },
      },
      file: {
        getWorkspaceMetadata: { useQuery: metadata },
      },
    },
  }
})

import { FileCell } from '@/components/database/cell-editors/file-cell'
import { DatabaseWorkspaceIdProvider } from '@/components/database/cell-editors/use-optimistic-cell'

const FILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'
const WORKSPACE_ID = '11111111-1111-4111-9111-111111111111'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function Harness() {
  const [value, setValue] = useState<unknown>([FILE_ID])

  useEffect(() => {
    mocks.setVisibleValue = setValue
    return () => {
      mocks.setVisibleValue = null
    }
  }, [])

  return (
    <DatabaseWorkspaceIdProvider value={WORKSPACE_ID}>
      <FileCell pageId="page-id" rowId="row-id" propertyId="property-id" value={value} />
    </DatabaseWorkspaceIdProvider>
  )
}

describe('FileCell failed optimistic update rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.setVisibleValue = null
    mocks.setInfiniteData.mockImplementation(
      (
        _input: unknown,
        updater: (current: {
          pages: { rows: { rowId: string; cells: Record<string, unknown> }[] }[]
          pageParams: unknown[]
        }) => {
          pages: { rows: { rowId: string; cells: Record<string, unknown> }[] }[]
          pageParams: unknown[]
        },
      ) => {
        const updated = updater({
          pages: [
            {
              rows: [{ rowId: 'row-id', cells: { 'property-id': [FILE_ID] } }],
            },
          ],
          pageParams: [],
        })
        mocks.setVisibleValue?.(updated.pages[0]!.rows[0]!.cells['property-id'])
      },
    )
  })

  afterEach(() => cleanup())

  it('keeps controls locked and the rejected optimistic value visible until refetch finishes', async () => {
    const update = deferred<never>()
    const rollback = deferred<void>()
    mocks.mutationFn.mockReturnValue(update.promise)
    mocks.invalidate.mockImplementation((input: unknown) => {
      if (input === undefined) return Promise.resolve()
      return rollback.promise.then(() => mocks.setVisibleValue?.([FILE_ID]))
    })
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    const actor = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    )

    await actor.click(screen.getByRole('button', { name: 'Удалить файл Rejected.pdf' }))

    expect(screen.queryByText('Rejected.pdf')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Загрузить' })).toBeDisabled()
    expect(mocks.mutationFn).toHaveBeenCalledOnce()

    update.reject(new Error('Сохранение не удалось'))
    await waitFor(() =>
      expect(mocks.invalidate).toHaveBeenCalledWith({ pageId: 'page-id', viewId: undefined }),
    )

    expect(screen.queryByText('Rejected.pdf')).not.toBeInTheDocument()
    const upload = screen.getByRole('button', { name: 'Загрузить' })
    expect(upload).toBeDisabled()
    fireEvent.click(upload)
    expect(mocks.mutationFn).toHaveBeenCalledOnce()

    rollback.resolve()

    await waitFor(() => {
      expect(screen.getByText('Rejected.pdf')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Добавить' })).toBeEnabled()
    })
    expect(screen.getByText('Сохранение не удалось')).toBeVisible()
  })
})
