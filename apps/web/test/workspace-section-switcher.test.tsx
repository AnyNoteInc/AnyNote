// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspaces/w1/pages',
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    page: { listFavorites: { useQuery: () => ({ data: [] }) } },
    workspace: { listMine: { useQuery: () => ({ data: [] }) } },
  },
}))

import { WorkspaceSectionSwitcher } from '@/components/workspace/workspace-sidebar'

const noop = vi.fn()

function renderSwitcher(chatsEnabled: boolean) {
  return render(
    <WorkspaceSectionSwitcher
      activeSection="pages"
      chatsEnabled={chatsEnabled}
      onChats={noop}
      onPages={noop}
      onSearch={noop}
    />,
  )
}

describe('WorkspaceSectionSwitcher', () => {
  afterEach(cleanup)

  it('shows the chat button when chats are enabled', () => {
    renderSwitcher(true)
    expect(screen.getByRole('button', { name: 'Чаты' })).toBeInTheDocument()
  })

  it('hides the chat button when chats are disabled', () => {
    renderSwitcher(false)
    expect(screen.queryByRole('button', { name: 'Чаты' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Поиск' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Домашняя' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Настройки' })).not.toBeInTheDocument()
  })

  it('renders the active section as a pressed pill', () => {
    render(
      <WorkspaceSectionSwitcher
        activeSection="chats"
        chatsEnabled={true}
        onChats={noop}
        onPages={noop}
        onSearch={noop}
      />,
    )
    expect(screen.getByRole('button', { name: 'Чаты', pressed: true })).toBeInTheDocument()
    // Домашняя is inactive (icon-only) → aria-pressed="false" (always rendered on the pill)
    expect(screen.getByRole('button', { name: 'Домашняя' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})
