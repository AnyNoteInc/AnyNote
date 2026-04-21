import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals"
import type { INestApplication } from "@nestjs/common"
import { NestFactory } from "@nestjs/core"
import { prisma } from "@repo/db"
import request from "supertest"

import { AppModule } from "../../src/app.module.js"

jest.setTimeout(30000)

describe("MCP e2e", () => {
  let app: INestApplication
  let http: ReturnType<typeof request>
  let workspaceId: string
  let userId: string

  beforeAll(async () => {
    process.env.ENGINES_MCP_TOKEN = "test-token"
    app = await NestFactory.create(AppModule, { logger: false })
    app.setGlobalPrefix("api")
    await app.init()
    await app.listen(0)
    const server = app.getHttpServer() as import("http").Server
    http = request(server)
  })

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    const ws = await prisma.workspace.create({ data: { name: "mcp-test" } })
    workspaceId = ws.id
    const user = await prisma.user.create({
      data: {
        name: "Mcp User",
        firstName: "M",
        lastName: "U",
        email: `mcp-${workspaceId}@e.com`,
        emailVerified: true,
      },
    })
    userId = user.id
    await prisma.workspaceMember.create({ data: { workspaceId, userId, role: "OWNER" } })
  })

  afterEach(async () => {
    await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined)
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined)
  })

  it("rejects missing identity headers with 401", async () => {
    const res = await http
      .post("/api/mcp")
      .send({ jsonrpc: "2.0", method: "tools/list", id: 1 })
      .set("Content-Type", "application/json")
      .set("Accept", "application/json, text/event-stream")
    expect(res.status).toBe(401)
  })

  it("lists tools with valid workspace headers and hides header-derived context fields", async () => {
    const res = await http
      .post("/api/mcp")
      .send({ jsonrpc: "2.0", method: "tools/list", id: 1 })
      .set("Content-Type", "application/json")
      .set("Accept", "application/json, text/event-stream")
      .set("X-User-Id", userId)
      .set("x-Workspace-Id", workspaceId)

    expect(res.status).toBe(200)
    expect(res.body.result?.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "createPage" })]),
    )

    const getPageStats = (
      res.body.result?.tools as
        | Array<{ name?: string; inputSchema?: { properties?: Record<string, unknown>; required?: string[] } }>
        | undefined
    )?.find((tool) => tool.name === "getPageStats")

    expect(getPageStats).toBeDefined()
    expect(getPageStats?.inputSchema?.properties).toEqual(
      expect.objectContaining({ pageId: expect.any(Object) }),
    )
    expect(getPageStats?.inputSchema?.properties).not.toHaveProperty("userId")
    expect(getPageStats?.inputSchema?.properties).not.toHaveProperty("workspaceId")
    expect(getPageStats?.inputSchema?.required ?? []).toEqual(expect.arrayContaining(["pageId"]))
  })

  it("returns page stats via header-based tool call using params.args", async () => {
    const page = await prisma.page.create({
      data: {
        workspaceId,
        title: "Stats page",
        createdById: userId,
        updatedById: userId,
      },
    })

    const res = await http
      .post("/api/mcp")
      .send({
        jsonrpc: "2.0",
        method: "tools/call",
        id: 2,
        params: {
          name: "getPageStats",
          args: { pageId: page.id },
        },
      })
      .set("Content-Type", "application/json")
      .set("Accept", "application/json, text/event-stream")
      .set("X-User-Id", userId)
      .set("x-Workspace-Id", workspaceId)

    expect(res.status).toBe(200)
    const content = res.body.result?.content?.[0]?.text ?? JSON.stringify(res.body)
    const payload = JSON.parse(content)
    expect(payload).toEqual(
      expect.objectContaining({
        type: "TEXT",
        ownership: "TEXT",
        createdBy: expect.objectContaining({ id: userId }),
      }),
    )
  })

  it("rejects non-member with WORKSPACE_ACCESS_DENIED", async () => {
    const otherUser = await prisma.user.create({
      data: {
        name: "Other User",
        firstName: "X",
        lastName: "Y",
        email: `other-${workspaceId}@e.com`,
        emailVerified: true,
      },
    })
    try {
      const res = await http
        .post("/api/mcp")
        .send({
          jsonrpc: "2.0",
          method: "tools/call",
          id: 3,
          params: {
            name: "createPage",
            args: { title: "Denied" },
          },
        })
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("X-User-Id", otherUser.id)
        .set("x-Workspace-Id", workspaceId)

      // @rekog/mcp-nest surfaces HttpException.message through the MCP tool-call error text;
      // the "code" property is not preserved, only the human message string.
      const bodyText = JSON.stringify(res.body)
      expect(bodyText).toMatch(/not a member of workspace/)
      expect(res.body?.result?.isError).toBe(true)
    } finally {
      await prisma.user.delete({ where: { id: otherUser.id } }).catch(() => undefined)
    }
  })
})
