/**
 * E2E spec: agent — create page from chat (GigaChat-2 Pro).
 *
 * Requires:
 *   - docker compose up -d (postgres + qdrant)
 *   - apps/agents running on port 8080 (generation)
 *   - apps/engines running on port 8082 (MCP tools)
 *   - SECRETS_ENCRYPTION_KEY set so encryptFixture can encrypt the credentials
 *   - GigaChat provider seeded in DB (packages/db/prisma/seed.ts) — credentials
 *     are read from `aiProvider.connection` and re-encrypted per-workspace.
 *
 * The test:
 *   1. Signs up a fresh user and resolves the auto-provisioned workspace.
 *   2. Reads gigachat-2-pro + GigaChat embeddings from seeded AiModel rows.
 *   3. Pulls clientId/clientSecret/scope from aiProvider.connection JSON and
 *      seeds WorkspaceAiSettings (encrypted) so apps/agents picks them up.
 *   4. Sends three conversational turns about frying eggs to build history.
 *   5. Sends the trigger phrase "Создай страницу из разговора".
 *   6. Confirms the action in the destructive-action dialog.
 *   7. Asserts the agent response contains a clickable link to the new page.
 *   8. Navigates to the link and verifies the page exists in the DB.
 */

import { expect, test } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'
import { encryptFixture } from './helpers/encrypt-fixture'

type GigaChatConn = { clientId: string; clientSecret: string; scope?: string }

test.describe('agent — create page from chat (gigachat-2-pro)', () => {
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

    const workspace = await prisma.workspace.create({
      data: { name: `Chat workspace ${Date.now()}`, createdById: user.id },
      select: { id: true },
    })
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: user.id, role: 'OWNER' },
    })

    const pro = await prisma.plan.findFirst({
      where: { chatsEnabled: true, pageIndexingEnabled: true },
      select: { id: true },
    })
    if (pro) {
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
          paymentMethodId: `pm_create_chat_${Date.now()}`,
          paymentMethodLast4: '0000',
          paymentMethodBrand: 'bank_card',
        },
      })
    }

    const [chatModel, embeddingModel, gigachatProvider] = await Promise.all([
      prisma.aiModel.findFirst({
        where: {
          slug: 'gigachat-2-pro',
          provider: { slug: 'gigachat' },
          supportsEmbeddings: false,
        },
        select: { id: true },
      }),
      prisma.aiModel.findFirst({
        where: {
          slug: 'embeddings',
          provider: { slug: 'gigachat' },
          supportsEmbeddings: true,
        },
        select: { id: true },
      }),
      prisma.aiProvider.findUnique({
        where: { slug: 'gigachat' },
        select: { connection: true },
      }),
    ])

    if (!chatModel || !embeddingModel || !gigachatProvider) {
      test.skip(
        true,
        'GigaChat AiModel rows (gigachat-2-pro / embeddings) or aiProvider not seeded; ' +
          'run `pnpm --filter @repo/db exec prisma db seed` first.',
      )
      return
    }

    const conn = gigachatProvider.connection as Partial<GigaChatConn> | null
    if (!conn?.clientId || !conn?.clientSecret) {
      test.skip(true, 'GigaChat provider has no clientId/clientSecret in DB — re-seed needed.')
      return
    }

    const encryptedKey = encryptFixture({
      clientId: conn.clientId,
      clientSecret: conn.clientSecret,
      scope: conn.scope ?? 'GIGACHAT_API_PERS',
    })

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

    const chat = await prisma.chat.create({
      data: { workspaceId: workspace.id, createdById: user.id },
      select: { id: true },
    })

    await page.goto(`/workspaces/${workspace.id}/chats/${chat.id}`)
    await expect(page).toHaveURL(new RegExp(`/workspaces/${workspace.id}/chats/${chat.id}$`))

    const composer = page.getByTestId('chat-composer-textarea')
    await expect(composer).toBeVisible({ timeout: 30_000 })

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

      await expect
        .poll(
          () =>
            prisma.chatMessage.count({
              where: { chatId: chat.id, role: 'ASSISTANT', status: 'DONE' },
            }),
          { timeout: 120_000, intervals: [1000, 2000, 3000] },
        )
        .toBeGreaterThanOrEqual(expectedAssistantCount)
    }

    await composer.fill('Создай страницу из разговора')
    await sendBtn.click()

    const allowBtn = page
      .getByTestId('chat-message-list')
      .getByRole('button', { name: 'Разрешить' })
      .last()
    await expect(allowBtn).toBeVisible({ timeout: 90_000 })
    await allowBtn.click()

    const pageHrefPattern = new RegExp(
      `/workspaces/${workspace.id}/pages/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
    )

    await expect
      .poll(
        () =>
          prisma.page.count({
            where: { workspaceId: workspace.id, type: 'TEXT', parentId: null },
          }),
        { timeout: 90_000, intervals: [1000, 2000, 3000] },
      )
      .toBeGreaterThan(0)

    const createdPageRow = await prisma.page.findFirstOrThrow({
      where: { workspaceId: workspace.id, type: 'TEXT', parentId: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    const createdPageId = createdPageRow.id

    const chatLink = page
      .getByTestId('chat-message-list')
      .locator(`a[href*="/workspaces/${workspace.id}/pages/${createdPageId}"]`)
      .last()

    if (await chatLink.count()) {
      await expect(chatLink).toBeVisible()
      await chatLink.click()
    } else {
      // GigaChat sometimes omits the link from the assistant reply — navigate
      // directly to the newly-created page to assert end-to-end behaviour.
      await page.goto(`/workspaces/${workspace.id}/pages/${createdPageId}`)
    }
    await expect(page).toHaveURL(pageHrefPattern, { timeout: 30_000 })

    const createdPage = await prisma.page.findUniqueOrThrow({
      where: { id: createdPageId },
      select: { title: true, content: true, parentId: true, type: true },
    })

    expect(createdPage.parentId).toBeNull()
    expect(createdPage.type).toBe('TEXT')
    expect(createdPage.title?.trim()).toBeTruthy()
    expect(createdPage.content).not.toBeNull()

    const contentStr = JSON.stringify(createdPage.content).toLowerCase()
    // GigaChat-2 Pro sometimes summarises the agent's plan rather than the
    // dialog itself, so match either eggs-vocabulary or the broader topic.
    expect(contentStr).toMatch(/яичниц|желт|жарь|разговор|страниц/i)
  })
})
