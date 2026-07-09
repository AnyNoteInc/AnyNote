import { TRPCError } from '@trpc/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getServerTRPC: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`)
  }),
}))

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}))

vi.mock('@/trpc/server', () => ({
  getServerTRPC: mocks.getServerTRPC,
}))

import LegacyChat from '../src/app/(protected)/workspaces/[workspaceId]/chats/[chatId]/page'

const WS = '11111111-1111-4111-9111-111111111111'
const WS_OTHER = '33333333-3333-4333-9333-333333333333'
const CHAT_ID = '22222222-2222-4222-9222-222222222222'

describe('legacy workspace chat redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets the workspace active and redirects to the neutral chat URL when the chat matches the URL workspace', async () => {
    const setActive = vi.fn()
    mocks.getServerTRPC.mockResolvedValue({
      chat: {
        getChat: vi.fn().mockResolvedValue({
          chat: { workspaceId: WS },
          messages: [],
        }),
      },
      workspace: { setActive },
    })

    await expect(
      LegacyChat({
        params: Promise.resolve({ workspaceId: WS, chatId: CHAT_ID }),
      }),
    ).rejects.toThrow(`NEXT_REDIRECT:/chats/${CHAT_ID}`)

    expect(setActive).toHaveBeenCalledWith({ workspaceId: WS })
    expect(mocks.redirect).toHaveBeenCalledWith(`/chats/${CHAT_ID}`)
    expect(mocks.notFound).not.toHaveBeenCalled()
  })

  it('calls notFound when the chat belongs to a different workspace than the URL', async () => {
    const setActive = vi.fn()
    mocks.getServerTRPC.mockResolvedValue({
      chat: {
        getChat: vi.fn().mockResolvedValue({
          chat: { workspaceId: WS_OTHER },
          messages: [],
        }),
      },
      workspace: { setActive },
    })

    await expect(
      LegacyChat({
        params: Promise.resolve({ workspaceId: WS, chatId: CHAT_ID }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(mocks.notFound).toHaveBeenCalledTimes(1)
    expect(setActive).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('uses notFound only for missing chats', async () => {
    mocks.getServerTRPC.mockResolvedValue({
      chat: {
        getChat: vi.fn().mockRejectedValue(new TRPCError({ code: 'NOT_FOUND' })),
      },
    })

    await expect(
      LegacyChat({
        params: Promise.resolve({ workspaceId: WS, chatId: CHAT_ID }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })

  it('rethrows non-NOT_FOUND errors instead of masking them as 404', async () => {
    mocks.getServerTRPC.mockResolvedValue({
      chat: {
        getChat: vi.fn().mockRejectedValue(new Error('boom')),
      },
    })

    await expect(
      LegacyChat({
        params: Promise.resolve({ workspaceId: WS, chatId: CHAT_ID }),
      }),
    ).rejects.toThrow('boom')

    expect(mocks.notFound).not.toHaveBeenCalled()
  })
})
