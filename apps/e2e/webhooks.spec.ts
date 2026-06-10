import { expect, test, type Page } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'
const WORKSPACE_NAME = 'Вебхуки WS'
const WEBHOOK_NAME = 'CI интеграция'
const WEBHOOK_URL = 'https://example.invalid/hook'

/**
 * Outbound-webhooks settings E2E (no live network).
 *
 * The created subscription stays PENDING because the verification challenge
 * targets `example.invalid` — an unresolvable host — and that IS the asserted
 * behavior: create succeeds, the one-time secret is shown, the row reads
 * «Ожидает проверки» and the delivery log is empty.
 *
 * The «Вебхуки» settings section is gated by Plan.developerSpaceEnabled, which
 * the seeded personal plan keeps off. We flip the flag on in beforeAll and
 * restore it in afterAll — the E2E Postgres is SHARED with dev, so the restore
 * must run even when the test fails (afterAll does run on failure; the restore
 * is additionally kept first in a try/finally so a $disconnect error can never
 * skip it). The flag-off path (section absent) is covered by the webhook
 * router unit tests, not here.
 */

test.setTimeout(180_000)

let prisma: typeof import('../../packages/db/src/index').prisma
let originalDeveloperSpaceEnabled: boolean | null = null

test.beforeAll(async () => {
  loadEnvFromRoot()
  const db = await import('../../packages/db/src/index')
  prisma = db.prisma

  const personal = await prisma.plan.findUniqueOrThrow({
    where: { slug: 'personal' },
    select: { developerSpaceEnabled: true },
  })
  originalDeveloperSpaceEnabled = personal.developerSpaceEnabled
  await prisma.plan.update({
    where: { slug: 'personal' },
    data: { developerSpaceEnabled: true },
  })
})

test.afterAll(async () => {
  if (!prisma) return
  try {
    if (originalDeveloperSpaceEnabled !== null) {
      await prisma.plan.update({
        where: { slug: 'personal' },
        data: { developerSpaceEnabled: originalDeveloperSpaceEnabled },
      })
    }
  } finally {
    await prisma.$disconnect()
  }
})

async function signUpAndCreateWorkspace(page: Page, slug: string): Promise<void> {
  const email = `${slug}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Вебхук' })

  // After sign-up the user lands on the workspace-creation form. On a cold dev
  // server hydration can lag behind the first fill(), leaving the submit button
  // disabled — re-fill until React registers the value.
  const nameInput = page.getByRole('textbox', { name: 'Название' })
  const createButton = page.getByRole('button', { name: 'Создать пространство' })
  await expect(async () => {
    await nameInput.fill(WORKSPACE_NAME)
    await expect(createButton).toBeEnabled({ timeout: 2_000 })
  }).toPass({ timeout: 60_000 })
  await createButton.click()
  await page.waitForURL(/\/(pages|chats)\//, { timeout: 30_000 })
}

// Settings live in a full-screen dialog opened from the owner-only space menu
// (workspace name in the sidebar header → «Настройки» → section nav button).
// The «Вебхуки» nav button only renders when the plan flag is on.
async function openWebhooksSettings(page: Page) {
  await page.locator('aside').getByText(WORKSPACE_NAME, { exact: true }).click()
  await page.getByRole('button', { name: 'Настройки' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Вебхуки' }).click()
  await expect(dialog.getByRole('button', { name: 'Вебхуки' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  return dialog
}

test.describe('outbound webhooks settings', () => {
  test('creates a subscription, reveals the one-time secret, stays pending', async ({ page }) => {
    await signUpAndCreateWorkspace(page, 'webhooks')
    await openWebhooksSettings(page)

    // Empty state, then the create dialog (a second dialog stacked on the
    // full-screen settings dialog — scope by its unique heading).
    await expect(page.getByText('Пока нет ни одной подписки', { exact: false })).toBeVisible()
    await page.getByTestId('webhooks-create').click()
    const createDialog = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: 'Добавить вебхук' }) })
    await expect(createDialog).toBeVisible()

    await createDialog.getByRole('textbox', { name: 'Имя' }).fill(WEBHOOK_NAME)
    await createDialog.getByRole('textbox', { name: 'URL' }).fill(WEBHOOK_URL)
    // Checkbox accessible names include the description line — match by label prefix.
    await createDialog.getByRole('checkbox', { name: /Страница создана/ }).check()
    await createDialog.getByRole('checkbox', { name: /Комментарий создан/ }).check()
    await createDialog.getByRole('button', { name: 'Создать' }).click()

    // The create mutation runs the verification challenge synchronously (up to
    // ~10s when the endpoint hangs) before returning — generous timeout.
    const secretValue = page.getByTestId('webhook-secret-value')
    await expect(secretValue).toBeVisible({ timeout: 45_000 })
    await expect(secretValue).toHaveText(/^whsec_[0-9A-Za-z]{32}$/)

    const secretDialog = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: 'Вебхук создан' }) })
    await secretDialog.getByRole('button', { name: 'Готово' }).click()
    await expect(secretDialog).not.toBeVisible()

    // example.invalid never answers the challenge → the row stays PENDING.
    const row = page.getByTestId('webhook-row')
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toContainText(WEBHOOK_NAME)
    await expect(row).toContainText(WEBHOOK_URL)
    await expect(row).toContainText('Ожидает проверки')
    await expect(row).toContainText('Событий: 2')

    // No event has been emitted yet — the delivery log is empty.
    await row.getByTestId('webhook-deliveries').click()
    await expect(page.getByText('Доставок пока нет.')).toBeVisible({ timeout: 30_000 })
  })
})
