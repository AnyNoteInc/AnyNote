// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CommentComposer,
  CommentMentionSearchProvider,
} from '@/components/page/comments/comment-composer'

describe('CommentComposer', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('inserts selected mentions and submits the stored mention ids', async () => {
    const actor = userEvent.setup()
    const onSubmit = vi.fn()

    render(
      <CommentMentionSearchProvider
        value={async () => [{ id: 'user-1', label: 'Victor Notes', email: 'victor@example.com' }]}
      >
        <CommentComposer onSubmit={onSubmit} />
      </CommentMentionSearchProvider>,
    )

    await actor.type(screen.getByRole('textbox'), 'Hi @vic')
    await actor.click(await screen.findByText('Victor Notes'))
    await actor.click(screen.getByRole('button', { name: 'Отпр.' }))

    expect(onSubmit).toHaveBeenCalledWith({ text: 'Hi @Victor Notes', mentions: ['user-1'] })
  })

  it('keeps empty and pending comments from submitting', async () => {
    const actor = userEvent.setup()
    const onSubmit = vi.fn()

    const { rerender } = render(<CommentComposer onSubmit={onSubmit} />)

    expect(screen.getByRole('button', { name: 'Отпр.' })).toBeDisabled()

    rerender(<CommentComposer onSubmit={onSubmit} pending />)
    await actor.type(screen.getByRole('textbox'), 'Already sending')
    expect(screen.getByRole('button', { name: 'Отпр.' })).toBeDisabled()
    await actor.keyboard('{Meta>}{Enter}{/Meta}')

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits multiline comments with the keyboard shortcut', async () => {
    const actor = userEvent.setup()
    const onSubmit = vi.fn()

    render(<CommentComposer onSubmit={onSubmit} />)

    await actor.type(screen.getByRole('textbox'), 'Line one{Enter}Line two')
    await actor.keyboard('{Control>}{Enter}{/Control}')

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ text: 'Line one\nLine two', mentions: [] })
    })
  })
})
