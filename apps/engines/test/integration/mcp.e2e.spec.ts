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
  let rpcId = 100
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

  async function callTool(
    name: string,
    args: Record<string, unknown>,
    currentUserId = userId,
  ) {
    return http
      .post("/api/mcp")
      .send({
        jsonrpc: "2.0",
        method: "tools/call",
        id: rpcId++,
        params: { name, args },
      })
      .set("Content-Type", "application/json")
      .set("Accept", "application/json, text/event-stream")
      .set("X-User-Id", currentUserId)
      .set("x-Workspace-Id", workspaceId)
  }

  function parseToolPayload(res: request.Response) {
    expect(res.status).toBe(200)
    const content = res.body.result?.content?.[0]?.text ?? JSON.stringify(res.body)
    return JSON.parse(content)
  }

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

  it("accepts pageId embedded in a natural-language argument string", async () => {
    const page = await prisma.page.create({
      data: {
        workspaceId,
        title: "Natural id page",
        createdById: userId,
        updatedById: userId,
      },
    })

    const res = await http
      .post("/api/mcp")
      .send({
        jsonrpc: "2.0",
        method: "tools/call",
        id: 22,
        params: {
          name: "getPageStats",
          args: { pageId: `pageId = ${page.id}` },
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

  it("accepts pageId embedded in a Russian creator question", async () => {
    const page = await prisma.page.create({
      data: {
        workspaceId,
        title: "Russian creator question page",
        createdById: userId,
        updatedById: userId,
      },
    })

    const res = await callTool("getPageStats", {
      pageId: `кто создал страницу ${page.id}`,
    })

    const payload = parseToolPayload(res)
    expect(payload).toEqual(
      expect.objectContaining({
        type: "TEXT",
        ownership: "TEXT",
        createdBy: expect.objectContaining({ id: userId }),
      }),
    )
  })

  it("returns expected payloads for remaining read tools", async () => {
    const markdownPage = await prisma.page.create({
      data: {
        workspaceId,
        title: "Markdown page",
        ownership: "TEXT",
        createdById: userId,
        updatedById: userId,
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Привет markdown" }],
            },
          ],
        },
      },
    })
    const skillPage = await prisma.page.create({
      data: {
        workspaceId,
        title: "Skill page",
        ownership: "SKILL",
        createdById: userId,
        updatedById: userId,
      },
    })
    const agentPage = await prisma.page.create({
      data: {
        workspaceId,
        title: "Agent page",
        ownership: "AGENT",
        createdById: userId,
        updatedById: userId,
      },
    })
    const file = await prisma.file.create({
      data: {
        userId,
        workspaceId,
        name: "notes.txt",
        ext: "txt",
        fileSize: BigInt(12),
        mimeType: "text/plain",
        hash: "a".repeat(64),
        path: "test/notes.txt",
        status: "ACTIVE",
      },
    })
    await prisma.pageFile.create({
      data: { pageId: markdownPage.id, fileId: file.id },
    })

    const workspaceStats = parseToolPayload(await callTool("getWorkspaceStats", {}))
    expect(workspaceStats).toEqual(
      expect.objectContaining({
        totalPages: 3,
        pagesByType: expect.objectContaining({ TEXT: 3 }),
        members: expect.arrayContaining([
          expect.objectContaining({
            id: userId,
            role: "OWNER",
          }),
        ]),
      }),
    )

    const markdown = parseToolPayload(
      await callTool("getPageMarkdown", { pageId: `pageId = ${markdownPage.id}` }),
    )
    expect(markdown).toEqual({ markdown: "Привет markdown" })

    const workspaceFiles = parseToolPayload(await callTool("listWorkspaceFiles", { limit: 10, offset: 0 }))
    expect(workspaceFiles).toEqual(
      expect.objectContaining({
        files: expect.arrayContaining([
          expect.objectContaining({
            id: file.id,
            name: "notes.txt",
            mimeType: "text/plain",
            size: 12,
          }),
        ]),
      }),
    )

    const skills = parseToolPayload(await callTool("listSkills", { limit: 10 }))
    expect(skills).toEqual(
      expect.objectContaining({
        pages: expect.arrayContaining([
          expect.objectContaining({
            id: skillPage.id,
            title: "Skill page",
          }),
        ]),
      }),
    )

    const agents = parseToolPayload(await callTool("listAgents", { limit: 10 }))
    expect(agents).toEqual(
      expect.objectContaining({
        pages: expect.arrayContaining([
          expect.objectContaining({
            id: agentPage.id,
            title: "Agent page",
          }),
        ]),
      }),
    )

    const pageFiles = parseToolPayload(
      await callTool("listPageFiles", { pageId: `pageId = ${markdownPage.id}` }),
    )
    expect(pageFiles).toEqual(
      expect.objectContaining({
        files: expect.arrayContaining([
          expect.objectContaining({
            id: file.id,
            name: "notes.txt",
            mimeType: "text/plain",
            size: 12,
          }),
        ]),
      }),
    )
  })

  it("applies defaults when MCP tool caller sends null pagination values", async () => {
    const skillPage = await prisma.page.create({
      data: {
        workspaceId,
        title: "Skill with null limit",
        ownership: "SKILL",
        createdById: userId,
        updatedById: userId,
      },
    })
    const agentPage = await prisma.page.create({
      data: {
        workspaceId,
        title: "Agent with null limit",
        ownership: "AGENT",
        createdById: userId,
        updatedById: userId,
      },
    })
    const file = await prisma.file.create({
      data: {
        userId,
        workspaceId,
        name: "null-defaults.txt",
        ext: "txt",
        fileSize: BigInt(16),
        mimeType: "text/plain",
        hash: "d".repeat(64),
        path: "test/null-defaults.txt",
        status: "ACTIVE",
      },
    })

    const workspaceFiles = parseToolPayload(
      await callTool("listWorkspaceFiles", { limit: null, offset: null }),
    )
    expect(workspaceFiles).toEqual(
      expect.objectContaining({
        files: expect.arrayContaining([
          expect.objectContaining({
            id: file.id,
            name: "null-defaults.txt",
          }),
        ]),
      }),
    )

    const skills = parseToolPayload(await callTool("listSkills", { limit: null }))
    expect(skills).toEqual(
      expect.objectContaining({
        pages: expect.arrayContaining([
          expect.objectContaining({
            id: skillPage.id,
            title: "Skill with null limit",
          }),
        ]),
      }),
    )

    const agents = parseToolPayload(await callTool("listAgents", { limit: null }))
    expect(agents).toEqual(
      expect.objectContaining({
        pages: expect.arrayContaining([
          expect.objectContaining({
            id: agentPage.id,
            title: "Agent with null limit",
          }),
        ]),
      }),
    )
  })

  it("returns expected payloads for remaining mutation tools", async () => {
    const sourceParent = await prisma.page.create({
      data: {
        workspaceId,
        title: "Source parent",
        createdById: userId,
        updatedById: userId,
      },
    })
    const destinationParent = await prisma.page.create({
      data: {
        workspaceId,
        title: "Destination parent",
        createdById: userId,
        updatedById: userId,
      },
    })
    const previousPage = await prisma.page.create({
      data: {
        workspaceId,
        parentId: destinationParent.id,
        title: "Previous page",
        createdById: userId,
        updatedById: userId,
      },
    })
    const textFile = await prisma.file.create({
      data: {
        userId,
        workspaceId,
        name: "doc.txt",
        ext: "txt",
        fileSize: BigInt(24),
        mimeType: "text/plain",
        hash: "b".repeat(64),
        path: "test/doc.txt",
        status: "ACTIVE",
      },
    })
    const imageFile = await prisma.file.create({
      data: {
        userId,
        workspaceId,
        name: "image.png",
        ext: "png",
        fileSize: BigInt(48),
        mimeType: "image/png",
        hash: "c".repeat(64),
        path: "test/image.png",
        status: "ACTIVE",
      },
    })

    const created = parseToolPayload(
      await callTool("createPage", {
        parentId: `parentId = ${sourceParent.id}`,
        title: "Created page",
        ownership: "AGENT",
      }),
    )
    expect(created).toEqual({ pageId: expect.any(String) })

    const createdPage = await prisma.page.findUniqueOrThrow({
      where: { id: created.pageId as string },
    })
    expect(createdPage.parentId).toBe(sourceParent.id)
    expect(createdPage.ownership).toBe("AGENT")

    const createdWithNullOwnership = parseToolPayload(
      await callTool("createPage", {
        title: "Created page with null ownership",
        ownership: null,
      }),
    )
    expect(createdWithNullOwnership).toEqual({ pageId: expect.any(String) })

    await expect(
      prisma.page.findUniqueOrThrow({
        where: { id: createdWithNullOwnership.pageId as string },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        title: "Created page with null ownership",
        ownership: "TEXT",
      }),
    )

    const updated = parseToolPayload(
      await callTool("updatePage", {
        pageId: `pageId = ${created.pageId as string}`,
        title: "Updated page",
      }),
    )
    expect(updated).toEqual({ ok: true })
    await expect(
      prisma.page.findUniqueOrThrow({ where: { id: created.pageId as string } }),
    ).resolves.toEqual(expect.objectContaining({ title: "Updated page" }))

    const moved = parseToolPayload(
      await callTool("movePage", {
        pageId: `pageId = ${created.pageId as string}`,
        newParentId: `newParentId = ${destinationParent.id}`,
        prevPageId: `prevPageId = ${previousPage.id}`,
      }),
    )
    expect(moved).toEqual({ ok: true })
    await expect(
      prisma.page.findUniqueOrThrow({ where: { id: created.pageId as string } }),
    ).resolves.toEqual(
      expect.objectContaining({
        parentId: destinationParent.id,
        prevPageId: previousPage.id,
      }),
    )

    const attachedFile = parseToolPayload(
      await callTool("attachFileToPage", {
        pageId: `pageId = ${created.pageId as string}`,
        fileId: `fileId = ${textFile.id}`,
      }),
    )
    expect(attachedFile).toEqual({ ok: true })

    const attachedImage = parseToolPayload(
      await callTool("attachImageToPage", {
        pageId: `pageId = ${created.pageId as string}`,
        fileId: `fileId = ${imageFile.id}`,
      }),
    )
    expect(attachedImage).toEqual({ ok: true })

    const pageFromFile = parseToolPayload(
      await callTool("createPageFromFile", {
        parentId: `parentId = ${destinationParent.id}`,
        fileId: `fileId = ${textFile.id}`,
        title: "Page from file",
      }),
    )
    expect(pageFromFile).toEqual({ pageId: expect.any(String) })

    await expect(
      prisma.page.findUniqueOrThrow({ where: { id: pageFromFile.pageId as string } }),
    ).resolves.toEqual(
      expect.objectContaining({
        parentId: destinationParent.id,
        title: "Page from file",
      }),
    )
    await expect(
      prisma.pageFile.findUnique({
        where: {
          pageId_fileId: {
            pageId: pageFromFile.pageId as string,
            fileId: textFile.id,
          },
        },
      }),
    ).resolves.toBeTruthy()
  })

  it("returns FILE_NOT_FOUND when createPageFromFile source file is missing", async () => {
    const missingFileId = "11111111-1111-4111-8111-111111111111"

    const res = await callTool("createPageFromFile", {
      fileId: `fileId = ${missingFileId}`,
      title: "Should fail",
    })

    const bodyText = JSON.stringify(res.body)
    expect(bodyText).toMatch(/FILE_NOT_FOUND/i)
    expect(res.body?.result?.isError).toBe(true)
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
