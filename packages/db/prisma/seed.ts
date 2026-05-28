import { config } from 'dotenv'
import { PrismaClient, Prisma, AiProviderKind } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

config({ path: '../../.env' })

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is not set.')
}

const adapter = new PrismaPg({
  connectionString: databaseUrl,
})

const prisma = new PrismaClient({
  adapter,
})

const providers = [
  {
    slug: 'yandex',
    name: 'Yandex',
    scope: 'USER' as const,
    sortOrder: 10,
    description: 'Личный аккаунт Яндекс (диск, почта, календарь)',
  },
  {
    slug: 'github',
    name: 'GitHub',
    scope: 'USER' as const,
    sortOrder: 20,
    description: 'Личный GitHub — репозитории, issues, PR',
  },
  {
    slug: 'telegram',
    name: 'Telegram',
    scope: 'USER' as const,
    sortOrder: 30,
    description: 'Личный Telegram для уведомлений',
  },
  {
    slug: 'amocrm',
    name: 'AmoCRM',
    scope: 'WORKSPACE' as const,
    sortOrder: 40,
    description: 'CRM для workspace — сделки, контакты',
  },
  {
    slug: 'mango_office',
    name: 'MangoOffice',
    scope: 'WORKSPACE' as const,
    sortOrder: 50,
    description: 'Облачная телефония MangoOffice',
  },
]

const plans = [
  {
    slug: 'personal',
    name: 'Персональный',
    description: 'Для личного пользования',
    priceMonthlyKopecks: 0,
    priceYearlyKopecks: 0,
    currency: 'RUB',
    maxWorkspaces: 1,
    maxMembersPerWorkspace: 1,
    maxFileBytes: BigInt(524_288_000),
    chatsEnabled: false,
    pageIndexingEnabled: false,
    membersSettingsEnabled: false,
    aiSettingsEnabled: false,
    customMcpEnabled: false,
    customAiProvidersEnabled: false,
    prioritySupport: false,
    developerSpaceEnabled: false,
    features: [
      '1 рабочее пространство',
      '1 участник',
      'До 500 МБ файлов',
      'Базовый редактор',
      'Без AI и индексации',
    ],
    sortOrder: 1,
    isActive: true,
  },
  {
    slug: 'pro',
    name: 'ПРО',
    description: 'Для продвинутых пользователей',
    priceMonthlyKopecks: 39_000,
    priceYearlyKopecks: 390_000,
    currency: 'RUB',
    maxWorkspaces: 3,
    maxMembersPerWorkspace: 5,
    maxFileBytes: BigInt(5_368_709_120),
    chatsEnabled: true,
    pageIndexingEnabled: true,
    membersSettingsEnabled: true,
    aiSettingsEnabled: true,
    customMcpEnabled: false,
    customAiProvidersEnabled: false,
    prioritySupport: false,
    developerSpaceEnabled: false,
    features: [
      '3 рабочих пространства',
      'До 5 участников в каждом',
      'До 5 ГБ файлов в каждом',
      'Чаты с AI',
      'Индексация страниц',
      'GigaChat-2 и GigaChat-2 Pro',
    ],
    sortOrder: 2,
    isActive: true,
  },
  {
    slug: 'max',
    name: 'МАКС',
    description: 'Для команд и больших задач',
    priceMonthlyKopecks: 590_000,
    priceYearlyKopecks: 5_900_000,
    currency: 'RUB',
    maxWorkspaces: 10,
    maxMembersPerWorkspace: 20,
    maxFileBytes: BigInt(21_474_836_480),
    chatsEnabled: true,
    pageIndexingEnabled: true,
    membersSettingsEnabled: true,
    aiSettingsEnabled: true,
    customMcpEnabled: true,
    customAiProvidersEnabled: true,
    prioritySupport: true,
    developerSpaceEnabled: true,
    features: [
      'До 10 рабочих пространств',
      'До 20 участников в каждом',
      'До 20 ГБ файлов в каждом',
      'Индексация страниц',
      'Собственные LLM-модели',
      'Кастомные MCP-серверы',
      'Приоритетная поддержка',
      'Доступ к пространству разработчиков',
    ],
    sortOrder: 3,
    isActive: true,
  },
] as const

const canonicalPlanSlugs = plans.map((plan) => plan.slug)

async function main() {
  for (const p of providers) {
    await prisma.integrationProvider.upsert({
      where: { slug: p.slug },
      create: p,
      update: { name: p.name, description: p.description, scope: p.scope, sortOrder: p.sortOrder },
    })
  }
  for (const p of plans) {
    await prisma.plan.upsert({
      where: { slug: p.slug },
      create: { ...p, features: p.features as unknown as Prisma.InputJsonValue },
      update: { ...p, features: p.features as unknown as Prisma.InputJsonValue },
    })
  }
  await prisma.plan.updateMany({
    where: { slug: { notIn: canonicalPlanSlugs } },
    data: { isActive: false },
  })
  // ── AI providers ──────────────────────────────────────────────────────────
  const aiProviders = [
    {
      slug: 'gigachat',
      name: 'GigaChat',
      kind: AiProviderKind.GIGACHAT,
      connection: {
        clientId: '019da3de-19e1-7f92-a0e1-5b90595c8e6c',
        clientSecret: 'e0762394-8b7c-48d4-84ea-dd3e4e57420b',
        scope: 'GIGACHAT_API_PERS',
      } satisfies Prisma.InputJsonValue,
    },
    {
      slug: 'ollama',
      name: 'Ollama',
      kind: AiProviderKind.OLLAMA,
      connection: {
        baseUrl: 'http://localhost:11434',
      } satisfies Prisma.InputJsonValue,
    },
    {
      slug: 'openai',
      name: 'OpenAI',
      kind: AiProviderKind.OPENAI,
      connection: {
        apiKey: process.env.OPENAI_API_KEY ?? '',
      } satisfies Prisma.InputJsonValue,
    },
  ]

  async function upsertGlobalProvider(p: {
    slug: string
    name: string
    kind: AiProviderKind
    connection: Prisma.InputJsonValue
  }) {
    const hasOpenAiApiKey = p.slug === 'openai' && (p.connection as { apiKey?: string }).apiKey !== ''
    const shouldUpdateConnection = p.slug !== 'openai' || hasOpenAiApiKey

    const existing = await prisma.aiProvider.findFirst({ where: { slug: p.slug, workspaceId: null } })
    if (existing) {
      return prisma.aiProvider.update({
        where: { id: existing.id },
        data: {
          name: p.name,
          kind: p.kind,
          ...(shouldUpdateConnection ? { connection: p.connection } : {}),
          isActive: true,
        },
      })
    }
    return prisma.aiProvider.create({
      data: { slug: p.slug, name: p.name, kind: p.kind, connection: p.connection, workspaceId: null, isActive: true },
    })
  }

  const providerRows = await Promise.all(aiProviders.map((p) => upsertGlobalProvider(p)))

  const providerBySlug = new Map(providerRows.map((r) => [r.slug, r]))

  // ── AI models ─────────────────────────────────────────────────────────────
  const gigachatModelSlugs = [
    'gigachat-2',
    'gigachat-2-pro',
    'gigachat-2-max',
    'embeddings',
  ] as const
  const aiModels = [
    {
      providerSlug: 'gigachat',
      slug: 'gigachat-2',
      displayName: 'GigaChat-2',
      contextTokens: 32000,
      supportsVision: false,
      supportsEmbeddings: false,
      vectorSize: null,
      minPlanSlug: 'pro',
    },
    {
      providerSlug: 'gigachat',
      slug: 'gigachat-2-pro',
      displayName: 'GigaChat-2 Pro',
      contextTokens: 32000,
      supportsVision: false,
      supportsEmbeddings: false,
      vectorSize: null,
      minPlanSlug: 'pro',
    },
    {
      providerSlug: 'gigachat',
      slug: 'gigachat-2-max',
      displayName: 'GigaChat-2 Max',
      contextTokens: 64000,
      supportsVision: false,
      supportsEmbeddings: false,
      vectorSize: null,
      minPlanSlug: 'max',
    },
    {
      providerSlug: 'ollama',
      slug: 'gemma4',
      displayName: 'Gemma 4 (Ollama)',
      contextTokens: 8192,
      supportsVision: false,
      supportsEmbeddings: false,
      vectorSize: null,
      minPlanSlug: null,
    },
    {
      providerSlug: 'ollama',
      slug: 'nomic-embed-text',
      displayName: 'Nomic Embed Text (Ollama)',
      contextTokens: 0,
      supportsVision: false,
      supportsEmbeddings: true,
      vectorSize: 768,
      minPlanSlug: null,
    },
    {
      providerSlug: 'ollama',
      slug: 'bge-m3',
      displayName: 'BGE-M3 (Ollama)',
      contextTokens: 0,
      supportsVision: false,
      supportsEmbeddings: true,
      vectorSize: 1024,
      minPlanSlug: null,
    },
    {
      providerSlug: 'openai',
      slug: 'text-embedding-3-small',
      displayName: 'OpenAI Embeddings 3 Small',
      contextTokens: 0,
      supportsVision: false,
      supportsEmbeddings: true,
      vectorSize: 1536,
      minPlanSlug: 'pro',
    },
    {
      providerSlug: 'openai',
      slug: 'text-embedding-3-large',
      displayName: 'OpenAI Embeddings 3 Large',
      contextTokens: 0,
      supportsVision: false,
      supportsEmbeddings: true,
      vectorSize: 3072,
      minPlanSlug: 'max',
    },
    {
      providerSlug: 'gigachat',
      slug: 'embeddings',
      displayName: 'GigaChat Embeddings',
      contextTokens: 0,
      supportsVision: false,
      supportsEmbeddings: true,
      vectorSize: 1024,
      minPlanSlug: 'pro',
    },
  ] as const

  for (const m of aiModels) {
    const provider = providerBySlug.get(m.providerSlug)
    if (!provider) throw new Error(`Seed: unknown AI provider slug ${m.providerSlug}`)
    await prisma.aiModel.upsert({
      where: { providerId_slug: { providerId: provider.id, slug: m.slug } },
      update: {
        displayName: m.displayName,
        contextTokens: m.contextTokens,
        supportsVision: m.supportsVision,
        supportsEmbeddings: m.supportsEmbeddings,
        vectorSize: m.vectorSize,
        minPlanSlug: m.minPlanSlug,
        isActive: true,
        deprecatedAt: null,
      },
      create: {
        providerId: provider.id,
        slug: m.slug,
        displayName: m.displayName,
        contextTokens: m.contextTokens,
        supportsVision: m.supportsVision,
        supportsEmbeddings: m.supportsEmbeddings,
        vectorSize: m.vectorSize,
        minPlanSlug: m.minPlanSlug,
        isActive: true,
      },
    })
  }

  const gigachatProvider = providerBySlug.get('gigachat')
  if (!gigachatProvider) throw new Error('Seed: unknown AI provider slug gigachat')
  await prisma.aiModel.updateMany({
    where: {
      providerId: gigachatProvider.id,
      slug: { notIn: [...gigachatModelSlugs] },
      isActive: true,
    },
    data: {
      isActive: false,
      deprecatedAt: new Date(),
    },
  })

  console.info('Seed complete: 5 providers, 3 active plans, 3 AI providers, 9 AI models')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
