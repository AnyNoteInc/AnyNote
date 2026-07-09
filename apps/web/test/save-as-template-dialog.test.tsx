// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createFromPage: vi.fn(),
  invalidateMarketplace: vi.fn(() => Promise.resolve()),
}))

vi.mock('@repo/ui/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/ui/components')>()
  return {
    ...actual,
    EmojiIconButton: ({ value }: { value?: string | null }) => (
      <button type="button" aria-label="Изменить иконку шаблона">
        {value || '📄'}
      </button>
    ),
  }
})

vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      template: {
        listMarketplace: { invalidate: mocks.invalidateMarketplace },
      },
    }),
    template: {
      createFromPage: {
        useMutation: (opts?: { onSuccess?: () => void }) => ({
          mutate: (input: unknown) => {
            mocks.createFromPage(input)
            opts?.onSuccess?.()
          },
          isPending: false,
          isError: false,
        }),
      },
      listTags: {
        useQuery: () => ({ data: [] }),
      },
    },
  },
}))

import { SaveAsTemplateDialog } from '@/components/templates/save-as-template-dialog'

const WS = '11111111-1111-4111-9111-111111111111'
const PAGE = '22222222-2222-4222-9222-222222222222'

function renderDialog(props: Partial<Parameters<typeof SaveAsTemplateDialog>[0]> = {}) {
  return render(
    <SaveAsTemplateDialog
      open
      onClose={vi.fn()}
      workspaceId={WS}
      pageId={PAGE}
      defaultTitle="Моя страница"
      defaultIcon="📄"
      {...props}
    />,
  )
}

describe('SaveAsTemplateDialog', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows the "Сохранить как шаблон" title and pre-fills the page title', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Сохранить как шаблон' })).toBeInTheDocument()
    expect(screen.getByLabelText('Название шаблона')).toHaveValue('Моя страница')
  })

  it('offers both scope options enabled (anyone can create a global template)', () => {
    renderDialog()
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    const workspaceRadio = radios.find((r) => r.value === 'WORKSPACE')
    const globalRadio = radios.find((r) => r.value === 'GLOBAL')
    expect(workspaceRadio).toBeEnabled()
    expect(globalRadio).toBeEnabled()
  })

  it('submits a WORKSPACE template with the entered fields', async () => {
    const actor = userEvent.setup()
    const onClose = vi.fn()
    renderDialog({ onClose })

    const title = screen.getByLabelText('Название шаблона')
    await actor.clear(title)
    await actor.type(title, 'Шаблон встречи')
    await actor.type(screen.getByLabelText('Описание'), 'Повестка')

    await actor.click(screen.getByRole('button', { name: 'Создать шаблон' }))

    expect(mocks.createFromPage).toHaveBeenCalledWith({
      pageId: PAGE,
      workspaceId: WS,
      title: 'Шаблон встречи',
      description: 'Повестка',
      icon: '📄',
      scope: 'WORKSPACE',
      tagIds: [],
    })
    // onSuccess closes the dialog and invalidates the marketplace template list.
    expect(mocks.invalidateMarketplace).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('disables submit when the title is empty', async () => {
    const actor = userEvent.setup()
    renderDialog({ defaultTitle: '' })
    expect(screen.getByRole('button', { name: 'Создать шаблон' })).toBeDisabled()
    await actor.type(screen.getByLabelText('Название шаблона'), 'X')
    expect(screen.getByRole('button', { name: 'Создать шаблон' })).toBeEnabled()
  })
})
