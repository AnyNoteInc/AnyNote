import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { signUpAndAuthAs } from './helpers/auth'

let prisma: typeof import('../../packages/db/src/index').prisma

const password = 'SuperSecure123!'

test.beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    const envPath = join(process.cwd(), '.env')
    const envFile = readFileSync(envPath, 'utf8')
    const databaseUrl = envFile
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('DATABASE_URL='))
      ?.slice('DATABASE_URL='.length)
      .replace(/^"|"$/g, '')
    if (!databaseUrl) throw new Error('DATABASE_URL is not configured in .env')
    process.env.DATABASE_URL = databaseUrl
  }
  const db = await import('../../packages/db/src/index')
  prisma = db.prisma
})

test.afterAll(async () => {
  if (prisma) await prisma.$disconnect()
})

async function setupProWorkspace(page: Page, tag: string): Promise<{ workspaceId: string }> {
  const email = `embeddings-${tag}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Векторы' })
  await page.getByRole('textbox', { name: 'Название' }).fill(`Embeddings ${tag}`)
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+$/)
  const workspaceId = page.url().match(/\/workspaces\/([a-f0-9-]+)$/)?.[1]
  if (!workspaceId) throw new Error(`Could not parse workspace id from ${page.url()}`)

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  })

  const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
  const now = new Date()
  const periodEnd = new Date(now)
  periodEnd.setMonth(periodEnd.getMonth() + 1)

  await prisma.subscription.updateMany({
    where: { userId: user.id, status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } },
    data: { status: 'EXPIRED', expiredAt: now },
  })
  await prisma.subscription.create({
    data: {
      userId: user.id,
      planId: pro.id,
      status: 'ACTIVE',
      billingPeriod: 'MONTHLY',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      paymentMethodId: `pm_e2e_emb_${Date.now()}`,
      paymentMethodLast4: '0000',
      paymentMethodBrand: 'bank_card',
    },
  })

  return { workspaceId }
}

const embeddingModelIdCache = new Map<string, string>()
async function getEmbeddingModelIdBySlug(slug: string): Promise<string> {
  const cached = embeddingModelIdCache.get(slug)
  if (cached) return cached
  const model = await prisma.aiModel.findFirstOrThrow({
    where: { slug, supportsEmbeddings: true },
    select: { id: true },
  })
  embeddingModelIdCache.set(slug, model.id)
  return model.id
}

test('Векторизация section is rendered for Pro workspace and starts unset', async ({ page }) => {
  const { workspaceId } = await setupProWorkspace(page, 'render')

  await page.goto(`/workspaces/${workspaceId}/settings/ai`)
  await expect(page.getByRole('heading', { name: 'Векторизация' })).toBeVisible()
  await expect(
    page.getByText(
      /Модель для индексации страниц и поиска по контексту в чатах\. Без выбранной модели/,
    ),
  ).toBeVisible()

  // The combobox renders an empty placeholder when no model is selected (MUI shows
  // the <em>Не выбрано</em> MenuItem as a zero-width whitespace value in the select trigger).
  // Verify "Не выбрано" by opening the dropdown and asserting it's the highlighted option.
  const embeddingsSelect = page.getByRole('combobox', { name: 'Модель векторизации' })
  await expect(embeddingsSelect).toBeVisible()
  await embeddingsSelect.click()
  await expect(page.getByRole('option', { name: 'Не выбрано' })).toBeVisible()
  await page.keyboard.press('Escape')

  const settingsRow = await prisma.workspaceAiSettings.findUnique({ where: { workspaceId } })
  expect(settingsRow?.embeddingsModelId ?? null).toBeNull()
})

test('selecting an embeddings model opens confirmation and persists on confirm', async ({
  page,
}) => {
  const { workspaceId } = await setupProWorkspace(page, 'select')
  const targetModelId = await getEmbeddingModelIdBySlug('nomic-embed-text')

  await page.goto(`/workspaces/${workspaceId}/settings/ai`)
  await expect(page.getByRole('heading', { name: 'Векторизация' })).toBeVisible()

  await page.getByRole('combobox', { name: 'Модель векторизации' }).click()
  await page.getByRole('option', { name: /Nomic Embed Text/ }).click()

  await page.getByRole('button', { name: 'Сохранить' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Сменить модель векторизации?')).toBeVisible()
  await dialog.getByRole('button', { name: 'Подтвердить' }).click()

  await expect(page.getByText('Сохранено')).toBeVisible({ timeout: 10_000 })

  await expect
    .poll(
      async () => {
        const row = await prisma.workspaceAiSettings.findUnique({
          where: { workspaceId },
          select: { embeddingsModelId: true },
        })
        return row?.embeddingsModelId ?? null
      },
      { timeout: 5_000 },
    )
    .toBe(targetModelId)
})

test('switching to a different embeddings model re-enqueues pages and updates DB', async ({
  page,
}) => {
  const { workspaceId } = await setupProWorkspace(page, 'switch')
  const firstModelId = await getEmbeddingModelIdBySlug('nomic-embed-text')
  const secondModelId = await getEmbeddingModelIdBySlug('bge-m3')

  // Seed initial state: model A is set, plus a TEXT page so we can verify enqueue.
  await prisma.workspaceAiSettings.upsert({
    where: { workspaceId },
    create: { workspaceId, embeddingsModelId: firstModelId },
    update: { embeddingsModelId: firstModelId },
  })
  const seededPage = await prisma.page.create({
    data: {
      workspaceId,
      type: 'TEXT',
      title: 'Seed page',
      content: { type: 'doc', content: [] },
    },
    select: { id: true },
  })

  await page.goto(`/workspaces/${workspaceId}/settings/ai`)
  await expect(page.getByRole('combobox', { name: 'Модель векторизации' })).toHaveText(
    /Nomic Embed Text/,
  )

  await page.getByRole('combobox', { name: 'Модель векторизации' }).click()
  await page.getByRole('option', { name: /BGE-M3/ }).click()
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click()
  await expect(page.getByText('Сохранено')).toBeVisible({ timeout: 10_000 })

  await expect
    .poll(
      async () => {
        const row = await prisma.workspaceAiSettings.findUnique({
          where: { workspaceId },
          select: { embeddingsModelId: true },
        })
        return row?.embeddingsModelId ?? null
      },
      { timeout: 5_000 },
    )
    .toBe(secondModelId)

  // The transaction should have enqueued a fresh page.upserted outbox event for the seeded page.
  const enqueued = await prisma.outboxEvent.count({
    where: {
      workspaceId,
      aggregateType: 'page',
      aggregateId: seededPage.id,
      eventType: 'page.upserted',
      status: { in: ['PENDING', 'PROCESSING'] },
    },
  })
  expect(enqueued).toBeGreaterThanOrEqual(1)
})

test('resetting embeddings model to "Не выбрано" clears the FK', async ({ page }) => {
  const { workspaceId } = await setupProWorkspace(page, 'reset')
  const initialModelId = await getEmbeddingModelIdBySlug('nomic-embed-text')

  await prisma.workspaceAiSettings.upsert({
    where: { workspaceId },
    create: { workspaceId, embeddingsModelId: initialModelId },
    update: { embeddingsModelId: initialModelId },
  })

  await page.goto(`/workspaces/${workspaceId}/settings/ai`)
  await expect(page.getByRole('combobox', { name: 'Модель векторизации' })).toHaveText(
    /Nomic Embed Text/,
  )

  await page.getByRole('combobox', { name: 'Модель векторизации' }).click()
  await page.getByRole('option', { name: 'Не выбрано' }).click()
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click()
  await expect(page.getByText('Сохранено')).toBeVisible({ timeout: 10_000 })

  await expect
    .poll(
      async () => {
        const row = await prisma.workspaceAiSettings.findUnique({
          where: { workspaceId },
          select: { embeddingsModelId: true },
        })
        return row?.embeddingsModelId ?? null
      },
      { timeout: 5_000 },
    )
    .toBeNull()
})

test('Personal plan user gets 404 on /settings/ai (Векторизация not exposed)', async ({ page }) => {
  // No Pro upgrade — stay on the default trial/personal plan.
  const email = `embeddings-personal+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Бесплатный' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Embeddings Personal')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+$/)
  const workspaceId = page.url().match(/\/workspaces\/([a-f0-9-]+)$/)?.[1]
  if (!workspaceId) throw new Error('no workspace id parsed')

  const response = await page.goto(`/workspaces/${workspaceId}/settings/ai`)
  expect(response?.status()).toBe(404)
})
