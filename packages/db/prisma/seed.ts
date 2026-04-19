import { config } from "dotenv"
import { PrismaClient, Prisma } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

config({ path: "../../.env" })

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is not set.")
}

const adapter = new PrismaPg({
  connectionString: databaseUrl,
})

const prisma = new PrismaClient({
  adapter,
})

const providers = [
  {
    slug: "yandex",
    name: "Yandex",
    scope: "USER" as const,
    sortOrder: 10,
    description: "Личный аккаунт Яндекс (диск, почта, календарь)",
  },
  {
    slug: "github",
    name: "GitHub",
    scope: "USER" as const,
    sortOrder: 20,
    description: "Личный GitHub — репозитории, issues, PR",
  },
  {
    slug: "telegram",
    name: "Telegram",
    scope: "USER" as const,
    sortOrder: 30,
    description: "Личный Telegram для уведомлений",
  },
  {
    slug: "amocrm",
    name: "AmoCRM",
    scope: "WORKSPACE" as const,
    sortOrder: 40,
    description: "CRM для workspace — сделки, контакты",
  },
  {
    slug: "mango_office",
    name: "MangoOffice",
    scope: "WORKSPACE" as const,
    sortOrder: 50,
    description: "Облачная телефония MangoOffice",
  },
]

const plans = [
  {
    slug: "free",
    name: "Free",
    priceMonthly: 0,
    maxWorkspaces: 1,
    maxMembersPerWorkspace: 1,
    sortOrder: 10,
    description: "Одно пространство, базовые возможности",
    features: ["Одно пространство", "Базовый редактор"],
  },
  {
    slug: "personal",
    name: "Personal",
    priceMonthly: 39000,
    maxWorkspaces: 5,
    maxMembersPerWorkspace: 1,
    sortOrder: 20,
    description: "Для личных проектов и фриланса",
    features: ["5 пространств", "История версий", "AI поиск"],
  },
  {
    slug: "corporate",
    name: "Corporate",
    priceMonthly: 149000,
    maxWorkspaces: null,
    maxMembersPerWorkspace: null,
    sortOrder: 30,
    description: "Для команд и компаний",
    features: ["∞ пространств", "Команды", "SSO", "Приоритетная поддержка"],
  },
]

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
      create: p,
      update: {
        name: p.name,
        description: p.description,
        priceMonthly: p.priceMonthly,
        maxWorkspaces: p.maxWorkspaces,
        maxMembersPerWorkspace: p.maxMembersPerWorkspace,
        sortOrder: p.sortOrder,
        features: p.features,
      },
    })
  }
  // ── AI providers ──────────────────────────────────────────────────────────
  const aiProviders = [
    {
      slug: "ollama",
      name: "Ollama",
      defaultBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
      credentialsSchema: {
        fields: [
          { key: "base_url", label: "Base URL", type: "string", required: false },
        ],
      } satisfies Prisma.InputJsonValue,
      docsUrl: "https://github.com/ollama/ollama",
      supportsStreaming: true,
      supportsTools: true,
    },
    {
      slug: "openai",
      name: "OpenAI ChatGPT",
      defaultBaseUrl: "https://api.openai.com/v1",
      credentialsSchema: {
        fields: [
          { key: "api_key", label: "API key", type: "secret", required: true },
          { key: "organization", label: "Organization", type: "string", required: false },
        ],
      } satisfies Prisma.InputJsonValue,
      docsUrl: "https://platform.openai.com/docs",
      supportsStreaming: true,
      supportsTools: true,
    },
    {
      slug: "gigachat",
      name: "GigaChat",
      defaultBaseUrl: "https://gigachat.devices.sberbank.ru/api/v1",
      credentialsSchema: {
        fields: [
          { key: "client_id", label: "Client ID", type: "string", required: true },
          { key: "client_secret", label: "Client Secret", type: "secret", required: true },
          { key: "scope", label: "Scope", type: "string", required: true, default: "GIGACHAT_API_PERS" },
        ],
      } satisfies Prisma.InputJsonValue,
      docsUrl: "https://developers.sber.ru/docs/ru/gigachat/api/overview",
      supportsStreaming: true,
      supportsTools: true,
    },
  ] as const

  const providerRows = await Promise.all(
    aiProviders.map((p) =>
      prisma.aiProvider.upsert({
        where: { slug: p.slug },
        update: {
          name: p.name,
          defaultBaseUrl: p.defaultBaseUrl,
          credentialsSchema: p.credentialsSchema,
          docsUrl: p.docsUrl,
          supportsStreaming: p.supportsStreaming,
          supportsTools: p.supportsTools,
          isActive: true,
        },
        create: { ...p, isActive: true },
      }),
    ),
  )

  const providerBySlug = new Map(providerRows.map((r) => [r.slug, r]))

  // ── AI models ─────────────────────────────────────────────────────────────
  const aiModels = [
    {
      providerSlug: "ollama",
      slug: "gemma4",
      displayName: "Gemma 4 (Ollama)",
      contextTokens: 8192,
      maxOutputTokens: 4096,
      supportsVision: false,
      supportsFunctionCalling: false,
      minPlanSlug: null,
    },
    {
      providerSlug: "openai",
      slug: "gpt-4o-mini",
      displayName: "GPT-4o mini",
      contextTokens: 128000,
      maxOutputTokens: 16384,
      supportsVision: true,
      supportsFunctionCalling: true,
      minPlanSlug: "personal",
    },
    {
      providerSlug: "openai",
      slug: "gpt-4o",
      displayName: "GPT-4o",
      contextTokens: 128000,
      maxOutputTokens: 16384,
      supportsVision: true,
      supportsFunctionCalling: true,
      minPlanSlug: "personal",
    },
    {
      providerSlug: "gigachat",
      slug: "GigaChat",
      displayName: "GigaChat",
      contextTokens: 32000,
      maxOutputTokens: 8000,
      supportsVision: false,
      supportsFunctionCalling: true,
      minPlanSlug: "personal",
    },
    {
      providerSlug: "gigachat",
      slug: "GigaChat-Pro",
      displayName: "GigaChat Pro",
      contextTokens: 32000,
      maxOutputTokens: 8000,
      supportsVision: false,
      supportsFunctionCalling: true,
      minPlanSlug: "personal",
    },
    {
      providerSlug: "gigachat",
      slug: "GigaChat-Max",
      displayName: "GigaChat Max",
      contextTokens: 131072,
      maxOutputTokens: 8000,
      supportsVision: true,
      supportsFunctionCalling: true,
      minPlanSlug: "corporate",
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
        maxOutputTokens: m.maxOutputTokens,
        supportsVision: m.supportsVision,
        supportsFunctionCalling: m.supportsFunctionCalling,
        minPlanSlug: m.minPlanSlug,
        isActive: true,
      },
      create: {
        providerId: provider.id,
        slug: m.slug,
        displayName: m.displayName,
        contextTokens: m.contextTokens,
        maxOutputTokens: m.maxOutputTokens,
        supportsVision: m.supportsVision,
        supportsFunctionCalling: m.supportsFunctionCalling,
        minPlanSlug: m.minPlanSlug,
        isActive: true,
      },
    })
  }

  console.info("Seed complete: 5 providers, 3 plans, 3 AI providers, 6 AI models")
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
