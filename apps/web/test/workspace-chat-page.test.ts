import { TRPCError } from "@trpc/server"
import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getServerTRPC: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}))

vi.mock("@/trpc/server", () => ({
  getServerTRPC: mocks.getServerTRPC,
}))

vi.mock("@/components/workspace/chat/workspace-chat-client", () => ({
  WorkspaceChatClient: () => null,
}))

import SearchChatPage from "../src/app/(protected)/workspaces/[workspaceId]/chats/[chatId]/page"

describe("workspace chat page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("React", React)
  })

  it("renders the chat page when getChat succeeds", async () => {
    mocks.getServerTRPC.mockResolvedValue({
      chat: {
        getChat: vi.fn().mockResolvedValue({
          messages: [],
        }),
      },
    })

    const element = await SearchChatPage({
      params: Promise.resolve({
        workspaceId: "11111111-1111-1111-1111-111111111111",
        chatId: "22222222-2222-2222-2222-222222222222",
      }),
    })

    expect(element).toBeTruthy()
    expect(mocks.notFound).not.toHaveBeenCalled()
  })

  it("uses notFound only for missing chats", async () => {
    mocks.getServerTRPC.mockResolvedValue({
      chat: {
        getChat: vi.fn().mockRejectedValue(new TRPCError({ code: "NOT_FOUND" })),
      },
    })

    await expect(
      SearchChatPage({
        params: Promise.resolve({
          workspaceId: "11111111-1111-1111-1111-111111111111",
          chatId: "22222222-2222-2222-2222-222222222222",
        }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND")

    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })

  it("rethrows non-NOT_FOUND errors instead of masking them as 404", async () => {
    mocks.getServerTRPC.mockResolvedValue({
      chat: {
        getChat: vi.fn().mockRejectedValue(new Error("boom")),
      },
    })

    await expect(
      SearchChatPage({
        params: Promise.resolve({
          workspaceId: "11111111-1111-1111-1111-111111111111",
          chatId: "22222222-2222-2222-2222-222222222222",
        }),
      }),
    ).rejects.toThrow("boom")

    expect(mocks.notFound).not.toHaveBeenCalled()
  })
})
