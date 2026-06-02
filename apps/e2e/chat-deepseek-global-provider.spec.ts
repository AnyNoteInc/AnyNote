/**
 * Regression guard for the "DeepSeek provider requires an api_key" 500.
 *
 * The DeepSeek provider is a GLOBAL provider (workspaceId null) whose
 * credentials live in `connectionEnc` while the plaintext `connection` is `{}`.
 * The old resolveProviderConnection only decrypted connectionEnc when
 * `workspaceId` was set, so for this provider it fell back to the empty
 * plaintext connection and the agents service threw InvalidPayloadError
 * ("DeepSeek provider requires an api_key in the connection config").
 *
 * This spec wires a fresh workspace to the existing global DeepSeek model WITHOUT
 * any per-workspace connection override, forcing resolution through the
 * provider's connectionEnc, and asserts the assistant produces a real answer
 * (DONE, non-empty text, no error part).
 */
import { expect, test } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

test.describe('chat — global DeepSeek provider resolves connectionEnc', () => {
  let prisma: typeof import('../../packages/db/src/index').prisma

  test.beforeAll(async () => {
    loadEnvFromRoot()
    const db = await import('../../packages/db/src/index')
    prisma = db.prisma
  })

  test.afterAll(async () => {
    if (prisma) await prisma.$disconnect()
  })

  test('answers a trivial question without an api_key error', async ({ page }) => {
    test.setTimeout(300_000)

    // The global DeepSeek chat model must already exist (seeded/configured in
    // this environment). If it is absent, skip rather than false-fail.
    const chatModel = await prisma.aiModel.findFirst({
      where: { provider: { kind: 'DEEPSEEK' }, supportsEmbeddings: false, isActive: true },
      select: { id: true, slug: true, provider: { select: { workspaceId: true, connectionEnc: true } } },
    })
    test.skip(!chatModel, 'no global DeepSeek model configured in this environment')
    // Guard the exact production shape: global provider with creds in connectionEnc.
    expect(chatModel!.provider.workspaceId, 'DeepSeek provider must be global').toBeNull()
    expect(chatModel!.provider.connectionEnc, 'DeepSeek creds must be in connectionEnc').not.toBeNull()

    const email = `ds-global+${Date.now()}@example.com`
    const password = 'SuperSecure123!'
    await signUpAndAuthAs(page, { email, password, firstName: 'Дип', lastName: 'Сик' })

    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })
    const workspace = await prisma.workspace.create({
      data: { name: `DeepSeek ws ${Date.now()}`, createdById: user.id },
      select: { id: true },
    })
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: user.id, role: 'OWNER' },
    })

    const pro = await prisma.plan.findFirst({
      where: { chatsEnabled: true },
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
          paymentMethodId: `pm_ds_${Date.now()}`,
          paymentMethodLast4: '0000',
          paymentMethodBrand: 'bank_card',
        },
      })
    }

    // Point the workspace at the global DeepSeek model with NO connection
    // override — resolution must come from the provider's connectionEnc.
    await prisma.workspaceAiSettings.upsert({
      where: { workspaceId: workspace.id },
      update: { defaultModelId: chatModel!.id, allowDestructive: false },
      create: { workspaceId: workspace.id, defaultModelId: chatModel!.id, allowDestructive: false },
    })

    const chat = await prisma.chat.create({
      data: { workspaceId: workspace.id, createdById: user.id },
      select: { id: true },
    })

    await page.goto(`/workspaces/${workspace.id}/chats/${chat.id}`)
    const composer = page.getByTestId('chat-composer-textarea')
    await expect(composer).toBeVisible({ timeout: 30_000 })

    await composer.fill('Привет! Ответь одним словом: столица Франции?')
    await page.getByRole('button', { name: 'Send' }).click()

    // The assistant message must reach DONE (the fix lets the run complete
    // instead of 500-ing on a missing api_key).
    await expect
      .poll(
        () =>
          prisma.chatMessage.count({
            where: { chatId: chat.id, role: 'ASSISTANT', status: 'DONE' },
          }),
        { timeout: 180_000, intervals: [1000, 2000, 3000] },
      )
      .toBeGreaterThanOrEqual(1)

    const assistant = await prisma.chatMessage.findFirstOrThrow({
      where: { chatId: chat.id, role: 'ASSISTANT', status: 'DONE' },
      select: { parts: true },
    })
    const parts = (assistant.parts as Array<{ type?: string; kind?: string; text?: string }>) ?? []
    const errorParts = parts.filter((p) => p?.type === 'error' || p?.kind === 'error')
    expect(errorParts, 'assistant must not contain an error part').toHaveLength(0)
    const text = parts
      .filter((p) => p?.type === 'text' && p.text)
      .map((p) => p.text)
      .join('\n')
      .toLowerCase()
    expect(text, 'assistant must produce a non-empty answer').not.toEqual('')
    expect(text, 'api_key error must not leak into the answer').not.toContain('api_key')
    expect(text, 'answer should mention Paris').toMatch(/париж|paris/)
  })
})
