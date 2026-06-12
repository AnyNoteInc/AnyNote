import { config } from 'dotenv'
import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

import { GLOBAL_TEMPLATES, buildTemplateContentYjs } from './global-templates.ts'
import { TEMPLATE_TAGS } from './template-tags.ts'

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

const plans = [
  {
    slug: 'personal',
    name: 'Персональный',
    description: 'Для личного пользования',
    priceMonthlyKopecks: 0,
    priceYearlyKopecks: 0,
    pricePerExtraSeatMonthlyKopecks: 0,
    pricePerExtraSeatYearlyKopecks: 0,
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
    pricePerExtraSeatMonthlyKopecks: 19_000,
    pricePerExtraSeatYearlyKopecks: 190_000,
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
    pricePerExtraSeatMonthlyKopecks: 29_000,
    pricePerExtraSeatYearlyKopecks: 290_000,
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

  await seedTemplateTags()
  const systemWorkspaceId = await seedSystemWorkspace()
  await seedGlobalTemplates(systemWorkspaceId)

  const templatePageCount = await prisma.page.count({ where: { isTemplate: 'GLOBAL' } })
  console.info(`Seed complete: 3 active plans, ${templatePageCount} global template pages`)
}

async function seedTemplateTags() {
  for (const t of TEMPLATE_TAGS) {
    await prisma.templateTag.upsert({
      where: { slug: t.slug },
      create: { slug: t.slug, name: t.name, icon: t.icon, position: t.position },
      update: { name: t.name, icon: t.icon, position: t.position },
    })
  }
}

/**
 * Upsert the hidden system workspace that owns the built-in GLOBAL template
 * pages. It is keyed by the stable slug `system-templates` (looked up by the
 * domain's `findSystemWorkspaceId()`) and has NO members, so it never surfaces
 * to real users. `createdById` is omitted (admin-managed, nullable).
 */
async function seedSystemWorkspace(): Promise<string> {
  const ws = await prisma.workspace.upsert({
    where: { slug: 'system-templates' },
    create: { slug: 'system-templates', name: 'Шаблоны AnyNote', icon: '📐' },
    update: { name: 'Шаблоны AnyNote' },
    select: { id: true },
  })
  return ws.id
}

/**
 * Upsert the built-in GLOBAL templates as TEMPLATE PAGES in the system
 * workspace, keyed by the stable `templateKey` so a later title rename updates
 * the existing row instead of orphaning it. Existing rows keep their id and
 * usageCount; missing ones are created. `createdById` stays null (admin-managed).
 */
async function seedGlobalTemplates(systemWorkspaceId: string) {
  // Map tag slug → id once (tags are already seeded).
  const tags = await prisma.templateTag.findMany({ select: { id: true, slug: true } })
  const tagIdBySlug = new Map(tags.map((t) => [t.slug, t.id]))

  for (const t of GLOBAL_TEMPLATES) {
    const contentYjs = Buffer.from(buildTemplateContentYjs(t.doc))
    const data = {
      workspaceId: systemWorkspaceId,
      isTemplate: 'GLOBAL' as const,
      title: t.title,
      icon: t.icon,
      type: 'TEXT' as const,
      content: t.doc as unknown as Prisma.InputJsonValue,
      contentYjs,
      templateMeta: {
        description: t.description,
        previewColor: null,
      } as Prisma.InputJsonValue,
      averageRating: t.averageRating,
      ratingCount: t.ratingCount,
      deletedAt: null,
    }
    const page = await prisma.page.upsert({
      where: { templateKey: t.key },
      create: { templateKey: t.key, ...data },
      update: data,
      select: { id: true },
    })
    // Re-sync tag links idempotently: delete existing, recreate from seed.
    await prisma.pageTemplateTag.deleteMany({ where: { pageId: page.id } })
    const tagIds = t.tagSlugs
      .map((slug) => tagIdBySlug.get(slug))
      .filter((id): id is string => Boolean(id))
    if (tagIds.length > 0) {
      await prisma.pageTemplateTag.createMany({
        data: tagIds.map((tagId) => ({ pageId: page.id, tagId })),
        skipDuplicates: true,
      })
    }
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
