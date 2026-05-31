import { cleanup, render, screen, within } from '@testing-library/react'
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

  it('opens the + menu with the attach action and recent files', async () => {
    const user = userEvent.setup()
    const onAttachRecent = vi.fn()

    render(
      <ChatComposer
        value=""
        attachments={[]}
        onValueChange={() => {}}
        onAttachmentsChange={() => {}}
        onSend={vi.fn()}
        recentFiles={[{ id: 'file-1', name: 'brief.pdf', fileSize: '12', mimeType: 'application/pdf' }]}
        onAttachRecent={onAttachRecent}
      />,
    )

    await user.click(screen.getByRole('button', { name: /добавить вложение/i }))

    expect(screen.getByText('Добавить фото и файлы')).toBeTruthy()
    expect(screen.getByText('Недавние файлы')).toBeTruthy()

    await user.click(screen.getByText('brief.pdf'))
    expect(onAttachRecent).toHaveBeenCalledWith({
      id: 'file-1',
      name: 'brief.pdf',
      fileSize: '12',
      mimeType: 'application/pdf',
    })
  })

  it('hides the recent-files section when no recent files are provided', async () => {
    const user = userEvent.setup()

    render(
      <ChatComposer
        value=""
        attachments={[]}
        onValueChange={() => {}}
        onAttachmentsChange={() => {}}
        onSend={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /добавить вложение/i }))
    expect(screen.getByText('Добавить фото и файлы')).toBeTruthy()
    expect(screen.queryByText('Недавние файлы')).toBeNull()
  })

  it('shows the Thinking slash command when the input starts with "/" and reasoning is supported', async () => {
    const user = userEvent.setup()
    const onSelectThinking = vi.fn()
    const onValueChange = vi.fn()

    render(
      <ChatComposer
        value="/think"
        attachments={[]}
        onValueChange={onValueChange}
        onAttachmentsChange={() => {}}
        onSend={vi.fn()}
        reasoningSupported
        onSelectThinking={onSelectThinking}
      />,
    )

    const highOption = await screen.findByTestId('chat-slash-thinking-high')
    await user.click(highOption)

    expect(onSelectThinking).toHaveBeenCalledWith('HIGH')
    // selecting clears the leading slash from the input
    expect(onValueChange).toHaveBeenCalledWith('')
  })

  it('disables the Thinking command when reasoning is unsupported', () => {
    render(
      <ChatComposer
        value="/"
        attachments={[]}
        onValueChange={() => {}}
        onAttachmentsChange={() => {}}
        onSend={vi.fn()}
        reasoningSupported={false}
        onSelectThinking={vi.fn()}
      />,
    )

    const disabled = screen.getByTestId('chat-slash-thinking-disabled')
    expect(disabled.getAttribute('aria-disabled')).toBe('true')
  })

  it('does not show the slash menu for ordinary text', () => {
    render(
      <ChatComposer
        value="hello"
        attachments={[]}
        onValueChange={() => {}}
        onAttachmentsChange={() => {}}
        onSend={vi.fn()}
        reasoningSupported
        onSelectThinking={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('chat-slash-menu')).toBeNull()
  })

  it('renders an active Thinking chip whose remove button calls onClearThinking', async () => {
    const user = userEvent.setup()
    const onClearThinking = vi.fn()

    render(
      <ChatComposer
        value=""
        attachments={[]}
        onValueChange={() => {}}
        onAttachmentsChange={() => {}}
        onSend={vi.fn()}
        thinking={{ effort: 'MEDIUM' }}
        onClearThinking={onClearThinking}
      />,
    )

    const chip = screen.getByTestId('chat-thinking-chip')
    expect(chip.textContent).toContain('Thinking')

    await user.click(within(chip).getByTestId('CancelIcon'))
    expect(onClearThinking).toHaveBeenCalledTimes(1)
  })
})
