// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
      onSettings={noop}
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
    expect(screen.getByRole('button', { name: 'Страницы' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Настройки' })).toBeInTheDocument()
  })
})
