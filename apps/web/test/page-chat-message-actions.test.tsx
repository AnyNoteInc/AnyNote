// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PageChatMessageActions } from '@/components/page/page-chat/page-chat-message-actions'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PageChatMessageActions', () => {
  it('renders copy, append and undo buttons in one row', () => {
    render(
      <PageChatMessageActions text="Ответ" onAppend={() => true} onUndo={() => true} canUndo />,
    )
    expect(screen.getByTestId('page-chat-message-actions')).toBeTruthy()
    expect(screen.getByTestId('page-chat-copy')).toBeTruthy()
    expect(screen.getByTestId('page-chat-append')).toBeTruthy()
    expect(screen.getByTestId('page-chat-undo')).toBeTruthy()
  })

  it('copies the assistant text to the clipboard', async () => {
    // userEvent.setup() installs a working clipboard stub — assert through it.
    const user = userEvent.setup()
    render(
      <PageChatMessageActions
        text="Скопируй меня"
        onAppend={() => true}
        onUndo={() => true}
        canUndo
      />,
    )
    await user.click(screen.getByTestId('page-chat-copy'))
    await expect.poll(() => navigator.clipboard.readText()).toBe('Скопируй меня')
  })

  it('append calls onAppend with no confirmation', async () => {
    const user = userEvent.setup()
    const onAppend = vi.fn(() => true)
    render(<PageChatMessageActions text="Т" onAppend={onAppend} onUndo={() => true} canUndo />)
    await user.click(screen.getByTestId('page-chat-append'))
    expect(onAppend).toHaveBeenCalledTimes(1)
  })

  it('undo requires an inline confirmation before firing', async () => {
    const user = userEvent.setup()
    const onUndo = vi.fn(() => true)
    render(<PageChatMessageActions text="Т" onAppend={() => true} onUndo={onUndo} canUndo />)

    await user.click(screen.getByTestId('page-chat-undo'))
    // The icon row is replaced by the inline confirmation; nothing undone yet.
    expect(onUndo).not.toHaveBeenCalled()
    expect(screen.getByTestId('page-chat-undo-confirm-row')).toBeTruthy()

    await user.click(screen.getByTestId('page-chat-undo-confirm'))
    expect(onUndo).toHaveBeenCalledTimes(1)
  })

  it('the inline confirmation can be dismissed without undoing', async () => {
    const user = userEvent.setup()
    const onUndo = vi.fn(() => true)
    render(<PageChatMessageActions text="Т" onAppend={() => true} onUndo={onUndo} canUndo />)

    await user.click(screen.getByTestId('page-chat-undo'))
    await user.click(screen.getByTestId('page-chat-undo-cancel'))
    expect(onUndo).not.toHaveBeenCalled()
    expect(screen.getByTestId('page-chat-message-actions')).toBeTruthy()
  })

  it('undo is disabled when no snapshot exists for the answer', () => {
    render(
      <PageChatMessageActions
        text="Т"
        onAppend={() => true}
        onUndo={() => true}
        canUndo={false}
      />,
    )
    expect((screen.getByTestId('page-chat-undo') as HTMLButtonElement).disabled).toBe(true)
  })
})
