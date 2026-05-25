// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CommentToggleButton } from '@/components/page/comments/comment-toggle-button'
import {
  PageCommentsContext,
  type PageCommentsContextValue,
} from '@/components/page/comments/comments-context'

function ctx(overrides: Partial<PageCommentsContextValue>): PageCommentsContextValue {
  return {
    enabled: true,
    threads: [],
    anchors: [],
    activeCount: 0,
    canComment: true,
    canDeleteComments: true,
    panelOpen: false,
    closePanel: vi.fn(),
    togglePanel: vi.fn(),
    openThreadId: null,
    openThreadInSidebar: vi.fn(),
    popover: null,
    openThreadPopover: vi.fn(),
    closePopover: vi.fn(),
    newAnchor: null,
    startNewThread: vi.fn(),
    cancelNewThread: vi.fn(),
    activeAnchor: null,
    createThread: vi.fn(),
    addComment: vi.fn(),
    resolveThread: vi.fn(),
    reopenThread: vi.fn(),
    deleteComment: vi.fn(),
    ...overrides,
  }
}

const renderWith = (value: PageCommentsContextValue) =>
  render(
    <PageCommentsContext.Provider value={value}>
      <CommentToggleButton />
    </PageCommentsContext.Provider>,
  )

describe('CommentToggleButton', () => {
  afterEach(cleanup)

  it('renders nothing when comments are disabled', () => {
    const { container } = renderWith(ctx({ enabled: false }))
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the active count and toggles the panel', async () => {
    const actor = userEvent.setup()
    const togglePanel = vi.fn()
    renderWith(ctx({ enabled: true, activeCount: 3, togglePanel }))

    expect(screen.getByText('3')).toBeInTheDocument()
    await actor.click(screen.getByRole('button', { name: 'Комментарии' }))
    expect(togglePanel).toHaveBeenCalledOnce()
  })
})
