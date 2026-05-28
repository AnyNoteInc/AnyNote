/**
 * E2E spec: workspace custom AI providers (feat/workspace-custom-ai-providers)
 *
 * Coverage:
 *  1. Free/personal-plan owner → /settings/ai returns 404 (plan gate).
 *  2. Max-plan owner → "Свои провайдеры" card is visible on the AI settings page.
 *  3. Max-plan owner → submitting the "Добавить провайдера" dialog with a valid
 *     form shows an error and does NOT persist a row, because under Playwright the
 *     agents service is NOT running — the server-side ping always fails with
 *     "Validation service unavailable", and aiProvider.create throws BAD_REQUEST.
 *
 * NOT covered (agents service constraint):
 *  - Successful provider creation (ping succeeds) is not testable under Playwright
 *    because the Next.js web server calls AGENTS_SERVICE_URL server-side; there is
 *    no way to intercept that with page.route(). Only the blocked-on-failed-ping
 *    path is deterministically exercisable.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

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

async function signUpAndCreateWorkspace(page: Page, tag: string) {
  const email = `ai-providers-${tag}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Провайдер' })
  // After signUpAndAuthAs, user is redirected to /app → /workspaces/new.
  // Wait for the workspace-creation URL before interacting with its form.
  await page.waitForURL(/\/workspaces\/new$/, { timeout: 20_000 })
  await page.getByRole('textbox', { name: 'Название' }).fill(`AI Providers ${tag}`)
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+/, { timeout: 30_000 })
  const workspaceId = page.url().match(/\/workspaces\/([a-f0-9-]+)/)?.[1]
  if (!workspaceId) throw new Error(`Could not parse workspaceId from ${page.url()}`)

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  })

  return { email, userId: user.id, workspaceId }
}

async function upgradeOwnerToMax(userId: string): Promise<void> {
  const maxPlan = await prisma.plan.findUniqueOrThrow({ where: { slug: 'max' } })
  const now = new Date()
  const periodEnd = new Date(now)
  periodEnd.setMonth(periodEnd.getMonth() + 1)

  // Expire any existing active subscriptions so there is exactly one ACTIVE row.
  await prisma.subscription.updateMany({
    where: { userId, status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } },
    data: { status: 'EXPIRED', expiredAt: now },
  })
  await prisma.subscription.create({
    data: {
      userId,
      planId: maxPlan.id,
      status: 'ACTIVE',
      billingPeriod: 'MONTHLY',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      paymentMethodId: `pm_e2e_ai_${Date.now()}`,
      paymentMethodLast4: '0000',
      paymentMethodBrand: 'bank_card',
    },
  })
}

// ---------------------------------------------------------------------------
// Test 1: plan gate — personal user gets 404 on /settings/ai
// ---------------------------------------------------------------------------
test('personal-plan owner gets 404 on /settings/ai', async ({ page }) => {
  const { workspaceId } = await signUpAndCreateWorkspace(page, 'gate')

  // No upgrade — stays on the default personal/trial plan.
  const response = await page.goto(`/workspaces/${workspaceId}/settings/ai`)
  expect(response?.status()).toBe(404)
})

// ---------------------------------------------------------------------------
// Test 2: max-plan owner sees the "Свои провайдеры" card
// ---------------------------------------------------------------------------
test('max-plan owner sees the Свои провайдеры card', async ({ page }) => {
  const { userId, workspaceId } = await signUpAndCreateWorkspace(page, 'visible')
  await upgradeOwnerToMax(userId)

  await page.goto(`/workspaces/${workspaceId}/settings/ai`)
  await expect(page.getByText('Свои провайдеры')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Добавить провайдера' })).toBeVisible()
})

// ---------------------------------------------------------------------------
// Test 3: block-on-failed-ping — agents down → error shown, no row added
// ---------------------------------------------------------------------------
test('owner on max plan: custom provider block-on-failed-ping', async ({ page }) => {
  const { userId, workspaceId } = await signUpAndCreateWorkspace(page, 'ping')
  await upgradeOwnerToMax(userId)

  await page.goto(`/workspaces/${workspaceId}/settings/ai`)
  await expect(page.getByText('Свои провайдеры')).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Добавить провайдера' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  await dialog.getByLabel('Название').fill('My OpenAI')
  await dialog.getByLabel('API ключ *').fill('sk-test-key')
  await dialog.getByLabel('Идентификатор модели (slug)').fill('gpt-4o')

  await dialog.getByRole('button', { name: 'Сохранить' }).click()

  // The server-side ping calls agents /validation/llm, which is down under
  // Playwright, so the helper returns { ok: false, error: 'Validation service
  // unavailable' } and aiProvider.create throws BAD_REQUEST with the message
  // "Не удалось подключиться: Validation service unavailable".
  await expect(dialog.getByRole('alert')).toBeVisible({ timeout: 15_000 })
  await expect(dialog.getByRole('alert')).toContainText(/Не удалось подключиться|Validation service/i)

  // The dialog stays open (no onSuccess fired) and no provider row was persisted.
  await expect(dialog).toBeVisible()
  const providerCount = await prisma.aiProvider.count({ where: { workspaceId } })
  expect(providerCount).toBe(0)
})
