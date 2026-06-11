import { expect, test, type Page } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'
const WORKSPACE_NAME = 'Телеграм WS'
// Passes the router's zod shape (/^\d+:[\w-]{30,}$/) without being a real token.
const FAKE_BOT_TOKEN = `123456789:${'A'.repeat(35)}`

/**
 * Telegram integration E2E (no live network).
 *
 * `playwright.config.ts` sets `TELEGRAM_API_BASE_URL=http://127.0.0.1:9` — an
 * unroutable port — so connect's synchronous getMe handshake fails instantly
 * and the connection lands in ERROR. That failure IS the asserted behavior:
 * the test proves the section renders, the connect mutation round-trips, and
 * the error state surfaces, all without a single live Bot API call.
 *
 * The «Телеграм» settings section is gated by Plan.developerSpaceEnabled,
 * which the seeded personal plan keeps off. We flip the flag on in beforeAll
 * and restore it in afterAll — the E2E Postgres is SHARED with dev, so the
 * restore must run even when the test fails (afterAll does run on failure;
 * the restore is additionally kept first in a try/finally so a $disconnect
 * error can never skip it). The flag-off path (section absent, FORBIDDEN
 * procedures) is covered by the telegram router unit tests, not here.
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
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Телеграм' })

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
// The «Телеграм» nav button only renders when the plan flag is on.
async function openTelegramSettings(page: Page) {
  await page.locator('aside').getByText(WORKSPACE_NAME, { exact: true }).click()
  await page.getByRole('button', { name: 'Настройки' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Телеграм' }).click()
  await expect(dialog.getByRole('button', { name: 'Телеграм' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  return dialog
}

test.describe('telegram integration settings', () => {
  test('connect fails fast against the unroutable API, personal link code is issued', async ({
    page,
  }) => {
    await signUpAndCreateWorkspace(page, 'telegram')
    const dialog = await openTelegramSettings(page)

    // Connect form (no connection yet): paste a well-formed fake token.
    const tokenInput = page.getByTestId('telegram-token-input')
    await expect(tokenInput).toBeVisible({ timeout: 30_000 })
    await tokenInput.fill(FAKE_BOT_TOKEN)
    await page.getByTestId('telegram-connect').click()

    // getMe against 127.0.0.1:9 is refused instantly, so the mutation returns
    // fast — the generous timeout only covers cold dev-server compiles.
    await expect(
      dialog.getByText('Не удалось подключить бота. Проверьте токен и повторите.'),
    ).toBeVisible({ timeout: 45_000 })
    // The connection card replaces the form and reads ERROR.
    await expect(dialog.getByText('Ошибка', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('telegram-token-input')).not.toBeVisible()

    // Personal link card: /settings/integrations → «Получить код» → one-time
    // 8-char code from the 0/O/1/I-free alphabet (packages/telegram/secret.ts).
    await page.goto('/settings/integrations')
    await page.getByRole('button', { name: 'Получить код' }).click()
    const code = page.getByTestId('telegram-link-code')
    await expect(code).toBeVisible({ timeout: 30_000 })
    await expect(code).toHaveText(/^[A-HJ-NP-Z2-9]{8}$/)
  })
})
