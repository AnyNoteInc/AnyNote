/**
 * E2E spec: redesigned workspace chat composer (chat expansion).
 *
 * Requires:
 *   - docker compose up -d (postgres) — the Playwright dev server on :3100
 *     talks to the same Postgres the rest of the suite uses.
 *
 * Covers three behaviours of the new composer, all exercised on a *fresh* chat
 * (the `/chats/new` route, chatId=null) so the lazy
 * createChat-on-first-interaction path is hit:
 *   1. Optimistic send — the user's message renders the instant they press
 *      Enter, before any /api/agents/generate SSE resolves (the agents service
 *      is not running under Playwright; only the optimistic insert is asserted).
 *   2. The "+" attachment menu offers "Добавить фото и файлы".
 *   3. The slash menu offers Thinking effort options and sets a Thinking chip.
 *
 * A workspace + OWNER membership are created directly via Prisma (mirroring
 * chat-page.spec.ts) because signUpAndAuthAs lands the user on the
 * "create workspace" screen; creating the chat itself goes through the real
 * createChat tRPC mutation triggered by the composer.
 */

import { expect, test, type Page } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

let prisma: typeof import('../../packages/db/src/index').prisma
let RoleType: typeof import('../../packages/db/src/index').RoleType

test.beforeAll(async () => {
  loadEnvFromRoot()
  const db = await import('../../packages/db/src/index')
  prisma = db.prisma
  RoleType = db.RoleType
})

test.afterAll(async () => {
  if (prisma) await prisma.$disconnect()
})

/**
 * Sign up a fresh user, create a workspace they own, and open a brand-new chat
 * (chatId=null) so the composer drives the lazy createChat flow. Returns the
 * created workspace id.
 */
async function openNewChat(page: Page, slug: string): Promise<string> {
  const email = `${slug}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Чат', lastName: 'Тестов' })

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  })

  const workspace = await prisma.workspace.create({
    data: { name: `Chat workspace ${Date.now()}`, createdById: user.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: user.id, role: RoleType.OWNER },
  })

  await page.goto(`/chats/new`)
  // The chats route compiles slowly on a cold dev server; give the composer a
  // generous window to mount.
  await expect(page.getByTestId('chat-composer-textarea')).toBeVisible({ timeout: 60_000 })

  return workspace.id
}

test('optimistic send shows the user message immediately', async ({ page }) => {
  await openNewChat(page, 'chat-optimistic')

  const composer = page.getByTestId('chat-composer-textarea')
  await composer.fill('Привет, ассистент')
  await composer.press('Enter')

  // The optimistic user message is inserted before the SSE round-trip (the
  // agents service is down under Playwright, so the assistant turn will error —
  // but the user's text must appear regardless).
  await expect(
    page.getByTestId('chat-message-list').getByText('Привет, ассистент'),
  ).toBeVisible({ timeout: 15_000 })
})

test('plus menu shows add-files option', async ({ page }) => {
  await openNewChat(page, 'chat-plus-menu')

  await page.getByRole('button', { name: 'Добавить вложение' }).click()
  await expect(page.getByText('Добавить фото и файлы')).toBeVisible()
})

test('slash menu offers Thinking and sets a chip', async ({ page }) => {
  await openNewChat(page, 'chat-slash')

  const composer = page.getByTestId('chat-composer-textarea')
  // "/think" is a prefix of "thinking", which opens the slash menu.
  await composer.fill('/think')

  const slashMenu = page.getByTestId('chat-slash-menu')
  await expect(slashMenu).toBeVisible({ timeout: 15_000 })
  await expect(slashMenu.getByText('Thinking')).toBeVisible()

  // Selecting an effort creates the chat (chatId=null) and renders the chip.
  await slashMenu.getByText('Среднее').click()

  await expect(page.locator('.MuiChip-root', { hasText: 'Thinking' })).toBeVisible({
    timeout: 15_000,
  })
})
