// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CommentsSidebar } from '@/components/page/comments/comments-sidebar'
import {
  PageCommentsContext,
  type PageCommentsContextValue,
} from '@/components/page/comments/comments-context'
import type { UiThread } from '@/components/page/comments/types'

const threads: UiThread[] = [
  {
    id: 't1',
    quotedText: 'Активный фрагмент',
    resolvedAt: null,
    comments: [
      { id: 'c1', authorId: 'u1', authorName: 'Анна', content: { text: 'Вопрос' }, createdAt: new Date() },
    ],
  },
  {
    id: 't2',
    quotedText: 'Решённый фрагмент',
    resolvedAt: new Date(),
    comments: [
      { id: 'c2', authorId: 'u2', authorName: 'Олег', content: { text: 'Готово' }, createdAt: new Date() },
    ],
  },
]

function ctx(overrides: Partial<PageCommentsContextValue>): PageCommentsContextValue {
  return {
    enabled: true,
    threads: [],
    anchors: [],
    activeCount: 0,
    canComment: true,
    canDeleteComments: true,
    panelOpen: true,
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
      <CommentsSidebar />
    </PageCommentsContext.Provider>,
  )

describe('CommentsSidebar', () => {
  afterEach(cleanup)

  it('renders nothing when the panel is closed', () => {
    const { container } = renderWith(ctx({ panelOpen: false, threads }))
    expect(container).toBeEmptyDOMElement()
  })

  it('shows active threads by default and switches to resolved', async () => {
    const actor = userEvent.setup()
    renderWith(ctx({ threads }))

    expect(screen.getByText('«Активный фрагмент»')).toBeInTheDocument()
    expect(screen.queryByText('«Решённый фрагмент»')).not.toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Решённые' }))
    expect(screen.getByText('«Решённый фрагмент»')).toBeInTheDocument()
  })

  it('replies through the active thread card', async () => {
    const actor = userEvent.setup()
    const addComment = vi.fn()
    renderWith(ctx({ threads: [threads[0]!], addComment }))

    await actor.type(screen.getByPlaceholderText('Комментарий…'), 'Ответ')
    await actor.keyboard('{Control>}{Enter}{/Control}')
    expect(addComment).toHaveBeenCalledWith('t1', { text: 'Ответ', mentions: [] })
  })

  it('shows the empty state when there are no active threads', () => {
    renderWith(ctx({ threads: [] }))
    expect(screen.getByText('Нет комментариев')).toBeInTheDocument()
  })
})
