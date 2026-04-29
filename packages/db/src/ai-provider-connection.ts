import { z } from 'zod'

export const AiProviderConnectionSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('ollama'),
    baseUrl: z.string().url(),
  }),
  z.object({
    provider: z.literal('openai'),
    apiKey: z.string().min(1),
    organization: z.string().optional(),
    baseUrl: z.string().url().optional(),
  }),
  z.object({
    provider: z.literal('gigachat'),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    scope: z.string().optional(),
  }),
])

export type AiProviderConnection = z.infer<typeof AiProviderConnectionSchema>

const KNOWN_PROVIDERS = ['ollama', 'openai', 'gigachat'] as const

export function parseAiProviderConnection(
  providerSlug: string,
  raw: unknown,
): AiProviderConnection {
  if (!KNOWN_PROVIDERS.includes(providerSlug as (typeof KNOWN_PROVIDERS)[number])) {
    throw new Error(`unknown provider: ${providerSlug}`)
  }

  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const merged = { ...obj, provider: providerSlug }

  return AiProviderConnectionSchema.parse(merged)
}
