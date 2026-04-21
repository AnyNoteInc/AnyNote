import { beforeEach, describe, expect, it, jest } from "@jest/globals"
import type { ExecutionContext } from "@nestjs/common"
import type { PrismaClient } from "@repo/db"

import { McpTokenGuard } from "./mcp-token.guard.js"

function makeCtx(request: { headers?: Record<string, string | undefined>; body?: unknown }): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext
}

describe("McpTokenGuard", () => {
  let prisma: PrismaClient
  let guard: McpTokenGuard

  beforeEach(() => {
    prisma = {
      workspaceMember: {
        findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({
          userId: "019da937-08fb-74c9-bccf-d0d161ac8d85",
        } as never),
      },
    } as unknown as PrismaClient
    guard = new McpTokenGuard(prisma)
  })

  it("allows valid identity headers", async () => {
    await expect(
      guard.canActivate(
        makeCtx({
          headers: {
            "x-user-id": "019da937-08fb-74c9-bccf-d0d161ac8d85",
            "x-workspace-id": "21ab1e33-ac0d-4f03-8f63-8f3f830b0cc1",
          },
        }),
      ),
    ).resolves.toBe(true)
  })

  it("denies missing user header", async () => {
    await expect(
      guard.canActivate(
        makeCtx({
          headers: {
            "x-workspace-id": "21ab1e33-ac0d-4f03-8f63-8f3f830b0cc1",
          },
        }),
      ),
    ).rejects.toThrow(/missing X-User-Id/i)
  })

  it("normalizes params.args into params.arguments", async () => {
    const request = {
      headers: {
        "x-user-id": "019da937-08fb-74c9-bccf-d0d161ac8d85",
        "x-workspace-id": "21ab1e33-ac0d-4f03-8f63-8f3f830b0cc1",
      },
      body: {
        method: "tools/call",
        params: {
          name: "getPageStats",
          args: { pageId: "b040f19a-3c27-499c-8ae0-8e4d5c3279cd" },
        },
      },
    }

    await guard.canActivate(makeCtx(request))

    expect((request.body as { params: { arguments?: unknown } }).params.arguments).toEqual({
      pageId: "b040f19a-3c27-499c-8ae0-8e4d5c3279cd",
    })
  })

  it("checks workspace membership for tools/list requests", async () => {
    await guard.canActivate(
      makeCtx({
        headers: {
          "x-user-id": "019da937-08fb-74c9-bccf-d0d161ac8d85",
          "x-workspace-id": "21ab1e33-ac0d-4f03-8f63-8f3f830b0cc1",
        },
        body: { method: "tools/list" },
      }),
    )

    expect(prisma.workspaceMember.findUnique).toHaveBeenCalledWith({
      where: {
        workspaceId_userId: {
          workspaceId: "21ab1e33-ac0d-4f03-8f63-8f3f830b0cc1",
          userId: "019da937-08fb-74c9-bccf-d0d161ac8d85",
        },
      },
      select: { userId: true },
    })
  })
})
