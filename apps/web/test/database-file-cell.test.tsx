// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  commit: vi.fn(),
  cellState: { isPending: false, error: null as Error | null },
  getWorkspaceMetadata: vi.fn(({ ids }: { ids: string[] }, options?: { enabled?: boolean }) => ({
    data:
      options?.enabled === false
        ? undefined
        : ids.map((id) => ({
            id,
            name: `File ${id.slice(-4)}.pdf`,
            mimeType: 'application/pdf',
          })),
  })),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    file: {
      getWorkspaceMetadata: {
        useQuery: mocks.getWorkspaceMetadata,
      },
    },
  },
}))

vi.mock('@/components/database/cell-editors/use-optimistic-cell', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/components/database/cell-editors/use-optimistic-cell')>()
  return {
    ...actual,
    useCellUpdate: () => ({
      commit: mocks.commit,
      isPending: mocks.cellState.isPending,
      error: mocks.cellState.error,
    }),
  }
})

import { FileCell } from '@/components/database/cell-editors/file-cell'
import { DatabaseWorkspaceIdProvider } from '@/components/database/cell-editors/use-optimistic-cell'

const FILE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'
const FILE_B = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002'
const FILE_C = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003'
const WORKSPACE_ID = '11111111-1111-4111-9111-111111111111'

const baseProps = {
  pageId: 'page-id',
  rowId: 'row-id',
  propertyId: 'property-id',
}

function renderCell(value: unknown, workspaceId = WORKSPACE_ID) {
  return render(
    <DatabaseWorkspaceIdProvider value={workspaceId}>
      <FileCell {...baseProps} value={value} />
    </DatabaseWorkspaceIdProvider>,
  )
}

function fileName(id: string) {
  return `File ${id.slice(-4)}.pdf`
}

describe('FileCell', () => {
  beforeEach(() => {
    mocks.commit.mockReset()
    mocks.getWorkspaceMetadata.mockClear()
    mocks.cellState.isPending = false
    mocks.cellState.error = null
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('loads metadata once for the cell and renders one item per id', () => {
    renderCell([FILE_A, FILE_B])

    expect(screen.getByText(fileName(FILE_A))).toBeInTheDocument()
    expect(screen.getByText(fileName(FILE_B))).toBeInTheDocument()
    expect(mocks.getWorkspaceMetadata).toHaveBeenCalledOnce()
    expect(mocks.getWorkspaceMetadata).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE_ID, ids: [FILE_A, FILE_B] },
      expect.objectContaining({ enabled: true }),
    )
  })

  it('removes only the selected file in stable order and writes [] for the last removal', async () => {
    const actor = userEvent.setup()
    const { rerender } = renderCell([FILE_A, FILE_B])

    await actor.click(screen.getByRole('button', { name: `Удалить файл ${fileName(FILE_A)}` }))
    expect(mocks.commit).toHaveBeenLastCalledWith('row-id', 'property-id', [FILE_B])

    rerender(
      <DatabaseWorkspaceIdProvider value={WORKSPACE_ID}>
        <FileCell {...baseProps} value={[FILE_B]} />
      </DatabaseWorkspaceIdProvider>,
    )
    await actor.click(screen.getByRole('button', { name: `Удалить файл ${fileName(FILE_B)}` }))
    expect(mocks.commit).toHaveBeenLastCalledWith('row-id', 'property-id', [])
  })

  it('renders a legacy scalar as one item and removes it with the canonical empty array', async () => {
    const actor = userEvent.setup()
    renderCell(FILE_A)

    expect(screen.getByText(fileName(FILE_A))).toBeInTheDocument()
    await actor.click(screen.getByRole('button', { name: `Удалить файл ${fileName(FILE_A)}` }))
    expect(mocks.commit).toHaveBeenCalledWith('row-id', 'property-id', [])
  })

  it('appends an uploaded id and pins the upload to the encoded database workspace', async () => {
    const actor = userEvent.setup()
    const workspaceId = 'workspace/id?from=database'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ file: { id: FILE_C } }),
      })),
    )
    renderCell([FILE_A, FILE_B], workspaceId)

    await actor.upload(
      screen.getByLabelText('Добавить файл'),
      new File(['content'], 'third.pdf', { type: 'application/pdf' }),
    )

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/files/upload?kind=attachment&workspaceId=workspace%2Fid%3Ffrom%3Ddatabase',
        expect.objectContaining({ method: 'POST', credentials: 'include' }),
      )
      expect(mocks.commit).toHaveBeenCalledWith('row-id', 'property-id', [FILE_A, FILE_B, FILE_C])
    })
  })

  it('disables add and remove interactions while an upload is in flight', async () => {
    const actor = userEvent.setup()
    let resolveUpload!: (response: { ok: boolean; json: () => Promise<unknown> }) => void
    const uploadResponse = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
      resolveUpload = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => uploadResponse),
    )
    renderCell([FILE_A])

    await actor.upload(
      screen.getByLabelText('Добавить файл'),
      new File(['content'], 'pending.pdf', { type: 'application/pdf' }),
    )

    const remove = screen.getByRole('button', { name: `Удалить файл ${fileName(FILE_A)}` })
    const add = screen.getByRole('button', { name: 'Загрузка…' })
    await waitFor(() => {
      expect(remove).toBeDisabled()
      expect(add).toBeDisabled()
      expect(screen.getByLabelText('Добавить файл')).toBeDisabled()
    })
    fireEvent.click(remove)
    expect(mocks.commit).not.toHaveBeenCalled()

    resolveUpload({ ok: true, json: async () => ({ file: { id: FILE_C } }) })
    await waitFor(() => {
      expect(mocks.commit).toHaveBeenCalledWith('row-id', 'property-id', [FILE_A, FILE_C])
    })
  })

  it('disables all mutations while the cell update mutation is pending', () => {
    mocks.cellState.isPending = true
    renderCell([FILE_A])

    expect(screen.getByRole('button', { name: `Удалить файл ${fileName(FILE_A)}` })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Добавить' })).toBeDisabled()
    expect(screen.getByLabelText('Добавить файл')).toBeDisabled()
  })

  it('fails closed without an explicit database workspace', () => {
    render(<FileCell {...baseProps} value={[FILE_A]} />)

    expect(mocks.getWorkspaceMetadata).toHaveBeenCalledWith(
      { workspaceId: '', ids: [FILE_A] },
      expect.objectContaining({ enabled: false }),
    )
    expect(screen.getByRole('button', { name: `Удалить файл ${FILE_A}` })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Добавить' })).toBeDisabled()
  })

  it('shows a cell mutation error', () => {
    mocks.cellState.error = new Error('Не удалось сохранить файлы')
    renderCell([FILE_A])

    expect(screen.getByText('Не удалось сохранить файлы')).toBeVisible()
  })

  it('does not append a duplicate id returned by upload', async () => {
    const actor = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ file: { id: FILE_A } }),
      })),
    )
    renderCell([FILE_A])

    await actor.upload(
      screen.getByLabelText('Добавить файл'),
      new File(['content'], 'duplicate.pdf', { type: 'application/pdf' }),
    )

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    expect(mocks.commit).not.toHaveBeenCalled()
  })
})
