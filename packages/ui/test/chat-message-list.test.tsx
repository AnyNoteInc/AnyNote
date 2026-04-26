import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ChatMessageList } from '../src/components/chat/chat-message-list'

describe('ChatMessageList', () => {
  it('renders assistant content without a fallback Assistant label', () => {
    render(
      <ChatMessageList
        messages={[
          {
            id: 'assistant-message',
            parts: [{ type: 'text', text: 'Ответ ассистента' }],
            role: 'assistant',
          },
        ]}
      />,
    )

    expect(screen.getByText('Ответ ассистента')).toBeTruthy()
    expect(screen.queryByText('Assistant')).toBeNull()
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

  it('renders the empty state in Russian', () => {
    render(<ChatMessageList messages={[]} />)

    expect(screen.getByText('Сообщений пока нет')).toBeTruthy()
    expect(screen.getByText('Отправьте первое сообщение, чтобы начать диалог.')).toBeTruthy()
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
