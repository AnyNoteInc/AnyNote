import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import { EmbeddingConfigService } from './embedding-config.service.js'

describe('EmbeddingConfigService.forWorkspace', () => {
  const findUnique = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const prisma = { workspaceAiSettings: { findUnique } } as unknown as PrismaClient
  let svc: EmbeddingConfigService

  beforeEach(() => {
    jest.clearAllMocks()
    svc = new EmbeddingConfigService(prisma)
  })

  it('builds an embedding payload from the workspace embeddings model', async () => {
    findUnique.mockResolvedValue({
      embeddingsModel: {
        slug: 'text-embedding-3-small',
        vectorSize: 1536,
        provider: { slug: 'openai', connection: { apiKey: 'sk-x' } },
      },
    })

    const result = await svc.forWorkspace('w1')

    expect(result).toEqual({
      provider: 'openai',
      modelSlug: 'text-embedding-3-small',
      vectorSize: 1536,
      connection: { provider: 'openai', apiKey: 'sk-x' },
    })
  })

  it('returns null when no embeddings model is configured', async () => {
    findUnique.mockResolvedValue({ embeddingsModel: null })
    expect(await svc.forWorkspace('w1')).toBeNull()
  })

  it('returns null when vectorSize is missing', async () => {
    findUnique.mockResolvedValue({
      embeddingsModel: { slug: 's', vectorSize: null, provider: { slug: 'openai', connection: {} } },
    })
    expect(await svc.forWorkspace('w1')).toBeNull()
  })
})
