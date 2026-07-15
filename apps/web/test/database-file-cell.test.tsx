// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  commit: vi.fn(),
  getById: vi.fn(({ id }: { id: string }) => ({
    data: { id, name: `File ${id}.pdf`, mimeType: 'application/pdf' },
  })),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    file: {
      getById: {
        useQuery: mocks.getById,
      },
    },
  },
}))

vi.mock('@/components/database/cell-editors/use-optimistic-cell', () => ({
  useCellUpdate: () => ({ commit: mocks.commit, isPending: false }),
}))

import { FileCell } from '@/components/database/cell-editors/file-cell'

const baseProps = {
  pageId: 'page-id',
  rowId: 'row-id',
  propertyId: 'property-id',
}

describe('FileCell', () => {
  beforeEach(() => {
    mocks.commit.mockReset()
    mocks.getById.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders one item per id and removes only the selected file in stable order', async () => {
    const actor = userEvent.setup()
    const { rerender } = render(<FileCell {...baseProps} value={['file-a', 'file-b']} />)

    expect(screen.getByText('File file-a.pdf')).toBeInTheDocument()
    expect(screen.getByText('File file-b.pdf')).toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Удалить файл File file-a.pdf' }))
    expect(mocks.commit).toHaveBeenLastCalledWith('row-id', 'property-id', ['file-b'])

    rerender(<FileCell {...baseProps} value={['file-b']} />)
    await actor.click(screen.getByRole('button', { name: 'Удалить файл File file-b.pdf' }))
    expect(mocks.commit).toHaveBeenLastCalledWith('row-id', 'property-id', [])
  })

  it('renders a legacy scalar as one item and removes it with the canonical empty array', async () => {
    const actor = userEvent.setup()
    render(<FileCell {...baseProps} value="legacy-file" />)

    expect(screen.getByText('File legacy-file.pdf')).toBeInTheDocument()
    await actor.click(screen.getByRole('button', { name: 'Удалить файл File legacy-file.pdf' }))
    expect(mocks.commit).toHaveBeenCalledWith('row-id', 'property-id', [])
  })

  it('appends an uploaded id without replacing existing files', async () => {
    const actor = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ file: { id: 'file-c' } }),
      })),
    )
    render(<FileCell {...baseProps} value={['file-a', 'file-b']} />)

    await actor.upload(
      screen.getByLabelText('Добавить файл'),
      new File(['content'], 'third.pdf', { type: 'application/pdf' }),
    )

    await waitFor(() => {
      expect(mocks.commit).toHaveBeenCalledWith('row-id', 'property-id', [
        'file-a',
        'file-b',
        'file-c',
      ])
    })
  })

  it('does not append a duplicate id returned by upload', async () => {
    const actor = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ file: { id: 'file-a' } }),
      })),
    )
    render(<FileCell {...baseProps} value={['file-a']} />)

    await actor.upload(
      screen.getByLabelText('Добавить файл'),
      new File(['content'], 'duplicate.pdf', { type: 'application/pdf' }),
    )

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    expect(mocks.commit).not.toHaveBeenCalled()
  })
})
