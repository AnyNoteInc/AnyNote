import { config } from "dotenv"
import { PrismaClient } from "@prisma/client"
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
  console.info("Seed complete: 5 providers, 3 plans")
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
