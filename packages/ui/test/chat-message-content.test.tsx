import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { ChatMessageContent } from '../src/components/chat/chat-message-content'

describe('ChatMessageContent', () => {
  it('renders text before tool and attacment parts', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <ChatMessageContent
        parts={[
          {
            type: 'attacment',
            fileId: 'f1',
            name: 'brief.pdf',
            mimeType: 'application/pdf',
            fileSize: '12 KB',
            downloadUrl: '/api/files/f1',
          },
          {
            type: 'tool',
            id: 'tool-1',
            kind: 'tool',
            state: 'done',
            title: 'Поиск по базе',
            detail: '2 документа',
            result: 'Найдена страница «Roadmap»',
          },
          { type: 'text', text: '# Heading\n\nHello **there**' },
        ]}
      />,
    )

    const text = screen.getByRole('heading', { name: 'Heading' })
    const tool = screen.getByText(/Поиск по базе/)
    const toolSummary = screen.getByTestId('chat-service-block-summary')
    const file = screen.getByRole('link', { name: /brief\.pdf/i })
    const strong = container.querySelector('strong')

    expect(text).toBeTruthy()
    expect(tool).toBeTruthy()
    expect(toolSummary.textContent).toContain('Поиск по базе')
    expect(toolSummary.textContent).toContain('Done')
    // result is hidden until the quiet row is expanded (no modal dialog)
    expect(screen.queryByText('Найдена страница «Roadmap»')).toBeNull()
    await user.click(toolSummary)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Найдена страница «Roadmap»')).toBeTruthy()
    expect(file).toBeTruthy()
    expect(strong?.textContent).toBe('there')
    expect(container.textContent?.indexOf('Heading')).toBeLessThan(
      container.textContent?.indexOf('Поиск по базе') ?? Number.POSITIVE_INFINITY,
    )
    expect(container.textContent?.indexOf('Поиск по базе')).toBeLessThan(
      container.textContent?.indexOf('brief.pdf') ?? Number.POSITIVE_INFINITY,
    )
  })

  it('renders a thinking part via ChatThinkingBlock before the text', () => {
    const { container } = render(
      <ChatMessageContent
        parts={[
          { type: 'text', text: 'Финальный ответ' },
          { type: 'thinking', text: 'Сначала я подумал об этом' },
        ]}
      />,
    )

    expect(screen.getByText('Размышления')).toBeTruthy()
    expect(screen.getByText('Сначала я подумал об этом')).toBeTruthy()
    expect(container.textContent?.indexOf('Размышления')).toBeLessThan(
      container.textContent?.indexOf('Финальный ответ') ?? Number.POSITIVE_INFINITY,
    )
  })

  it('renders default <a> when renderLink is not provided', () => {
    const { container } = render(
      <ChatMessageContent parts={[{ type: 'text', text: '[link](/foo)' }]} />,
    )
    const anchor = container.querySelector('a')
    expect(anchor).toBeTruthy()
    expect(anchor?.getAttribute('href')).toBe('/foo')
    expect(anchor?.textContent).toBe('link')
  })

  it('uses renderLink when provided', () => {
    const { container } = render(
      <ChatMessageContent
        parts={[{ type: 'text', text: '[link](/foo)' }]}
        renderLink={(href, children) => (
          <span data-testid="custom-link" data-href={href}>
            {children}
          </span>
        )}
      />,
    )
    const span = container.querySelector('[data-testid="custom-link"]')
    expect(span).toBeTruthy()
    expect(span?.getAttribute('data-href')).toBe('/foo')
    expect(span?.textContent).toBe('link')
    expect(container.querySelector('a')).toBeNull()
  })

  it('converts workspace page URL after "здесь" into a markdown link', () => {
    const href = '/workspaces/28531e45-1bf1-4640-90f2-12b9bd17f5f3/pages/96409533-ddbc-422e-941d-2c4d2abf3098'
    render(
      <ChatMessageContent
        parts={[
          {
            type: 'text',
            text: `Страница создана. Вы можете найти её здесь: ${href}`,
          },
        ]}
        renderLink={(linkHref, children) => (
          <a href={linkHref} data-testid="chat-link">
            {children}
          </a>
        )}
      />,
    )

    const link = screen.getByTestId('chat-link')
    expect(link.getAttribute('href')).toBe(href)
    expect(link.textContent).toBe('здесь')
    expect(screen.queryByText(href)).toBeNull()
  })
})
