import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CHAT_EMPTY_PHRASES, ChatEmptyState } from '../src/components/chat/chat-empty-state'

describe('ChatEmptyState', () => {
  it('renders one of the greeting phrases', async () => {
    render(<ChatEmptyState />)
    const heading = await screen.findByRole('heading')
    expect(CHAT_EMPTY_PHRASES).toContain(heading.textContent)
  })

  it('does not render a comment icon', () => {
    const { container } = render(<ChatEmptyState />)
    expect(container.querySelector('[data-testid="ChatBubbleOutlineIcon"]')).toBeNull()
  })

  it('exposes exactly the four agreed phrases', () => {
    expect(CHAT_EMPTY_PHRASES).toEqual([
      'Над чем ты работаешь?',
      'Что у тебя сегодня на уме?',
      'С чего начнём?',
      'Готов, когда ты готов',
    ])
  })
})
