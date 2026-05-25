// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ThreadCard } from '@/components/page/comments/thread-card'
import type { UiThread } from '@/components/page/comments/types'

const thread: UiThread = {
  id: 'thread-1',
  quotedText: 'Комментируемый текст',
  resolvedAt: null,
  comments: [
    {
      id: 'comment-1',
      authorId: 'user-1',
      authorName: 'Виктор',
      content: { text: 'Нужно обсудить' },
      createdAt: new Date('2026-05-25T10:00:00Z'),
    },
  ],
}

describe('ThreadCard', () => {
  afterEach(() => {
    cleanup()
  })

  it('hides comment deletion when deletion is disabled', () => {
    render(
      <ThreadCard
        thread={thread}
        canDeleteComments={false}
        onReply={vi.fn()}
        onResolve={vi.fn()}
        onReopen={vi.fn()}
        onDeleteComment={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Удалить комментарий' })).not.toBeInTheDocument()
  })

  it('renders icon actions for delete and resolve', async () => {
    const actor = userEvent.setup()
    const onDeleteComment = vi.fn()
    const onResolve = vi.fn()

    render(
      <ThreadCard
        thread={thread}
        canDeleteComments
        onReply={vi.fn()}
        onResolve={onResolve}
        onReopen={vi.fn()}
        onDeleteComment={onDeleteComment}
      />,
    )

    await actor.click(screen.getByRole('button', { name: 'Удалить комментарий' }))
    await actor.click(screen.getByRole('button', { name: 'Решить' }))

    expect(onDeleteComment).toHaveBeenCalledWith('comment-1')
    expect(onResolve).toHaveBeenCalledOnce()
  })

  it('marks the active card with a thread id attribute', () => {
    render(
      <ThreadCard
        thread={thread}
        active
        canDeleteComments
        onReply={vi.fn()}
        onResolve={vi.fn()}
        onReopen={vi.fn()}
        onDeleteComment={vi.fn()}
      />,
    )

    expect(document.querySelector('[data-thread-card-id="thread-1"]')).not.toBeNull()
  })
})
