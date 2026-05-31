import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ChatServiceBlock, toolDotColor } from '../src/components/chat/chat-service-block'
import type { ChatToolPart } from '../src/components/chat/chat-types'

function part(overrides: Partial<ChatToolPart> = {}): ChatToolPart {
  return {
    type: 'tool',
    id: 'b1',
    kind: 'tool',
    state: 'pending',
    title: 'Очень длинный заголовок плана, который не должен схлопываться в одну строку',
    ...overrides,
  }
}

function confirmationPart(): ChatToolPart {
  return {
    type: 'tool',
    id: 'c1',
    kind: 'confirmation',
    state: 'required',
    title: 'Создать страницу «Smoke»',
    detail: JSON.stringify({
      confirmation_id: 'c1',
      tool: 'anynote__createPage',
      summary: 'Создать страницу «Smoke»',
      args_preview: { title: 'Smoke', type: 'TEXT' },
    }),
  }
}

describe('toolDotColor', () => {
  it('maps tool state to timeline dot colour', () => {
    expect(toolDotColor('running')).toBe('grey')
    expect(toolDotColor('pending')).toBe('grey')
    expect(toolDotColor('done')).toBe('primary')
    expect(toolDotColor('error')).toBe('error')
    expect(toolDotColor('required')).toBe('warning')
  })
})

describe('ChatServiceBlock — quiet tool step', () => {
  it('does not apply MUI noWrap modifier on the title', () => {
    render(<ChatServiceBlock part={part()} />)
    const title = screen.getByText(/Очень длинный заголовок/)
    expect(title.className).not.toMatch(/noWrap/i)
  })

  it('lets the long title wrap instead of truncating', () => {
    render(<ChatServiceBlock part={part()} />)
    const title = screen.getByText(/Очень длинный заголовок/)
    const computed = globalThis.getComputedStyle(title)
    expect(computed.whiteSpace).not.toBe('nowrap')
    expect(computed.wordBreak).toBe('break-word')
  })

  it('renders the tool name without a textual state label', () => {
    render(
      <ChatServiceBlock
        part={part({ state: 'done', detail: JSON.stringify({ tool: 'search_workspace_pages' }) })}
      />,
    )
    expect(screen.getByText('search_workspace_pages')).toBeInTheDocument()
    expect(screen.queryByText('Done')).not.toBeInTheDocument()
  })

  it('does not render as a MUI Alert', () => {
    const { container } = render(<ChatServiceBlock part={part({ state: 'done' })} />)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('expands args and result inline when the row is clicked', async () => {
    const user = userEvent.setup()
    render(
      <ChatServiceBlock
        part={part({
          state: 'done',
          detail: JSON.stringify({ tool: 'search', args_preview: { query: 'roadmap' } }),
          result: 'Найдена страница «Roadmap»',
        })}
      />,
    )
    // collapsed by default
    expect(screen.queryByText(/"query": "roadmap"/)).toBeNull()
    expect(screen.queryByText('Найдена страница «Roadmap»')).toBeNull()
    await user.click(screen.getByTestId('chat-service-block-summary'))
    expect(screen.getByText(/"query": "roadmap"/)).toBeTruthy()
    expect(screen.getByText('Найдена страница «Roadmap»')).toBeTruthy()
    // no result Dialog anymore — everything is inline
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('ChatServiceBlock — confirmation', () => {
  it('renders the inline confirmation with Разрешить and Отклонить when state is required', () => {
    render(<ChatServiceBlock part={confirmationPart()} onConfirm={() => {}} />)
    expect(screen.getByTestId('chat-confirm-inline')).toBeTruthy()
    expect(screen.getByRole('button', { name: /разрешить/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /отклонить/i })).toBeTruthy()
  })

  it('shows the args preview inline in the confirmation', () => {
    render(<ChatServiceBlock part={confirmationPart()} onConfirm={() => {}} />)
    expect(screen.getByText(/"title": "Smoke"/)).toBeTruthy()
  })

  it('calls onConfirm with action="allow" when Разрешить is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<ChatServiceBlock part={confirmationPart()} onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: /разрешить/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith('c1', 'allow')
  })

  it('calls onConfirm with action="deny" when Отклонить is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<ChatServiceBlock part={confirmationPart()} onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: /отклонить/i }))
    expect(onConfirm).toHaveBeenCalledWith('c1', 'deny')
  })

  it('renders Разрешать в этом чате only when onAllowAll is provided', async () => {
    const user = userEvent.setup()
    const onAllowAll = vi.fn()
    const { rerender } = render(<ChatServiceBlock part={confirmationPart()} onConfirm={() => {}} />)
    expect(screen.queryByRole('button', { name: /разрешать в этом чате/i })).toBeNull()
    rerender(
      <ChatServiceBlock part={confirmationPart()} onConfirm={() => {}} onAllowAll={onAllowAll} />,
    )
    await user.click(screen.getByRole('button', { name: /разрешать в этом чате/i }))
    expect(onAllowAll).toHaveBeenCalledWith('anynote__createPage')
  })

  it('falls back to the quiet row (no confirm buttons) after the parent flips state to running', () => {
    const runningPart: ChatToolPart = { ...confirmationPart(), state: 'running' }
    render(<ChatServiceBlock part={runningPart} onConfirm={() => {}} />)
    expect(screen.queryByTestId('chat-confirm-inline')).toBeNull()
    expect(screen.queryByRole('button', { name: /разрешить/i })).toBeNull()
  })
})
