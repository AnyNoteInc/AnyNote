// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    template: {
      listMarketplace: {
        useQuery: (input: { query: string }, opts: { enabled: boolean }) =>
          mocks.useQuery(input, opts),
      },
    },
  },
}))

import { CreatePageDialog } from '@/components/templates/create-page-dialog'

const WS = '11111111-1111-1111-1111-111111111111'

function idle() {
  return { data: undefined, isFetching: false, isError: false }
}

function withResults(over: {
  workspaceTemplates?: unknown[]
  allTemplates?: unknown[]
  isFetching?: boolean
  isError?: boolean
}) {
  // Mirrors the real `listMarketplace` shape; the dialog derives the global
  // section by filtering `allTemplates` for scope === 'GLOBAL'.
  return {
    data: {
      workspaceTemplates: over.workspaceTemplates ?? [],
      allTemplates: over.allTemplates ?? [],
    },
    isFetching: over.isFetching ?? false,
    isError: over.isError ?? false,
  }
}

const sampleTemplate = {
  id: 'tmpl-1',
  workspaceId: WS,
  scope: 'WORKSPACE' as const,
  title: 'Заметки встречи',
  description: 'Повестка и решения',
  icon: '📝',
  category: 'Работа',
  type: 'TEXT' as const,
  usageCount: 7,
  createdAt: '2026-03-15T00:00:00.000Z',
  updatedAt: '2026-03-15T00:00:00.000Z',
}

function renderDialog(props: Partial<Parameters<typeof CreatePageDialog>[0]> = {}) {
  return render(
    <CreatePageDialog
      open
      onClose={vi.fn()}
      workspaceId={WS}
      onCreatePage={vi.fn()}
      onCreateFromTemplate={vi.fn()}
      {...props}
    />,
  )
}

describe('CreatePageDialog', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows the "Создание страницы" title', () => {
    mocks.useQuery.mockReturnValue(idle())
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Создание страницы' })).toBeInTheDocument()
  })

  it('focuses the search input on open', async () => {
    mocks.useQuery.mockReturnValue(idle())
    renderDialog()
    const input = screen.getByRole('textbox', { name: 'Поиск шаблонов' })
    await waitFor(() => expect(input).toHaveFocus(), { timeout: 2000 })
  })

  it('shows page types when the search is empty', () => {
    mocks.useQuery.mockReturnValue(idle())
    renderDialog()
    expect(screen.getByText('Типы страниц')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Создать страницу: Текст' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Создать страницу: Холст' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Создать страницу: Канбан' })).toBeInTheDocument()
  })

  it('does not offer DATABASE or FORM page types', () => {
    mocks.useQuery.mockReturnValue(idle())
    renderDialog()
    expect(screen.queryByText(/database/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^form$/i)).not.toBeInTheDocument()
  })

  it('selecting a page type calls onCreatePage with that type', async () => {
    const actor = userEvent.setup()
    const onCreatePage = vi.fn()
    mocks.useQuery.mockReturnValue(idle())
    renderDialog({ onCreatePage })
    await actor.click(screen.getByRole('button', { name: 'Создать страницу: Текст' }))
    expect(onCreatePage).toHaveBeenCalledWith('TEXT')
  })

  it('shows templates when a query is typed', async () => {
    const actor = userEvent.setup()
    mocks.useQuery.mockReturnValue(withResults({ workspaceTemplates: [sampleTemplate] }))
    renderDialog()
    await actor.type(screen.getByLabelText('Поиск шаблонов'), 'встреч')
    await waitFor(() => {
      expect(screen.getByText('Шаблоны пространства')).toBeInTheDocument()
    })
    expect(screen.getByText('Заметки встречи')).toBeInTheDocument()
  })

  it('selecting a template calls onCreateFromTemplate', async () => {
    const actor = userEvent.setup()
    const onCreateFromTemplate = vi.fn()
    mocks.useQuery.mockReturnValue(withResults({ workspaceTemplates: [sampleTemplate] }))
    renderDialog({ onCreateFromTemplate })
    await actor.type(screen.getByLabelText('Поиск шаблонов'), 'встреч')
    const card = await screen.findByRole('button', {
      name: 'Создать страницу из шаблона: Заметки встречи',
    })
    await actor.click(card)
    expect(onCreateFromTemplate).toHaveBeenCalledWith('tmpl-1')
  })

  it('shows an empty state when no templates match', async () => {
    const actor = userEvent.setup()
    mocks.useQuery.mockReturnValue(withResults({}))
    renderDialog()
    await actor.type(screen.getByLabelText('Поиск шаблонов'), 'zzz')
    await waitFor(() => {
      expect(screen.getByText('Шаблоны не найдены')).toBeInTheDocument()
    })
  })

  it('shows an error state when the search fails', async () => {
    const actor = userEvent.setup()
    mocks.useQuery.mockReturnValue(withResults({ isError: true }))
    renderDialog()
    await actor.type(screen.getByLabelText('Поиск шаблонов'), 'zzz')
    await waitFor(() => {
      expect(screen.getByText(/Не удалось загрузить шаблоны/i)).toBeInTheDocument()
    })
  })

  it('renders the template usage count and created date in the card', async () => {
    const actor = userEvent.setup()
    mocks.useQuery.mockReturnValue(withResults({ workspaceTemplates: [sampleTemplate] }))
    renderDialog()
    await actor.type(screen.getByLabelText('Поиск шаблонов'), 'встреч')
    const card = await screen.findByRole('button', {
      name: 'Создать страницу из шаблона: Заметки встречи',
    })
    expect(within(card).getByText('Применений: 7')).toBeInTheDocument()
    // 15 мар. 2026 г. — formatted ru-RU date
    expect(within(card).getByText(/2026/)).toBeInTheDocument()
  })
})
