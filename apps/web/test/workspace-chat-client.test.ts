import { describe, expect, it } from "vitest"

import {
  findResumableAssistantMessageId,
  mapServerMessagesToThreadMessages,
} from "../src/components/workspace/chat/chat-message-mappers"

describe("workspace chat client mappers", () => {
  it("maps persisted chat DTOs into @repo/ui thread messages", () => {
    const messages = mapServerMessagesToThreadMessages([
      {
        id: "11111111-1111-1111-1111-111111111111",
        role: "USER",
        status: "DONE",
        errorMessage: null,
        createdAt: "2026-04-22T10:00:00.000Z",
        updatedAt: "2026-04-22T10:00:00.000Z",
        parts: [
          { type: "text", text: "Привет" },
          {
            type: "file",
            fileId: "22222222-2222-2222-2222-222222222222",
            name: "brief.pdf",
            mimeType: "application/pdf",
            fileSize: "12",
            downloadUrl: "/api/files/22222222-2222-2222-2222-222222222222",
          },
        ],
      },
    ])

    expect(messages).toEqual([
      {
        id: "11111111-1111-1111-1111-111111111111",
        role: "user",
        status: "sent",
        createdAt: "2026-04-22T10:00:00.000Z",
        updatedAt: "2026-04-22T10:00:00.000Z",
        parts: [
          { type: "text", text: "Привет" },
          {
            type: "file",
            fileId: "22222222-2222-2222-2222-222222222222",
            name: "brief.pdf",
            mimeType: "application/pdf",
            fileSize: "12",
            downloadUrl: "/api/files/22222222-2222-2222-2222-222222222222",
          },
        ],
      },
    ])
  })

  it("treats the latest streaming assistant message as resumable", () => {
    const assistantMessageId = findResumableAssistantMessageId([
      {
        id: "33333333-3333-3333-3333-333333333333",
        role: "USER",
        status: "DONE",
        errorMessage: null,
        createdAt: "2026-04-22T10:00:00.000Z",
        updatedAt: "2026-04-22T10:00:00.000Z",
        parts: [{ type: "text", text: "Вопрос" }],
      },
      {
        id: "44444444-4444-4444-4444-444444444444",
        role: "ASSISTANT",
        status: "STREAMING",
        errorMessage: null,
        createdAt: "2026-04-22T10:00:01.000Z",
        updatedAt: "2026-04-22T10:00:02.000Z",
        parts: [{ type: "text", text: "Ответ" }],
      },
    ])

    expect(assistantMessageId).toBe("44444444-4444-4444-4444-444444444444")
  })
})
