import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { prisma } from '@repo/db'

import { AppModule } from '../../src/app.module.js'
import { OutboxDrainerService } from '../../src/apps/indexer/cron/outbox-drainer.service.js'
import { EmbeddingClient } from '../../src/apps/indexer/services/embedding-client.service.js'
import { ProcessingClient } from '../../src/apps/indexer/services/processing-client.service.js'
import { QdrantWriter } from '../../src/apps/indexer/services/qdrant-writer.service.js'
import { QdrantService } from '../../src/infra/qdrant/qdrant.service.js'

jest.setTimeout(60000)

const TEST_VECTOR = Array.from({ length: 768 }, (_, index) => (index === 0 ? 0.1 : 0))

describe('Indexing e2e', () => {
  let app: INestApplication
  let qdrant: QdrantService
  let drainer: OutboxDrainerService
  let writer: QdrantWriter

  let workspaceId: string
  let userId: string
  let pageId: string

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
    const ws = await prisma.workspace.create({ data: { name: 'test-ws' } })
    workspaceId = ws.id
    const user = await prisma.user.create({
      data: {
        name: 'Test User',
        firstName: 'T',
        lastName: 'U',
        email: `t-${workspaceId}@e.com`,
        emailVerified: true,
      },
    })
    userId = user.id
    await prisma.workspaceMember.create({ data: { workspaceId, userId, role: 'OWNER' } })
  })

  afterEach(async () => {
    if (workspaceId) {
      await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined)
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined)
    }
  })

  it('drains outbox to BullMQ and writes Qdrant points', async () => {
    const page = await prisma.page.create({
      data: {
        workspaceId,
        title: 'Hello',
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
        },
        createdById: userId,
        updatedById: userId,
      },
    })
    pageId = page.id

    await prisma.outboxEvent.create({
      data: {
        eventType: 'page.upserted',
        aggregateType: 'page',
        aggregateId: pageId,
        workspaceId,
        payload: {},
      },
    })

    // Manually invoke drainer (bypasses the 5s schedule)
    await drainer.drain()

    // Wait for BullMQ worker to process
    await new Promise((r) => setTimeout(r, 15000))

    const done = await prisma.outboxEvent.findFirst({
      where: { aggregateId: pageId, status: 'DONE' },
    })
    expect(done).toBeTruthy()

    const points = await qdrant.client.scroll(qdrant.collection, {
      filter: { must: [{ key: 'pageId', match: { value: pageId } }] },
      limit: 10,
    })
    expect(points.points.length).toBeGreaterThan(0)
  })
})
