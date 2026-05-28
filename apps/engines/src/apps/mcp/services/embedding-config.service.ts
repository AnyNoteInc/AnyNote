import { Inject, Injectable } from '@nestjs/common'
import { parseAiProviderConnection, type AiProviderConnection, type PrismaClient } from '@repo/db'

import { PRISMA } from '../../../infra/db/db.providers.js'

export type EmbeddingPayload = {
  provider: 'ollama' | 'openai' | 'gigachat'
  modelSlug: string
  vectorSize: number
  connection: AiProviderConnection
}

@Injectable()
export class EmbeddingConfigService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async forWorkspace(workspaceId: string): Promise<EmbeddingPayload | null> {
    const ai = await this.prisma.workspaceAiSettings.findUnique({
      where: { workspaceId },
      select: {
        embeddingsModel: {
          select: {
            slug: true,
            vectorSize: true,
            provider: { select: { slug: true, connection: true } },
          },
        },
      },
    })
    const model = ai?.embeddingsModel
    if (!model || model.vectorSize === null) return null
    return {
      provider: model.provider.slug as EmbeddingPayload['provider'],
      modelSlug: model.slug,
      vectorSize: model.vectorSize,
      connection: parseAiProviderConnection(model.provider.slug, model.provider.connection),
    }
  }
}
