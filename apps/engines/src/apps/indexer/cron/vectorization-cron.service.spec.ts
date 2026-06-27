import { describe, expect, it, jest } from '@jest/globals'

import { encryptSecret } from '@repo/auth/secret-encryption.ts'

import { AgentsClient } from '../services/agents-client.service.js'
import { PageContentReader } from '../services/page-content-reader.service.js'
import { PlanFeaturesService } from '../services/plan-features.service.js'
import { VectorizationCronService } from './vectorization-cron.service.js'

const embeddingsModel = {
  slug: 'nomic-embed-text',
  vectorSize: 768,
  provider: { slug: 'ollama', connection: { baseUrl: 'http://ollama:11434' } },
}

const aiSettingsWithEmbeddings = { embeddingsModel }

function makePrismaMock(opts: { rows: unknown[]; page: unknown; aiSettings?: unknown }) {
  const executeRaw = jest.fn(async () => 1)
  const pageFindUnique = jest.fn(async () => opts.page)
  const workspaceAiSettingsFindUnique = jest.fn(
    async () => opts.aiSettings ?? aiSettingsWithEmbeddings,
  )
  const queryRaw = jest.fn(async () => opts.rows)
  const tx = { $executeRaw: executeRaw, $queryRaw: queryRaw }
  const transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx))
  return {
    $transaction: transaction,
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
    page: { findUnique: pageFindUnique },
    workspaceAiSettings: { findUnique: workspaceAiSettingsFindUnique },
    __mocks: {
      executeRaw,
      pageFindUnique,
      queryRaw,
      transaction,
      workspaceAiSettingsFindUnique,
    },
  }
}

function makePlanFeaturesMock(enabled: boolean): PlanFeaturesService {
  return {
    isPageIndexingEnabled: jest.fn(async () => enabled),
  } as unknown as PlanFeaturesService
}

describe('VectorizationCronService', () => {
  it('no-op when no rows', async () => {
    const prisma = makePrismaMock({ rows: [], page: null })
    const agents = {
      vectorize: jest.fn(async () => undefined),
      deletePageVectors: jest.fn(async () => undefined),
    } as unknown as AgentsClient
    const reader = new PageContentReader()
    const planFeatures = makePlanFeaturesMock(true)
    const svc = new VectorizationCronService(prisma as never, reader, agents, planFeatures)
    await svc.tick()
    expect(agents.vectorize).not.toHaveBeenCalled()
  })

  it('calls agents for TEXT page with blocks on page.upserted', async () => {
    const rows = [
      {
        id: BigInt(1),
        page_id: 'p1',
        workspace_id: 'w1',
        event_type: 'page.upserted',
      },
    ]
    const page = {
      id: 'p1',
      type: 'TEXT',
      deletedAt: null,
      title: 'T',
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
      },
      workspaceId: 'w1',
    }
    const prisma = makePrismaMock({ rows, page })
    const vectorize = jest.fn(async () => undefined)
    const agents = {
      vectorize,
      deletePageVectors: jest.fn(async () => undefined),
    } as unknown as AgentsClient
    const reader = new PageContentReader()
    const planFeatures = makePlanFeaturesMock(true)
    const svc = new VectorizationCronService(prisma as never, reader, agents, planFeatures)
    await svc.tick()
    expect(vectorize).toHaveBeenCalledTimes(1)
    const arg = (
      vectorize.mock.calls[0] as unknown as [{ contents: unknown[]; embedding: unknown }]
    )[0]
    expect(arg.contents).toHaveLength(1)
    expect(arg.embedding).toEqual({
      provider: 'ollama',
      modelSlug: 'nomic-embed-text',
      vectorSize: 768,
      connection: { provider: 'ollama', baseUrl: 'http://ollama:11434' },
    })
  })

  it('decrypts connectionEnc when the plaintext connection is empty (workspace-configured provider)', async () => {
    const rows = [
      {
        id: BigInt(9),
        page_id: 'p9',
        workspace_id: 'w9',
        event_type: 'page.upserted',
      },
    ]
    const page = {
      id: 'p9',
      type: 'TEXT',
      deletedAt: null,
      title: 'T',
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
      },
      workspaceId: 'w9',
    }
    const connectionEnc = encryptSecret(JSON.stringify({ baseUrl: 'http://ollama:11434' }))
    const prisma = makePrismaMock({
      rows,
      page,
      aiSettings: {
        embeddingsModel: {
          ...embeddingsModel,
          provider: {
            slug: 'ollama',
            workspaceId: 'w9',
            connection: {},
            connectionEnc,
          },
        },
      },
    })
    const vectorize = jest.fn(async () => undefined)
    const agents = {
      vectorize,
      deletePageVectors: jest.fn(async () => undefined),
    } as unknown as AgentsClient
    const svc = new VectorizationCronService(
      prisma as never,
      new PageContentReader(),
      agents,
      makePlanFeaturesMock(true),
    )
    await svc.tick()
    expect(vectorize).toHaveBeenCalledTimes(1)
    const arg = (vectorize.mock.calls[0] as unknown as [{ embedding: { connection: unknown } }])[0]
    expect(arg.embedding.connection).toEqual({
      provider: 'ollama',
      baseUrl: 'http://ollama:11434',
    })
  })

  it('marks DONE without vectorizing when page.upserted page is soft-deleted', async () => {
    const rows = [
      {
        id: BigInt(2),
        page_id: 'p2',
        workspace_id: 'w2',
        event_type: 'page.upserted',
      },
    ]
    const page = {
      id: 'p2',
      type: 'TEXT',
      deletedAt: new Date(),
      title: '',
      content: null,
      workspaceId: 'w2',
    }
    const prisma = makePrismaMock({ rows, page })
    const vectorize = jest.fn(async () => undefined)
    const agents = {
      vectorize,
      deletePageVectors: jest.fn(async () => undefined),
    } as unknown as AgentsClient
    const planFeatures = makePlanFeaturesMock(true)
    const svc = new VectorizationCronService(
      prisma as never,
      new PageContentReader(),
      agents,
      planFeatures,
    )
    await svc.tick()
    expect(vectorize).not.toHaveBeenCalled()
    expect(prisma.__mocks.executeRaw).toHaveBeenCalledTimes(3)
  })

  it('deletes vectors on page.deleted event without loading the page or embeddings model', async () => {
    const rows = [
      {
        id: BigInt(3),
        page_id: 'p3',
        workspace_id: 'w3',
        event_type: 'page.deleted',
      },
    ]
    const prisma = makePrismaMock({ rows, page: null, aiSettings: null })
    const vectorize = jest.fn(async () => undefined)
    const deletePageVectors = jest.fn(async () => undefined)
    const agents = { vectorize, deletePageVectors } as unknown as AgentsClient
    const planFeatures = makePlanFeaturesMock(true)
    const svc = new VectorizationCronService(
      prisma as never,
      new PageContentReader(),
      agents,
      planFeatures,
    )
    await svc.tick()
    expect(prisma.__mocks.pageFindUnique).not.toHaveBeenCalled()
    expect(prisma.__mocks.workspaceAiSettingsFindUnique).not.toHaveBeenCalled()
    expect(vectorize).not.toHaveBeenCalled()
    expect(deletePageVectors).toHaveBeenCalledWith('p3')
  })

  it('issues mark-older-as-DONE update inside the claim transaction', async () => {
    const rows = [
      {
        id: BigInt(4),
        page_id: 'p4',
        workspace_id: 'w4',
        event_type: 'page.upserted',
      },
    ]
    const page = {
      id: 'p4',
      type: 'TEXT',
      deletedAt: null,
      title: 'T',
      content: null,
      workspaceId: 'w4',
    }
    const prisma = makePrismaMock({ rows, page })
    const vectorize = jest.fn(async () => undefined)
    const agents = {
      vectorize,
      deletePageVectors: jest.fn(async () => undefined),
    } as unknown as AgentsClient
    const planFeatures = makePlanFeaturesMock(true)
    const svc = new VectorizationCronService(
      prisma as never,
      new PageContentReader(),
      agents,
      planFeatures,
    )
    await svc.tick()
    // claimBatch: 1 SELECT + 2 UPDATE (PROCESSING + collapse-older-to-DONE).
    // processRow: 1 UPDATE (mark current row DONE after success).
    expect(prisma.__mocks.queryRaw).toHaveBeenCalledTimes(1)
    expect(prisma.__mocks.executeRaw).toHaveBeenCalledTimes(3)
  })

  it('skips vectorization and marks row DONE when pageIndexingEnabled is false', async () => {
    const rows = [
      {
        id: BigInt(5),
        page_id: 'p5',
        workspace_id: 'w5',
        event_type: 'page.upserted',
      },
    ]
    const page = {
      id: 'p5',
      type: 'TEXT',
      deletedAt: null,
      title: 'T',
      content: null,
      workspaceId: 'w5',
    }
    const prisma = makePrismaMock({ rows, page })
    const vectorize = jest.fn(async () => undefined)
    const agents = {
      vectorize,
      deletePageVectors: jest.fn(async () => undefined),
    } as unknown as AgentsClient
    const planFeatures = makePlanFeaturesMock(false)
    const svc = new VectorizationCronService(
      prisma as never,
      new PageContentReader(),
      agents,
      planFeatures,
    )
    await svc.tick()
    expect(vectorize).not.toHaveBeenCalled()
    expect(prisma.__mocks.workspaceAiSettingsFindUnique).not.toHaveBeenCalled()
    // claimBatch: 1 SELECT + 2 UPDATE (PROCESSING + collapse-older-to-DONE).
    // processRow skip path: 1 UPDATE (markDone without vectorizing).
    expect(prisma.__mocks.executeRaw).toHaveBeenCalledTimes(3)
  })

  it('skips page.upserted and marks DONE when no embeddings model is selected', async () => {
    const rows = [
      {
        id: BigInt(6),
        page_id: 'p6',
        workspace_id: 'w6',
        event_type: 'page.upserted',
      },
    ]
    const prisma = makePrismaMock({
      rows,
      page: null,
      aiSettings: { embeddingsModel: null },
    })
    const vectorize = jest.fn(async () => undefined)
    const agents = {
      vectorize,
      deletePageVectors: jest.fn(async () => undefined),
    } as unknown as AgentsClient
    const svc = new VectorizationCronService(
      prisma as never,
      new PageContentReader(),
      agents,
      makePlanFeaturesMock(true),
    )
    await svc.tick()
    expect(prisma.__mocks.workspaceAiSettingsFindUnique).toHaveBeenCalledTimes(1)
    expect(prisma.__mocks.pageFindUnique).not.toHaveBeenCalled()
    expect(vectorize).not.toHaveBeenCalled()
    expect(prisma.__mocks.executeRaw).toHaveBeenCalledTimes(3)
  })

  it('skips page.upserted and marks DONE when embeddings model has no vector size', async () => {
    const rows = [
      {
        id: BigInt(7),
        page_id: 'p7',
        workspace_id: 'w7',
        event_type: 'page.upserted',
      },
    ]
    const prisma = makePrismaMock({
      rows,
      page: null,
      aiSettings: {
        embeddingsModel: {
          ...embeddingsModel,
          vectorSize: null,
        },
      },
    })
    const vectorize = jest.fn(async () => undefined)
    const agents = {
      vectorize,
      deletePageVectors: jest.fn(async () => undefined),
    } as unknown as AgentsClient
    const svc = new VectorizationCronService(
      prisma as never,
      new PageContentReader(),
      agents,
      makePlanFeaturesMock(true),
    )
    await svc.tick()
    expect(prisma.__mocks.pageFindUnique).not.toHaveBeenCalled()
    expect(vectorize).not.toHaveBeenCalled()
    expect(prisma.__mocks.executeRaw).toHaveBeenCalledTimes(3)
  })

  it('retries page.upserted when provider connection parsing fails', async () => {
    const rows = [
      {
        id: BigInt(8),
        page_id: 'p8',
        workspace_id: 'w8',
        event_type: 'page.upserted',
      },
    ]
    const page = {
      id: 'p8',
      type: 'TEXT',
      deletedAt: null,
      title: 'T',
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
      },
      workspaceId: 'w8',
    }
    const prisma = makePrismaMock({
      rows,
      page,
      aiSettings: {
        embeddingsModel: {
          ...embeddingsModel,
          provider: { slug: 'ollama', connection: {} },
        },
      },
    })
    const vectorize = jest.fn(async () => undefined)
    const agents = {
      vectorize,
      deletePageVectors: jest.fn(async () => undefined),
    } as unknown as AgentsClient
    const svc = new VectorizationCronService(
      prisma as never,
      new PageContentReader(),
      agents,
      makePlanFeaturesMock(true),
    )
    await svc.tick()
    expect(vectorize).not.toHaveBeenCalled()
    expect(prisma.__mocks.executeRaw).toHaveBeenCalledTimes(3)
  })
})
