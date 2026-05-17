import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ChatServiceBlock } from '../src/components/chat/chat-service-block'
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

describe('ChatServiceBlock — wrapping', () => {
  it('does not apply MUI noWrap modifier on the title', () => {
    render(<ChatServiceBlock part={part()} />)
    const title = screen.getByText(/Очень длинный заголовок/)
    expect(title.className).not.toMatch(/noWrap/i)
  })

  it('does not set flex-wrap to nowrap on the summary row', () => {
    render(<ChatServiceBlock part={part()} />)
    const row = screen.getByTestId('chat-service-block-summary')
    // Before the fix flexWrap="nowrap" was passed as an MUI Box prop. After the fix,
    // the prop is "wrap". We check the computed style since MUI v6 uses hashed classes.
    const computed = globalThis.getComputedStyle(row)
    expect(computed.flexWrap).not.toBe('nowrap')
  })
})

describe('ChatServiceBlock — confirmation', () => {
  it('renders Разрешить and Отклонить buttons when state is required', () => {
    render(<ChatServiceBlock part={confirmationPart()} onConfirm={() => {}} />)
    expect(screen.getByRole('button', { name: /разрешить/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /отклонить/i })).toBeTruthy()
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

  it('toggles args preview when Подробнее is clicked', async () => {
    const user = userEvent.setup()
    render(<ChatServiceBlock part={confirmationPart()} onConfirm={() => {}} />)
    // collapsed by default
    expect(screen.queryByText(/"title": "Smoke"/)).toBeNull()
    await user.click(screen.getByRole('button', { name: /подробнее/i }))
    expect(screen.getByText(/"title": "Smoke"/)).toBeTruthy()
  })

  it('hides the buttons after the parent flips state to running', () => {
    const part: ChatToolPart = { ...confirmationPart(), state: 'running' }
    render(<ChatServiceBlock part={part} onConfirm={() => {}} />)
    expect(screen.queryByRole('button', { name: /разрешить/i })).toBeNull()
  })
})
