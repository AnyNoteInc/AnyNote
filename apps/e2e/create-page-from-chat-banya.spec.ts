/**
 * Repro spec for two-turn page creation:
 *   1. "расскажи мне про русскую баню"
 *   2. "создай страницу о бане"
 *
 * Expected: ONE confirmation, ONE page created. We log how many "Разрешить"
 * buttons appear over time and what the agent state contains so we can pin
 * down the failure mode.
 */
import { expect, test } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'
import { encryptFixture } from './helpers/encrypt-fixture'

type GigaChatConn = { clientId: string; clientSecret: string; scope?: string }

test.describe('agent repro — two-turn page creation from dialog', () => {
  let prisma: typeof import('../../packages/db/src/index').prisma

  test.beforeAll(async () => {
    loadEnvFromRoot()
    const db = await import('../../packages/db/src/index')
    prisma = db.prisma
  })

  test.afterAll(async () => {
    if (prisma) await prisma.$disconnect()
  })

  test('two-turn banya dialog — one confirmation, one page with link', async ({ page }) => {
    test.setTimeout(600_000)

    const email = `banya-page+${Date.now()}@example.com`
    const password = 'SuperSecure123!'
    await signUpAndAuthAs(page, { email, password, firstName: 'Баня', lastName: 'Тест' })

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    })
    const workspace = await prisma.workspace.create({
      data: { name: `Banya ws ${Date.now()}`, createdById: user.id },
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
          paymentMethodId: `pm_eggs_${Date.now()}`,
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
    expect(chatModel).not.toBeNull()
    expect(embeddingModel).not.toBeNull()
    expect(gigachatProvider).not.toBeNull()
    const conn = gigachatProvider!.connection as Partial<GigaChatConn>
    const encryptedKey = encryptFixture({
      clientId: conn.clientId!,
      clientSecret: conn.clientSecret!,
      scope: conn.scope ?? 'GIGACHAT_API_PERS',
    })
    await prisma.workspaceAiSettings.upsert({
      where: { workspaceId: workspace.id },
      update: {
        defaultModelId: chatModel!.id,
        embeddingsModelId: embeddingModel!.id,
        chatModelConnection: encryptedKey,
        embeddingModelConnection: encryptedKey,
        allowDestructive: false,
      },
      create: {
        workspaceId: workspace.id,
        defaultModelId: chatModel!.id,
        embeddingsModelId: embeddingModel!.id,
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
    const composer = page.getByTestId('chat-composer-textarea')
    await expect(composer).toBeVisible({ timeout: 30_000 })
    const sendBtn = page.getByRole('button', { name: 'Send' })

    // Turn 1: knowledge question (no tool expected)
    await composer.fill('расскажи мне про русскую баню')
    await sendBtn.click()
    await expect
      .poll(
        () =>
          prisma.chatMessage.count({
            where: { chatId: chat.id, role: 'ASSISTANT', status: 'DONE' },
          }),
        { timeout: 180_000, intervals: [1000, 2000, 3000] },
      )
      .toBeGreaterThanOrEqual(1)

    // Turn 2: creation request
    await composer.fill('создай страницу о бане')
    await sendBtn.click()

    // Confirmation arrives
    const confirmBtns = page
      .getByTestId('chat-message-list')
      .getByRole('button', { name: 'Разрешить' })
    await expect(confirmBtns.first()).toBeVisible({ timeout: 120_000 })
    const pagesBefore = await prisma.page.count({ where: { workspaceId: workspace.id } })
    await confirmBtns.first().click()

    // Wait until the page is actually created (the resume → tool execution
    // path is the success signal — polling chatMessage status races with the
    // interrupt-DONE state and false-passes before resume even starts).
    await expect
      .poll(
        () => prisma.page.count({ where: { workspaceId: workspace.id } }),
        { timeout: 180_000, intervals: [1000, 2000, 3000] },
      )
      .toBeGreaterThan(pagesBefore)

    // Count confirmation blocks across all assistant messages for this chat
    // — the user expects exactly ONE confirmation for the creation request.
    const allAssistantMessages = await prisma.chatMessage.findMany({
      where: { chatId: chat.id, role: 'ASSISTANT' },
      select: { parts: true },
    })
    const confirmationCount = allAssistantMessages.reduce((acc, m) => {
      const parts = (m.parts as Array<{ kind?: string }>) ?? []
      return acc + parts.filter((p) => p?.kind === 'confirmation').length
    }, 0)
    const assistantText = allAssistantMessages
      .flatMap((m) => (m.parts as Array<{ type?: string; text?: string }>) ?? [])
      .filter((p) => p?.type === 'text' && p.text)
      .map((p) => p.text)
      .join('\n')

    const finalPageCount = await prisma.page.count({ where: { workspaceId: workspace.id } })
    const allPagesForWs = await prisma.page.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, title: true, content: true, contentYjs: true, deletedAt: true },
    })
    // eslint-disable-next-line no-console
    console.log(
      `[DIAG] workspaceId=${workspace.id} confirmations=${confirmationCount} pages=${finalPageCount} rows=${JSON.stringify(allPagesForWs)}`,
    )

    expect(confirmationCount, 'exactly one confirmation should be requested').toBe(1)
    expect(assistantText, 'critic revision cap must not leak to the user').not.toContain(
      'forced reject',
    )
    expect(finalPageCount, 'page must be created').toBeGreaterThan(pagesBefore)
    const createdPage = allPagesForWs.find((row) => row.content !== null)
    expect(createdPage?.contentYjs, 'editor Yjs body must be persisted').toBeTruthy()
    expect(JSON.stringify(createdPage?.content ?? '').toLowerCase()).toMatch(/бан|пар|веник/)
    const chatLink = page.getByTestId('chat-message-list').getByRole('link', { name: 'здесь' }).last()
    await expect(chatLink).toHaveAttribute(
      'href',
      `/workspaces/${workspace.id}/pages/${createdPage!.id}`,
    )
    await page.goto(`/workspaces/${workspace.id}/pages/${createdPage!.id}`)
    const editor = page.locator('.anynote-editor .ProseMirror').first()
    await expect(editor).toBeVisible({ timeout: 30_000 })
    await expect(editor).toContainText(/бан|пар|веник/i, { timeout: 30_000 })
  })
})
