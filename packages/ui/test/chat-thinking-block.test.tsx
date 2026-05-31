import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { ChatThinkingBlock } from '../src/components/chat/chat-thinking-block'

describe('ChatThinkingBlock', () => {
  it('renders the label and the text', () => {
    render(<ChatThinkingBlock text="my reasoning" />)
    expect(screen.getByText('Размышления')).toBeTruthy()
    // Collapsed by default but MUI Collapse keeps the content mounted in the DOM.
    expect(screen.getByText('my reasoning')).toBeTruthy()
  })

  it('is collapsed by default and expands on click', async () => {
    const user = userEvent.setup()
    render(<ChatThinkingBlock text="my reasoning" />)
    const header = screen.getByText('Размышления')
    // The toggle glyph reflects collapsed state.
    expect(screen.getByText('▸')).toBeTruthy()
    await user.click(header)
    expect(screen.getByText('▾')).toBeTruthy()
  })
})
