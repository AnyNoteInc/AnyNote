// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  fetchNextPage: vi.fn(),
  queryInput: undefined as unknown,
  queryOptions: undefined as unknown,
  modalProps: undefined as unknown,
  queryError: null as Error | null,
  refetch: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams('tab=form'),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    database: {
      listFormResponses: {
        useInfiniteQuery: (input: unknown, options: unknown) => {
          mocks.queryInput = input
          mocks.queryOptions = options
          return {
            data: {
              pages: [
                {
                  items: [
                    {
                      submissionId: 'submission-1',
                      submittedAt: '2026-07-16T07:00:00.000Z',
                      endingId: 'ending-1',
                      row: { rowId: 'row-1', title: 'Анна' },
                    },
                  ],
                  nextCursor: 'cursor-2',
                },
              ],
            },
            isLoading: false,
            error: mocks.queryError,
            hasNextPage: true,
            isFetchingNextPage: false,
            fetchNextPage: mocks.fetchNextPage,
            refetch: mocks.refetch,
          }
        },
      },
    },
  },
}))

vi.mock('@/components/database/database-item-modal', () => ({
  DatabaseItemModal: (props: unknown) => {
    mocks.modalProps = props
    return <div data-testid="response-row-modal">Карточка ответа</div>
  },
}))

import { FormResponsesPanel } from '@/components/database/forms/form-responses-panel'

describe('FormResponsesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.queryError = null
  })
  afterEach(cleanup)

  it('uses keyset pagination and opens the selected response through rowOverride', async () => {
    const actor = userEvent.setup()
    render(
      <FormResponsesPanel
        open
        pageId="page-1"
        formId="form-1"
        formViewId="view-1"
        schema={{} as never}
        editable
        onClose={() => undefined}
      />,
    )

    expect(mocks.queryInput).toEqual({ pageId: 'page-1', formId: 'form-1', limit: 25 })
    expect(
      (
        mocks.queryOptions as { getNextPageParam: (page: { nextCursor: string }) => string }
      ).getNextPageParam({ nextCursor: 'cursor-2' }),
    ).toBe('cursor-2')

    await actor.click(screen.getByRole('button', { name: /Анна/u }))
    expect(screen.getByTestId('response-row-modal')).toBeInTheDocument()
    expect(mocks.modalProps).toEqual(
      expect.objectContaining({ rowOverride: { rowId: 'row-1', title: 'Анна' } }),
    )
    expect(mocks.replace).toHaveBeenCalledWith('?tab=form&rowId=row-1&viewId=view-1')

    await actor.click(screen.getByRole('button', { name: 'Показать ещё' }))
    expect(mocks.fetchNextPage).toHaveBeenCalled()
  })

  it('shows a recoverable query error and retries on demand', async () => {
    const actor = userEvent.setup()
    mocks.queryError = new Error('network down')

    render(
      <FormResponsesPanel
        open
        pageId="page-1"
        formId="form-1"
        formViewId="view-1"
        schema={{} as never}
        editable={false}
        onClose={() => undefined}
      />,
    )

    expect(screen.getByText('Не удалось загрузить ответы')).toBeInTheDocument()
    await actor.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(mocks.refetch).toHaveBeenCalled()
    expect(mocks.queryOptions).toEqual(expect.objectContaining({ retry: 2 }))
  })
})
