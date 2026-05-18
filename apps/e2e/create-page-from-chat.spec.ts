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

import { expect, test } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'
import { encryptFixture } from './helpers/encrypt-fixture'

const OPENAI_KEY = process.env.OPENAI_API_KEY

test.describe('agent — create page from chat', () => {
  test.skip(!OPENAI_KEY, 'OPENAI_API_KEY not set; skipping live agent E2E')

  let prisma: typeof import('../../packages/db/src/index').prisma

  test.beforeAll(async () => {
    loadEnvFromRoot()
    const db = await import('../../packages/db/src/index')
    prisma = db.prisma
  })

  test.afterAll(async () => {
    if (prisma) await prisma.$disconnect()
  })

  test('summarises the dialog into a new root page and returns a clickable link', async ({
    page,
  }) => {
    const email = `create-from-chat+${Date.now()}@example.com`
    const password = 'SuperSecure123!'
    await signUpAndAuthAs(page, { email, password, firstName: 'Чат', lastName: 'Страница' })

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    })

    const [workspace, chatModel, embeddingModel] = await Promise.all([
      prisma.workspace.findFirstOrThrow({
        where: { members: { some: { userId: user.id, role: 'OWNER' } } },
        select: { id: true },
      }),
      prisma.aiModel.findFirst({
        where: { slug: 'gpt-4o-mini', provider: { slug: 'openai' }, supportsEmbeddings: false },
        select: { id: true },
      }),
      prisma.aiModel.findFirst({
        where: {
          slug: 'text-embedding-3-small',
          provider: { slug: 'openai' },
          supportsEmbeddings: true,
        },
        select: { id: true },
      }),
    ])

    if (!chatModel || !embeddingModel) {
      test.skip(
        true,
        'openai AiModel rows (gpt-4o-mini / text-embedding-3-small) not seeded in dev DB; ' +
          'seed them via Settings → AI агент or the DB seed script before running this test.',
      )
      return
    }

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

    await page.goto(`/workspaces/${workspace.id}/chats/new`)

    const composer = page.getByTestId('chat-composer-textarea')
    await expect(composer).toBeVisible()

    const sendBtn = page.getByRole('button', { name: 'Send' })

    const turns = [
      'Как правильно жарить яичницу на сковороде?',
      'При какой температуре жарить, чтобы желток остался жидким?',
      'Нужно ли накрывать сковороду крышкой при жарке яичницы?',
    ]

    for (const [idx, turn] of turns.entries()) {
      const expectedAssistantCount = idx + 1
      await composer.fill(turn)
      await sendBtn.click()

      // Wait until the chat URL has a chatId — happens on first send. After
      // that, poll the DB for THIS turn's assistant reply (status=DONE).
      // Per-turn counter avoids the false-positive of "any prior reply
      // counts" when sending turn 2/3.
      await expect
        .poll(() => /\/chats\/[0-9a-f-]{36}/.test(page.url()), { timeout: 30_000 })
        .toBe(true)

      const chatId = page.url().match(/\/chats\/([0-9a-f-]{36})/)![1]
      await expect
        .poll(
          () =>
            prisma.chatMessage.count({
              where: { chatId, role: 'ASSISTANT', status: 'DONE' },
            }),
          { timeout: 60_000, intervals: [1000, 2000, 3000] },
        )
        .toBeGreaterThanOrEqual(expectedAssistantCount)
    }

    await composer.fill('Создай страницу из разговора')
    await sendBtn.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 60_000 })
    await expect(dialog.getByText('Подтвердить действие')).toBeVisible()

    const allowBtn = dialog.getByRole('button', { name: 'Разрешить' })
    await expect(allowBtn).toBeVisible()
    await allowBtn.click()

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

    await pageLink.click()
    await page.waitForURL(pageHrefPattern, { timeout: 30_000 })

    const createdPage = await prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { title: true, content: true, parentId: true, type: true },
    })

    expect(createdPage.parentId).toBeNull()
    expect(createdPage.type).toBe('TEXT')
    expect(createdPage.title?.trim()).toBeTruthy()
    expect(createdPage.content).not.toBeNull()

    // Loose substring match tolerates LLM paraphrasing.
    const contentStr = JSON.stringify(createdPage.content).toLowerCase()
    expect(contentStr).toMatch(/яичниц|желт|жарь/i)
  })
})
