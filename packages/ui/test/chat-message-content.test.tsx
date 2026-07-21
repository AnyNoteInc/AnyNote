import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { ChatMessageContent } from '../src/components/chat/chat-message-content'
import type { ChatMessagePart } from '../src/components/chat/chat-types'

describe('ChatMessageContent timeline order', () => {
  it('renders parts in array order (no type grouping)', () => {
    const parts: ChatMessagePart[] = [
      { type: 'tool', id: 't1', kind: 'tool', state: 'done', title: 'search' },
      { type: 'text', text: 'answer after tool' },
    ]
    render(<ChatMessageContent parts={parts} />)
    // Under the OLD type-sort, text (order 1) would render before tool (order 2),
    // i.e. "answer after tool" would come FIRST. Assert the tool comes first.
    const toolTitle = screen.getByText('search')
    const answer = screen.getByText('answer after tool')
    expect(
      toolTitle.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})

describe('ChatMessageContent', () => {
  it('renders text, tool and attacment parts in array order', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <ChatMessageContent
        parts={[
          { type: 'text', text: '# Heading\n\nHello **there**' },
          {
            type: 'tool',
            id: 'tool-1',
            kind: 'tool',
            state: 'done',
            title: 'Поиск по базе',
            detail: '2 документа',
            result: 'Найдена страница «Roadmap»',
          },
          {
            type: 'attacment',
            fileId: 'f1',
            name: 'brief.pdf',
            mimeType: 'application/pdf',
            fileSize: '12 KB',
            downloadUrl: '/api/files/f1',
          },
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
    // state is conveyed by the timeline dot colour now — no textual state label
    expect(toolSummary.textContent).not.toContain('Done')
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

  it('renders a thinking part via ChatThinkingBlock in array order before the text', () => {
    const { container } = render(
      <ChatMessageContent
        parts={[
          { type: 'thinking', text: 'Сначала я подумал об этом' },
          { type: 'text', text: 'Финальный ответ' },
        ]}
      />,
    )

    expect(screen.getByText('Размышления')).toBeTruthy()
    expect(screen.getByText('Сначала я подумал об этом')).toBeTruthy()
    expect(container.textContent?.indexOf('Размышления')).toBeLessThan(
      container.textContent?.indexOf('Финальный ответ') ?? Number.POSITIVE_INFINITY,
    )
  })

  it('renders a GFM markdown table as a real <table> with its cells', () => {
    const table = ['| Name | Role |', '| --- | --- |', '| Alice | Admin |'].join('\n')
    const { container } = render(<ChatMessageContent parts={[{ type: 'text', text: table }]} />)

    const tableEl = container.querySelector('table')
    expect(tableEl).toBeTruthy()
    expect(container.querySelectorAll('th')).toHaveLength(2)
    expect(container.querySelectorAll('td')).toHaveLength(2)
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'Alice' })).toBeTruthy()
    // The raw pipe syntax must not leak through as plain text.
    expect(container.textContent).not.toContain('| --- |')
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
    const href =
      '/workspaces/28531e45-1bf1-4640-90f2-12b9bd17f5f3/pages/96409533-ddbc-422e-941d-2c4d2abf3098'
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

  it('renders a user message without the timeline rail', () => {
    const { container } = render(
      <ChatMessageContent variant="user" parts={[{ type: 'text', text: 'Привет' }]} />,
    )
    expect(screen.getByText('Привет')).toBeTruthy()
    // No MUI Timeline scaffolding for user messages.
    expect(container.querySelector('.MuiTimeline-root')).toBeNull()
    expect(container.querySelector('.MuiTimelineDot-root')).toBeNull()
  })

  it('still renders the assistant timeline by default', () => {
    const { container } = render(
      <ChatMessageContent parts={[{ type: 'text', text: 'Ответ' }]} />,
    )
    expect(container.querySelector('.MuiTimeline-root')).toBeTruthy()
  })

  it('tightens the TimelineItem floor to a small gap (below the 70px default)', () => {
    const { container } = render(
      <ChatMessageContent
        parts={[
          { type: 'text', text: 'one' },
          { type: 'text', text: 'two' },
        ]}
      />,
    )
    const item = container.querySelector('.MuiTimelineItem-root') as HTMLElement
    expect(item).toBeTruthy()
    // default is 70px; we override to 32px — a small, even dot-to-dot gap
    expect(getComputedStyle(item).minHeight).toBe('32px')
  })

  it('removes the unused opposite lane so assistant content starts at the left rail', () => {
    const { container } = render(
      <ChatMessageContent parts={[{ type: 'text', text: 'Ответ у левого края' }]} />,
    )
    const item = container.querySelector('.MuiTimelineItem-root') as HTMLElement
    expect(item).toBeTruthy()

    const generatedClasses = Array.from(item.classList).filter((className) =>
      className.startsWith('css-'),
    )
    const hidesOppositeLane = Array.from(document.styleSheets).some((sheet) => {
      try {
        return Array.from(sheet.cssRules).some((rule) => {
          if (!(rule instanceof CSSStyleRule) || rule.style.display !== 'none') return false
          return (
            rule.selectorText.includes('::before') &&
            generatedClasses.some((className) => rule.selectorText.includes(`.${className}`))
          )
        })
      } catch {
        return false
      }
    })

    expect(hidesOppositeLane).toBe(true)
  })

  it('gives timeline connectors a minimum height so the lines stay visible', () => {
    const { container } = render(
      <ChatMessageContent
        parts={[
          { type: 'text', text: 'one' },
          { type: 'text', text: 'two' },
        ]}
      />,
    )
    const connector = container.querySelector('.MuiTimelineConnector-root') as HTMLElement
    expect(connector).toBeTruthy()
    // content otherwise collapses the connector to 0; enforce a visible minimum
    expect(getComputedStyle(connector).minHeight).toBe('12px')
  })

  it('compact density drops the timeline rail and keeps a tool state dot', () => {
    const { container } = render(
      <ChatMessageContent
        density="compact"
        parts={[
          { type: 'text', text: 'Ответ на всю ширину' },
          { type: 'tool', id: 't1', kind: 'tool', state: 'done', title: 'appendToPage' },
        ]}
      />,
    )
    expect(screen.getByText('Ответ на всю ширину')).toBeTruthy()
    expect(screen.getByText('appendToPage')).toBeTruthy()
    // No MUI Timeline scaffolding (the ~36px left rail) in compact mode…
    expect(container.querySelector('.MuiTimeline-root')).toBeNull()
    expect(container.querySelector('.MuiTimelineDot-root')).toBeNull()
    expect(screen.getByTestId('chat-message-compact')).toBeTruthy()
    // …but tool parts keep the state signal as an inline dot.
    expect(screen.getByTestId('chat-tool-dot')).toBeTruthy()
  })

  it('compact density renders text parts without a tool dot', () => {
    render(
      <ChatMessageContent density="compact" parts={[{ type: 'text', text: 'Просто текст' }]} />,
    )
    expect(screen.getByText('Просто текст')).toBeTruthy()
    expect(screen.queryByTestId('chat-tool-dot')).toBeNull()
  })

  it('uses compact bottom padding on assistant timeline content', () => {
    const { container } = render(
      <ChatMessageContent
        parts={[
          { type: 'text', text: 'one' },
          { type: 'text', text: 'two' },
        ]}
      />,
    )
    const content = container.querySelector('.MuiTimelineContent-root') as HTMLElement
    expect(content).toBeTruthy()
    // pb: 0.5 => theme spacing(0.5) => 4px
    expect(getComputedStyle(content).paddingBottom).toBe('4px')
  })
})
