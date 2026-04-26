import { describe, expect, it, vi } from 'vitest'

import { buildChatHref, navigateToChat } from '../src/components/workspace/chat/navigation'

describe('chat navigation', () => {
  it('builds the workspace chat href', () => {
    expect(buildChatHref('workspace-1', 'chat-1')).toBe('/workspaces/workspace-1/chats/chat-1')
  })

  it('navigates to a chat without resetting the page scroll', () => {
    const push = vi.fn()

    navigateToChat({ push }, 'workspace-1', 'chat-1')

    expect(push).toHaveBeenCalledWith('/workspaces/workspace-1/chats/chat-1', {
      scroll: false,
    })
  })
})
