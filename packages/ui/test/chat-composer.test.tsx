import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CHAT_COMPOSER_MAX_ROWS, ChatComposer } from '../src/components/chat/chat-composer'
import type { ChatComposerAttachment } from '../src/components/chat/chat-types'

describe('ChatComposer', () => {
  afterEach(() => {
    cleanup()
  })

  it('disables send while the text area is empty', () => {
    render(
      <ChatComposer
        value=""
        attachments={[]}
        onValueChange={() => {}}
        onAttachmentsChange={() => {}}
        onSend={vi.fn()}
      />,
    )

    expect((screen.getByRole('button', { name: /send/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('calls onSend only when non-empty text exists', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    const attachments: ChatComposerAttachment[] = []

    const { rerender } = render(
      <ChatComposer
        value=""
        attachments={attachments}
        onValueChange={() => {}}
        onAttachmentsChange={() => {}}
        onSend={onSend}
      />,
    )

    rerender(
      <ChatComposer
        value="Send this"
        attachments={attachments}
        onValueChange={() => {}}
        onAttachmentsChange={() => {}}
        onSend={onSend}
      />,
    )

    await user.click(screen.getByRole('button', { name: /send/i }))
    expect(onSend).toHaveBeenCalledWith({
      text: 'Send this',
      attachments,
    })
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('uses a 12-row composer cap', () => {
    render(
      <ChatComposer
        value=""
        attachments={[]}
        onValueChange={() => {}}
        onAttachmentsChange={() => {}}
        onSend={vi.fn()}
      />,
    )

    expect(screen.getByTestId('chat-composer-textarea')).toBeTruthy()
    expect(CHAT_COMPOSER_MAX_ROWS).toBe(12)
  })
})
