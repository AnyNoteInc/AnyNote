import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CHAT_EMPTY_PHRASES } from '../src/components/chat/chat-empty-state'
import { ChatMessageList } from '../src/components/chat/chat-message-list'

describe('ChatMessageList', () => {
  it('renders the message area with a transparent background (inherits the page canvas)', () => {
    render(
      <ChatMessageList
        messages={[{ id: 'm1', parts: [{ type: 'text', text: 'Привет' }], role: 'assistant' }]}
      />,
    )
    const list = screen.getByTestId('chat-message-list')
    // jsdom normalises the `transparent` keyword to rgba(0, 0, 0, 0)
    expect(getComputedStyle(list).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  })

  it('renders assistant content without a fallback Assistant label', () => {
    render(
      <ChatMessageList
        messages={[
          {
            id: 'assistant-message',
            parts: [{ type: 'text', text: 'Ответ ассистента' }],
            role: 'assistant',
            authorName: 'Ассистент',
            avatarUrl: 'https://example.com/a.png',
          },
        ]}
      />,
    )

    expect(screen.getByText('Ответ ассистента')).toBeTruthy()
    expect(screen.queryByText('Assistant')).toBeNull()
    expect(screen.queryByText('Ассистент')).toBeNull()
    expect(document.querySelector('.MuiAvatar-root')).toBeNull()
    expect(document.querySelector('img')).toBeNull()
  })

  it('renders a thinking part inside an assistant turn', () => {
    render(
      <ChatMessageList
        messages={[
          {
            id: 'assistant-thinking',
            parts: [
              { type: 'thinking', text: 'Ход рассуждений' },
              { type: 'text', text: 'Итоговый ответ' },
            ],
            role: 'assistant',
          },
        ]}
      />,
    )

    expect(screen.getByText('Размышления')).toBeTruthy()
    expect(screen.getByText('Итоговый ответ')).toBeTruthy()
  })

  it('renders timestamps with a deterministic HH:MM format', () => {
    render(
      <ChatMessageList
        messages={[
          {
            id: 'message-with-time',
            parts: [{ type: 'text', text: 'Сообщение со временем' }],
            role: 'user',
            createdAt: '2026-04-22T08:05:00.000Z',
            status: 'sent',
          },
        ]}
      />,
    )

    expect(screen.getByText('08:05 • Отправлено')).toBeTruthy()
  })

  it('renders one of the empty-state greeting phrases', async () => {
    render(<ChatMessageList messages={[]} />)

    const heading = await screen.findByRole('heading')
    expect(CHAT_EMPTY_PHRASES).toContain(heading.textContent)
  })

  it('injects a css rule that strips the inner assistant bubble background', () => {
    render(
      <ChatMessageList
        messages={[
          {
            id: 'assistant-message-no-inner-bubble',
            parts: [{ type: 'text', text: 'Ответ без внутреннего фона' }],
            role: 'assistant',
          },
        ]}
      />,
    )

    const hasTransparentBubbleRule = Array.from(document.styleSheets).some((sheet) => {
      try {
        return Array.from(sheet.cssRules).some((rule) => {
          if (!(rule instanceof CSSStyleRule)) {
            return false
          }
          if (!rule.selectorText.includes('.MuiChatMessage-bubble')) {
            return false
          }
          return /background-color:\s*transparent/i.test(rule.cssText)
        })
      } catch {
        return false
      }
    })

    expect(hasTransparentBubbleRule).toBe(true)
  })

  it('shows loading phrases instead of Печатает for an empty streaming assistant', () => {
    render(
      <ChatMessageList
        messages={[
          {
            id: 'assistant-empty-streaming',
            parts: [],
            role: 'assistant',
            status: 'streaming',
          },
        ]}
      />,
    )

    expect(screen.getByText('Загрузка')).toBeTruthy()
    expect(screen.queryByText('Печатает')).toBeNull()
  })

  it('shows Печатает (not loading phrases) once the assistant emits text while streaming', () => {
    render(
      <ChatMessageList
        messages={[
          {
            id: 'assistant-text-streaming-status',
            parts: [{ type: 'text', text: 'Промежуточный кусок ответа' }],
            role: 'assistant',
            status: 'streaming',
            createdAt: '2026-04-25T15:00:00.000Z',
          },
        ]}
      />,
    )

    expect(screen.getByText('15:00 • Печатает')).toBeTruthy()
    expect(screen.queryByText('Загрузка')).toBeNull()
  })

  it('does not show loading phrases once the assistant has produced text', () => {
    render(
      <ChatMessageList
        messages={[
          {
            id: 'assistant-text-streaming',
            parts: [{ type: 'text', text: 'Уже что-то есть' }],
            role: 'assistant',
            status: 'streaming',
          },
        ]}
      />,
    )

    expect(screen.queryByText('Загрузка')).toBeNull()
    expect(screen.getByText('Уже что-то есть')).toBeTruthy()
  })
})
