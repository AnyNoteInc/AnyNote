import { jest, describe, it, expect, beforeEach } from "@jest/globals"

import type { PrismaClient } from "@repo/db"

import { WorkspaceMemberGuard } from "./workspace-member.guard.js"

describe("WorkspaceMemberGuard", () => {
  const mockPrisma = {
    workspaceMember: { findUnique: jest.fn<(...a: unknown[]) => Promise<unknown>>() },
  } as unknown as PrismaClient

  let guard: WorkspaceMemberGuard

  beforeEach(() => {
    ;(mockPrisma.workspaceMember.findUnique as jest.Mock).mockReset()
    guard = new WorkspaceMemberGuard(mockPrisma)
  })

  it("allows when member exists", async () => {
    ;(mockPrisma.workspaceMember.findUnique as jest.Mock).mockResolvedValue({
      userId: "u1",
    } as never)
    await expect(guard.assert("w1", "u1")).resolves.toBeUndefined()
  })

  it("throws WorkspaceAccessDeniedError when not a member", async () => {
    ;(mockPrisma.workspaceMember.findUnique as jest.Mock).mockResolvedValue(null as never)
    await expect(guard.assert("w1", "u1")).rejects.toThrow(/access/i)
  })
})
