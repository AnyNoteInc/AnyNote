/**
 * E2E spec: agent — create page from chat.
 *
 * Requires:
 *   - OPENAI_API_KEY in env (skipped otherwise)
 *   - docker compose up -d (postgres + qdrant)
 *   - apps/agents running on port 8080 (generation)
 *   - apps/engines running on port 8082 (MCP tools)
 *   - SECRETS_ENCRYPTION_KEY set so encryptFixture can encrypt the API key
 *
 * The test:
 *   1. Signs up a fresh user and resolves the auto-provisioned workspace.
 *   2. Seeds WorkspaceAiSettings with the OpenAI key (skips if provider/models absent).
 *   3. Sends three conversational turns about frying eggs to build history.
 *   4. Sends the trigger phrase "Создай страницу из разговора".
 *   5. Confirms the action in the destructive-action dialog.
 *   6. Asserts the agent response contains a clickable link to the new page.
 *   7. Navigates to the link and verifies the page exists in the DB.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const OPENAI_KEY = process.env.OPENAI_API_KEY

function ensureDbUrl(): void {
  if (process.env.DATABASE_URL) return
  const envPath = join(process.cwd(), '.env')
  const envFile = readFileSync(envPath, 'utf8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^"|"$/g, '')
    process.env[key] = process.env[key] ?? value
  }
}

// ---------------------------------------------------------------------------
// Encrypt a fixture value using the same AES-256-GCM helper the app uses.
// SECRETS_ENCRYPTION_KEY must be set in the playwright webServer env.
// ---------------------------------------------------------------------------

function encryptFixture(value: object): object {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { encryptSecret } = require('../../packages/auth/src/index') as {
    encryptSecret: (s: string) => object
  }
  return encryptSecret(JSON.stringify(value))
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('agent — create page from chat', () => {
  test.skip(!OPENAI_KEY, 'OPENAI_API_KEY not set; skipping live agent E2E')

  let prisma: typeof import('../../packages/db/src/index').prisma

  test.beforeAll(async () => {
    ensureDbUrl()
    const db = await import('../../packages/db/src/index')
    prisma = db.prisma
  })

  test.afterAll(async () => {
    if (prisma) await prisma.$disconnect()
  })

  test('summarises the dialog into a new root page and returns a clickable link', async ({
    page,
  }) => {
    // -----------------------------------------------------------------------
    // 1. Sign up + auth
    // -----------------------------------------------------------------------
    const email = `create-from-chat+${Date.now()}@example.com`
    const password = 'SuperSecure123!'
    await signUpAndAuthAs(page, { email, password, firstName: 'Чат', lastName: 'Страница' })

    // -----------------------------------------------------------------------
    // 2. Locate the owned workspace (auto-provisioned at sign-up)
    // -----------------------------------------------------------------------
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    })
    const workspace = await prisma.workspace.findFirstOrThrow({
      where: { members: { some: { userId: user.id, role: 'OWNER' } } },
      select: { id: true },
    })

    // -----------------------------------------------------------------------
    // 3. Look up AiModel UUIDs for OpenAI gpt-4o-mini + text-embedding-3-small.
    //    Skip if provider/models are absent from the dev DB.
    // -----------------------------------------------------------------------
    const chatModel = await prisma.aiModel.findFirst({
      where: {
        slug: 'gpt-4o-mini',
        provider: { slug: 'openai' },
        supportsEmbeddings: false,
      },
      select: { id: true },
    })
    const embeddingModel = await prisma.aiModel.findFirst({
      where: {
        slug: 'text-embedding-3-small',
        provider: { slug: 'openai' },
        supportsEmbeddings: true,
      },
      select: { id: true },
    })

    if (!chatModel || !embeddingModel) {
      test.skip(
        true,
        'openai AiModel rows (gpt-4o-mini / text-embedding-3-small) not seeded in dev DB; ' +
          'seed them via Settings → AI агент or the DB seed script before running this test.',
      )
      return
    }

    // -----------------------------------------------------------------------
    // 4. Upsert WorkspaceAiSettings with OpenAI models + encrypted key
    // -----------------------------------------------------------------------
    const encryptedKey = encryptFixture({ apiKey: OPENAI_KEY })

    await prisma.workspaceAiSettings.upsert({
      where: { workspaceId: workspace.id },
      update: {
        defaultModelId: chatModel.id,
        embeddingsModelId: embeddingModel.id,
        chatModelConnection: encryptedKey,
        embeddingModelConnection: encryptedKey,
        allowDestructive: false,
      },
      create: {
        workspaceId: workspace.id,
        defaultModelId: chatModel.id,
        embeddingsModelId: embeddingModel.id,
        chatModelConnection: encryptedKey,
        embeddingModelConnection: encryptedKey,
        allowDestructive: false,
      },
    })

    // -----------------------------------------------------------------------
    // 5. Navigate to new chat
    // -----------------------------------------------------------------------
    await page.goto(`/workspaces/${workspace.id}/chats/new`)

    const composer = page.getByTestId('chat-composer-textarea')
    await expect(composer).toBeVisible()

    const sendBtn = page.getByRole('button', { name: 'Send' })

    // -----------------------------------------------------------------------
    // 6. Send three turns about frying eggs to build conversation history
    // -----------------------------------------------------------------------
    const turns = [
      'Как правильно жарить яичницу на сковороде?',
      'При какой температуре жарить, чтобы желток остался жидким?',
      'Нужно ли накрывать сковороду крышкой при жарке яичницы?',
    ]

    for (const turn of turns) {
      await composer.fill(turn)
      await sendBtn.click()

      // Wait for an assistant reply to appear (LLM calls can be slow)
      await expect(async () => {
        const messageList = page.getByTestId('chat-message-list')
        // Look for at least one article with role=article that is the assistant reply
        const articles = messageList.locator('[role="article"]')
        const count = await articles.count()
        expect(count).toBeGreaterThan(0)
      }).toPass({ timeout: 60_000 })

      // Also verify via DB that an assistant message with status=DONE exists
      const chatIdMatch = page.url().match(/\/chats\/([0-9a-f-]{36})/)
      if (chatIdMatch) {
        await expect
          .poll(
            async () => {
              const msgs = await prisma.chatMessage.findMany({
                where: {
                  chatId: chatIdMatch[1],
                  role: 'ASSISTANT',
                  status: 'DONE',
                },
                select: { id: true },
              })
              return msgs.length
            },
            { timeout: 60_000, intervals: [1000, 2000, 3000] },
          )
          .toBeGreaterThan(0)
      }
    }

    // -----------------------------------------------------------------------
    // 7. Send the trigger phrase to create a page from the conversation
    // -----------------------------------------------------------------------
    await composer.fill('Создай страницу из разговора')
    await sendBtn.click()

    // -----------------------------------------------------------------------
    // 8. Wait for the confirmation dialog and approve the action
    // -----------------------------------------------------------------------
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 60_000 })
    await expect(dialog.getByText('Подтвердить действие')).toBeVisible()

    const allowBtn = dialog.getByRole('button', { name: 'Разрешить' })
    await expect(allowBtn).toBeVisible()
    await allowBtn.click()

    // -----------------------------------------------------------------------
    // 9. Wait for the final assistant message with a page link
    //    The link href must match: /workspaces/{id}/pages/{uuid}
    // -----------------------------------------------------------------------
    const pageHrefPattern = new RegExp(
      `^/workspaces/${workspace.id}/pages/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
    )

    const pageLink = page
      .getByTestId('chat-message-list')
      .locator(`a[href*="/workspaces/${workspace.id}/pages/"]`)
      .last()

    await expect(pageLink).toBeVisible({ timeout: 60_000 })

    const href = await pageLink.getAttribute('href')
    expect(href).toMatch(pageHrefPattern)

    const pageIdMatch = href!.match(/\/pages\/([0-9a-f-]{36})/)
    expect(pageIdMatch).not.toBeNull()
    const pageId = pageIdMatch![1]

    // -----------------------------------------------------------------------
    // 10. Click the link and verify browser navigates to the new page
    // -----------------------------------------------------------------------
    await pageLink.click()
    await page.waitForURL(pageHrefPattern, { timeout: 30_000 })

    // -----------------------------------------------------------------------
    // 11. Verify the page record in the DB
    // -----------------------------------------------------------------------
    const createdPage = await prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { title: true, content: true, parentId: true, type: true },
    })

    // Root page — no parent
    expect(createdPage.parentId).toBeNull()

    // Must be a TEXT page
    expect(createdPage.type).toBe('TEXT')

    // Title must be non-empty
    expect(createdPage.title?.trim()).toBeTruthy()

    // Tiptap doc must be present
    expect(createdPage.content).not.toBeNull()

    // Content should mention eggs / frying in some form (loose match tolerates
    // LLM paraphrasing: яичниц = egg dishes, желт = yolk, жарь = fry)
    const contentStr = JSON.stringify(createdPage.content).toLowerCase()
    expect(contentStr).toMatch(/яичниц|желт|жарь/i)
  })
})
