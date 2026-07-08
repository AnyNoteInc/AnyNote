import { TRPCError } from '@trpc/server'
import React from 'react'
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

vi.mock('@/components/workspace/chat/workspace-chat-client', () => ({
  WorkspaceChatClient: () => null,
}))

import ChatRoute from '../src/app/(protected)/(active)/chats/[chatId]/page'

const WS = '11111111-1111-4111-9111-111111111111'
const WS2 = '33333333-3333-4333-9333-333333333333'
const CHAT_ID = '22222222-2222-4222-9222-222222222222'

describe('neutral chat page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('React', React)
  })

  it('renders the chat client when the active workspace already matches the chat', async () => {
    mocks.getServerTRPC.mockResolvedValue({
      chat: {
        getChat: vi.fn().mockResolvedValue({
          chat: { workspaceId: WS },
          messages: [],
        }),
      },
      workspace: {
        getActive: vi.fn().mockResolvedValue({ id: WS }),
        setActive: vi.fn(),
      },
    })

    const element = await ChatRoute({
      params: Promise.resolve({ chatId: CHAT_ID }),
    })

    expect(element).toBeTruthy()
    expect(mocks.notFound).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('switches the active workspace and redirects when the active workspace differs', async () => {
    const setActive = vi.fn()
    mocks.getServerTRPC.mockResolvedValue({
      chat: {
        getChat: vi.fn().mockResolvedValue({
          chat: { workspaceId: WS2 },
          messages: [],
        }),
      },
      workspace: {
        getActive: vi.fn().mockResolvedValue({ id: WS }),
        setActive,
      },
    })

    await expect(
      ChatRoute({
        params: Promise.resolve({ chatId: CHAT_ID }),
      }),
    ).rejects.toThrow(`NEXT_REDIRECT:/chats/${CHAT_ID}`)

    expect(setActive).toHaveBeenCalledWith({ workspaceId: WS2 })
    expect(mocks.redirect).toHaveBeenCalledWith(`/chats/${CHAT_ID}`)
  })

  it('calls notFound when the chat is missing', async () => {
    mocks.getServerTRPC.mockResolvedValue({
      chat: {
        getChat: vi.fn().mockRejectedValue(new TRPCError({ code: 'NOT_FOUND' })),
      },
      workspace: {
        getActive: vi.fn(),
        setActive: vi.fn(),
      },
    })

    await expect(
      ChatRoute({
        params: Promise.resolve({ chatId: CHAT_ID }),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })
})
