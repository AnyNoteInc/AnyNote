import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals"
import type { INestApplication } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { prisma } from "@repo/db"
import request from "supertest"

import { AppModule } from "../../src/app.module.js"
import { OutboxDrainerService } from "../../src/apps/indexer/cron/outbox-drainer.service.js"
import { EmbeddingClient } from "../../src/apps/indexer/services/embedding-client.service.js"
import { ProcessingClient } from "../../src/apps/indexer/services/processing-client.service.js"
import { QdrantWriter } from "../../src/apps/indexer/services/qdrant-writer.service.js"
import { QdrantService } from "../../src/infra/qdrant/qdrant.service.js"

jest.setTimeout(60000)

const TEST_VECTOR = Array.from({ length: 768 }, (_, index) => (index === 0 ? 0.1 : 0))

describe("Search e2e", () => {
  let app: INestApplication
  let http: ReturnType<typeof request>
  let qdrant: QdrantService
  let drainer: OutboxDrainerService
  let writer: QdrantWriter

  let workspaceId: string
  let userId: string

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ProcessingClient)
      .useValue({
        normalize: jest.fn(async (text: string) => [text]),
      })
      .overrideProvider(EmbeddingClient)
      .useValue({
        embed: jest.fn(async () => TEST_VECTOR),
      })
      .compile()

    app = moduleRef.createNestApplication()
    await app.init()
    await app.listen(0)

    const server = app.getHttpServer() as import("http").Server
    http = request(server)
    qdrant = app.get(QdrantService)
    drainer = app.get(OutboxDrainerService)
    writer = app.get(QdrantWriter)
    await writer.ensureCollection()
  })

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    const workspace = await prisma.workspace.create({ data: { name: "search-test" } })
    workspaceId = workspace.id

    const user = await prisma.user.create({
      data: {
        name: "Search User",
        firstName: "S",
        lastName: "U",
        email: `search-${workspaceId}@e.com`,
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

  it("indexes a page and returns it from POST /search/pages", async () => {
    const page = await prisma.page.create({
      data: {
        workspaceId,
        title: "RAG retrieval page",
        ownership: "TEXT",
        createdById: userId,
        updatedById: userId,
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "RAG retrieval integration anchor text for semantic search." }],
            },
          ],
        },
      },
    })

    await prisma.outboxEvent.create({
      data: {
        eventType: "page.upserted",
        aggregateType: "page",
        aggregateId: page.id,
        workspaceId,
        payload: {},
      },
    })

    await drainer.drain()
    await waitFor(async () => {
      const points = await qdrant.client.scroll(qdrant.collection, {
        filter: { must: [{ key: "pageId", match: { value: page.id } }] },
        limit: 10,
      })

      expect(points.points.length).toBeGreaterThan(0)
    })

    const response = await http.post("/search/pages").send({
      workspaceId,
      query: "RAG retrieval integration anchor",
      topK: 5,
    })

    expect(response.status).toBe(201)
    expect(response.body.documents).toEqual([
      expect.objectContaining({
        pageId: page.id,
        workspaceId,
        title: "RAG retrieval page",
        chunkIndex: 0,
        pageType: "TEXT",
        createdById: userId,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      }),
    ])
    expect(response.body.documents[0]?.content).toEqual(expect.stringContaining("RAG"))
  })
})

async function waitFor(assertion: () => Promise<void>, attempts = 30, delayMs = 1000): Promise<void> {
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  throw lastError
}
