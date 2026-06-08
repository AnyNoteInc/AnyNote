import { expect, test } from '@playwright/test'
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

    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not configured in .env')
    }

    process.env.DATABASE_URL = databaseUrl
  }

  const db = await import('../../packages/db/src/index')
  prisma = db.prisma
})

test.afterAll(async () => {
  if (prisma) await prisma.$disconnect()
})

async function signUpAndCreateWorkspace(page: import('@playwright/test').Page, tag: string) {
  const email = `billing-${tag}+${Date.now()}@example.com`

  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Биллинг' })
  await page.getByRole('textbox', { name: 'Название' }).fill(`Billing ${tag}`)
  await page.getByRole('button', { name: 'Создать пространство' }).click()

  // Creation sets the new workspace active and redirects through /app to a
  // neutral URL (first page or /chats/new). URLs no longer contain /workspaces/{id}.
  await page.waitForURL(/\/(pages|chats)\//)

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  })

  return { email, userId: user.id }
}

test('new user starts on Personal and chats are gated', async ({ page }) => {
  await signUpAndCreateWorkspace(page, 'personal')

  await expect(page.getByText('Personal', { exact: true })).toBeVisible()
  await page.goto('/chats')
  await expect(page.getByText('404')).toBeVisible()
})

test('mocked Pro purchase unlocks chats', async ({ page }) => {
  await signUpAndCreateWorkspace(page, 'purchase')

  await page.goto('/pricing')
  await page.getByRole('button', { name: 'Купить' }).first().click()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: /Оплатить/ }).click()

  await page.waitForURL(/\/billing\/return/)
  await expect(page.getByText('Оплата прошла успешно')).toBeVisible({ timeout: 10_000 })

  // Active workspace resolves server-side; land on a neutral route and confirm
  // the plan badge now reads "Pro".
  await page.goto('/chats/new')
  await expect(page.getByText('Pro')).toBeVisible()

  await page.goto('/chats')
  await expect(page.getByText('Создайте первый чат')).toBeVisible()
})

test('canceling paid subscription keeps access until period end', async ({ page }) => {
  const { userId } = await signUpAndCreateWorkspace(page, 'cancel')
  const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
  const now = new Date()
  const periodEnd = new Date(now)
  periodEnd.setMonth(periodEnd.getMonth() + 1)

  await prisma.subscription.updateMany({
    where: { userId, status: 'ACTIVE' },
    data: { status: 'EXPIRED', expiredAt: now },
  })
  await prisma.subscription.create({
    data: {
      userId,
      planId: pro.id,
      status: 'ACTIVE',
      billingPeriod: 'MONTHLY',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      paymentMethodId: `pm_e2e_${Date.now()}`,
      paymentMethodLast4: '0000',
      paymentMethodBrand: 'bank_card',
    },
  })

  await page.goto('/settings/billing')
  await expect(page.getByText('Pro')).toBeVisible()
  await page.getByRole('button', { name: 'Отменить подписку' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Отменить подписку' }).click()
  await expect(page.getByText(/Отменена, доступ до/)).toBeVisible()
})
