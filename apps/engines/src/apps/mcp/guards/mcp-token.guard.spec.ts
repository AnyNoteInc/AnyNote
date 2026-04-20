import { describe, it, expect, beforeEach } from "@jest/globals"

import type { ExecutionContext } from "@nestjs/common"

import { McpTokenGuard } from "./mcp-token.guard.js"

function makeCtx(authHeader?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: authHeader ? { authorization: authHeader } : {} }),
    }),
  } as ExecutionContext
}

describe("McpTokenGuard", () => {
  beforeEach(() => {
    process.env.ENGINES_MCP_TOKEN = "sekret"
  })

  it("allows valid bearer token", () => {
    const guard = new McpTokenGuard()
    expect(guard.canActivate(makeCtx("Bearer sekret"))).toBe(true)
  })

  it("denies missing header", () => {
    const guard = new McpTokenGuard()
    expect(() => guard.canActivate(makeCtx(undefined))).toThrow(/unauthorized/i)
  })

  it("denies wrong token", () => {
    const guard = new McpTokenGuard()
    expect(() => guard.canActivate(makeCtx("Bearer nope"))).toThrow(/unauthorized/i)
  })

  it("denies missing Bearer prefix", () => {
    const guard = new McpTokenGuard()
    expect(() => guard.canActivate(makeCtx("sekret"))).toThrow(/unauthorized/i)
  })
})
