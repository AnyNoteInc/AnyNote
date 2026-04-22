import { describe, expect, it, vi } from "vitest"

vi.mock("@repo/auth", () => ({
  getUserFromRequest: vi.fn(),
}))

vi.mock("@repo/db", () => ({
  prisma: {},
}))

import type { PrismaClient } from "@repo/db"

import { chatRouter } from "../src/routers/chat"
import { createCallerFactory } from "../src/trpc"

const createCaller = createCallerFactory(chatRouter)

function createContext(prisma: PrismaClient) {
  return {
    prisma,
    user: { id: "user-1" },
    headers: new Headers(),
    resHeaders: new Headers(),
  }
}

describe("chatRouter", () => {
  it("normalizes persisted content and files into ordered parts", async () => {
    const createdAt = new Date("2026-04-22T10:00:00.000Z")
    const updatedAt = new Date("2026-04-22T10:05:00.000Z")
    const chat = {
      id: "11111111-1111-1111-1111-111111111111",
      title: "Новый чат",
      workspaceId: "22222222-2222-2222-2222-222222222222",
    }

    const prisma = {
      chat: {
        findFirst: vi.fn(async () => chat),
      },
      chatMessage: {
        findMany: vi.fn(async () => [
          {
            id: "33333333-3333-3333-3333-333333333333",
            role: "USER",
            status: "DONE",
            errorMessage: null,
            content: "Привет",
            createdAt,
            updatedAt,
            files: [
              {
                createdAt: new Date("2026-04-22T10:01:00.000Z"),
                file: {
                  id: "44444444-4444-4444-4444-444444444444",
                  name: "brief.pdf",
                  mimeType: "application/pdf",
                  fileSize: BigInt(10),
                },
              },
              {
                createdAt: new Date("2026-04-22T10:02:00.000Z"),
                file: {
                  id: "55555555-5555-5555-5555-555555555555",
                  name: "image.png",
                  mimeType: "image/png",
                  fileSize: BigInt(20),
                },
              },
            ],
          },
        ]),
      },
    } as unknown as PrismaClient

    const caller = createCaller(createContext(prisma))
    const result = await caller.getChat({ chatId: chat.id })

    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith({
      include: {
        files: {
          include: { file: true },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
      where: { chatId: chat.id },
    })

    expect(result.messages).toEqual([
      {
        id: "33333333-3333-3333-3333-333333333333",
        role: "USER",
        status: "DONE",
        errorMessage: null,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        parts: [
          { type: "text", text: "Привет" },
          {
            type: "file",
            fileId: "44444444-4444-4444-4444-444444444444",
            name: "brief.pdf",
            mimeType: "application/pdf",
            fileSize: "10",
            downloadUrl: "/api/files/44444444-4444-4444-4444-444444444444",
          },
          {
            type: "file",
            fileId: "55555555-5555-5555-5555-555555555555",
            name: "image.png",
            mimeType: "image/png",
            fileSize: "20",
            downloadUrl: "/api/files/55555555-5555-5555-5555-555555555555",
          },
        ],
      },
    ])
  })

  it("does not expose the legacy sendMessage mutation anymore", () => {
    const caller = createCaller(
      createContext(
        {
          chat: { findFirst: vi.fn() },
          chatMessage: { findMany: vi.fn() },
        } as unknown as PrismaClient,
      ),
    )

    expect("sendMessage" in caller).toBe(false)
  })
})
