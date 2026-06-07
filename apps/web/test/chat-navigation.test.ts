import { describe, expect, it, vi } from 'vitest'

import { buildChatHref, navigateToChat } from '../src/components/workspace/chat/navigation'

describe('chat navigation', () => {
  it('buildChatHref returns a neutral /chats/:id URL', () => {
    expect(buildChatHref('chat-123')).toBe('/chats/chat-123')
  })

  it('navigateToChat pushes the neutral URL', () => {
    const push = vi.fn()
    navigateToChat({ push }, 'chat-123')
    expect(push).toHaveBeenCalledWith('/chats/chat-123', { scroll: false })
  })
})
