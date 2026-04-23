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
    const toolResultButton = screen.getByRole('button', { name: /результат/i })
    const file = screen.getByRole('link', { name: /brief\.pdf/i })
    const strong = container.querySelector('strong')

    expect(text).toBeTruthy()
    expect(tool).toBeTruthy()
    expect(toolSummary.textContent).toBe('Поиск по базе • Done • Результат')
    expect(screen.queryByText('Tool • Done')).toBeNull()
    expect(screen.queryByText('Найдена страница «Roadmap»')).toBeNull()
    await user.click(toolResultButton)
    expect(screen.getByRole('dialog', { name: /результат/i })).toBeTruthy()
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
})
