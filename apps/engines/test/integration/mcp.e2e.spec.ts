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

  it("rejects missing auth header with 401", async () => {
    const res = await http
      .post("/mcp")
      .send({ jsonrpc: "2.0", method: "tools/list", id: 1 })
      .set("Content-Type", "application/json")
    expect(res.status).toBe(401)
  })

  it("lists tools with valid auth", async () => {
    const res = await http
      .post("/mcp")
      .send({ jsonrpc: "2.0", method: "tools/list", id: 1 })
      .set("Content-Type", "application/json")
      .set("Accept", "application/json, text/event-stream")
      .set("Authorization", "Bearer test-token")
    expect(res.status).toBe(200)
    expect(res.body.result?.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "createPage" })]),
    )
  })

  it("creates page via MCP tool call", async () => {
    const res = await http
      .post("/mcp")
      .send({
        jsonrpc: "2.0",
        method: "tools/call",
        id: 2,
        params: {
          name: "createPage",
          arguments: { userId, workspaceId, title: "MCP Page" },
        },
      })
      .set("Content-Type", "application/json")
      .set("Accept", "application/json, text/event-stream")
      .set("Authorization", "Bearer test-token")
    expect(res.status).toBe(200)
    const content = res.body.result?.content?.[0]?.text ?? JSON.stringify(res.body)
    const payload = JSON.parse(content)
    expect(payload.pageId).toBeDefined()

    const created = await prisma.page.findUnique({ where: { id: payload.pageId } })
    expect(created?.title).toBe("MCP Page")
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
        .post("/mcp")
        .send({
          jsonrpc: "2.0",
          method: "tools/call",
          id: 3,
          params: {
            name: "createPage",
            arguments: { userId: otherUser.id, workspaceId, title: "Denied" },
          },
        })
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("Authorization", "Bearer test-token")
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
