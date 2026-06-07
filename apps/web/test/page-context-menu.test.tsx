// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  onRename: vi.fn(),
  invalidateListByWorkspace: vi.fn(),
  invalidateGetById: vi.fn(),
  toggleFavorite: vi.fn(),
  copyLink: vi.fn(),
  duplicate: vi.fn(),
  openDeleteConfirm: vi.fn(),
}))

vi.mock('@repo/ui/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/ui/components')>()
  return {
    ...actual,
    EmojiIconButton: ({
      value,
      onChange,
      'aria-label': ariaLabel,
    }: {
      value?: string | null
      onChange: (emoji: string) => void
      'aria-label'?: string
    }) => (
      <button type="button" aria-label={ariaLabel ?? 'Выбрать иконку'} onClick={() => onChange('🚀')}>
        {value || '📄'}
      </button>
    ),
  }
})

vi.mock('@/hooks/use-page-actions', () => ({
  usePageActions: () => ({
    toggleFavorite: mocks.toggleFavorite,
    copyLink: mocks.copyLink,
    duplicate: mocks.duplicate,
    openDeleteConfirm: mocks.openDeleteConfirm,
    handleArchive: vi.fn(),
    handleMakePrivate: vi.fn(),
    handleMoveToTeam: vi.fn(),
    dialogs: null,
  }),
}))

vi.mock('@/components/templates', () => ({
  SaveAsTemplateDialog: () => null,
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      page: {
        listByWorkspace: { invalidate: mocks.invalidateListByWorkspace },
        getById: { invalidate: mocks.invalidateGetById },
      },
    }),
    page: {
      rename: {
        useMutation: (options?: { onSuccess?: () => void }) => ({
          mutate: (input: unknown) => {
            mocks.onRename(input)
            options?.onSuccess?.()
          },
        }),
      },
    },
    collection: {
      list: {
        useQuery: () => ({ data: [] }),
      },
    },
  },
}))

import { PageContextMenu } from '@/components/workspace/page-context-menu'
import type { PageItem } from '@/components/workspace/types'

const page: PageItem = {
  id: '33333333-3333-3333-3333-333333333333',
  type: 'TEXT',
  title: 'Исходная страница',
  icon: '📄',
  parentId: null,
  prevPageId: null,
  createdById: '22222222-2222-2222-2222-222222222222',
  createdAt: new Date('2026-05-23T00:00:00Z'),
}

describe('PageContextMenu', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('keeps icon edits local until the rename dialog is saved', async () => {
    const actor = userEvent.setup()
    const anchor = document.createElement('button')
    document.body.append(anchor)

    render(
      <PageContextMenu
        anchorEl={anchor}
        onClose={vi.fn()}
        page={page}
        workspaceId="11111111-1111-1111-1111-111111111111"
        isFavorite={false}
        onOpenMoveDialog={vi.fn()}
      />,
    )

    await actor.click(screen.getByRole('menuitem', { name: 'Переименовать' }))

    const dialog = screen.getByRole('dialog', { name: 'Переименовать' })
    await actor.click(within(dialog).getByRole('button', { name: 'Изменить иконку' }))
    expect(mocks.onRename).not.toHaveBeenCalled()

    await actor.clear(within(dialog).getByRole('textbox'))
    await actor.type(within(dialog).getByRole('textbox'), 'Страница с иконкой')
    await actor.click(within(dialog).getByRole('button', { name: 'Сохранить' }))

    expect(mocks.onRename).toHaveBeenCalledWith({
      id: page.id,
      workspaceId: '11111111-1111-1111-1111-111111111111',
      title: 'Страница с иконкой',
      icon: '🚀',
    })
  })
})
