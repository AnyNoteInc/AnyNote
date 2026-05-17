import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

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
