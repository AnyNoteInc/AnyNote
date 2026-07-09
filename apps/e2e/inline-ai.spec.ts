/**
 * Inline AI in the editor (Phase 9D, plan Task 5).
 *
 * The selection bubble-menu «Спросить AI» runs a preset transform, streams a
 * LOCAL preview into the editor (never Yjs until accept), and offers
 * Принять/Повторить/Отклонить.
 *
 * We mock `/api/ai/inline` at the BROWSER (page.route) so no live agents server
 * is needed. The mock fulfils EXACTLY the SSE frame shape the apps/web bridge
 * (`inline-ai-bridge.ts` `decodeFrames`) parses: `data: {json}\n\n` frames of
 * `{type:'token',text}` (→ onToken) and `{type:'done'}` (→ stream end). A non-OK
 * JSON response `{code:'NO_MODEL'}` is mapped by the bridge to the configure
 * hint, which the preview widget paints as an error.
 *
 * Setup is Prisma-driven (the create-page-from-chat-banya precedent): create the
 * user via the sign-up form, then build workspace + member + active subscription
 * + a TEXT page directly in the DB and navigate straight to /pages/[id]. This
 * sidesteps the flaky UI workspace-creation flow (the submit button stays
 * disabled until the async subscription hook lands). We seed
 * WorkspaceAiSettings.defaultModel so the real route would pass its 400-no-model
 * guard; tests a–c exercise the mocked stream path.
 *
 * E2E REALITIES (CLAUDE.md / MEMORY):
 *  - No yjs server under `next dev` → all assertions are IN-SESSION, NO reload.
 *    The page text is typed into the empty editor in-session.
 *  - The «Спросить AI» button shows only when the page is editable (page-renderer
 *    injects `askAI` only when editable) — independent of provider config.
 *  - The streaming preview + its toolbar are plain DOM (HTML <button>s with the
 *    verbatim Russian labels Принять/Повторить/Отклонить); role/text selectors
 *    find them. The action labels are Кратко/Переписать/Грамматика/Перевести/
 *    Короче/Подробнее (inline-ai-popover.tsx).
 */
import { expect, test, type Page } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

// The two text deltas the mock streams (concatenate to «Краткое резюме.»).
const TOKEN_A = 'Краткое '
const TOKEN_B = 'резюме.'
const STREAMED = `${TOKEN_A}${TOKEN_B}`

// EXACTLY the bridge's wire format: raw agents `/agent/run` SSE, passed through
// the route unchanged. `data: {json}\n\n` frames, `{type:'token',text}` + `done`.
const OK_SSE_BODY =
  `data: {"type":"token","text":${JSON.stringify(TOKEN_A)}}\n\n` +
  `data: {"type":"token","text":${JSON.stringify(TOKEN_B)}}\n\n` +
  `data: {"type":"done"}\n\n`

// The configure hint the bridge maps a 400/NO_MODEL response to (CONFIGURE_AI in
// inline-ai-bridge.ts). The preview widget paints it as the error body.
const CONFIGURE_HINT = 'Настройте AI-агента в настройках'

type Prisma = typeof import('../../packages/db/src/index').prisma

type Setup = { workspaceId: string; pageId: string }

/**
 * Sign up via the form, then build workspace + OWNER membership + active
 * subscription + a TEXT page directly in the DB and set it as the active
 * workspace. Returns the workspace + page ids. `withDefaultModel` seeds the AI
 * provider/model + WorkspaceAiSettings.defaultModel (the route's precondition).
 */
async function setupPage(
  page: Page,
  prisma: Prisma,
  email: string,
  withDefaultModel: boolean,
): Promise<Setup> {
  await signUpAndAuthAs(page, { email, password, firstName: 'Инлайн', lastName: 'Тест' })
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })

  const workspace = await prisma.workspace.create({
    data: { name: `Inline AI WS ${Date.now()}`, createdById: user.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: user.id, role: 'OWNER' },
  })

  // Ensure an ACTIVE subscription on a plan that allows AI (aiSettingsEnabled).
  const plan = await prisma.plan.findFirst({
    where: { aiSettingsEnabled: true, chatsEnabled: true },
    select: { id: true },
  })
  if (plan) {
    await prisma.subscription.updateMany({
      where: { userId: user.id, status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } },
      data: { status: 'EXPIRED', expiredAt: new Date() },
    })
    const now = new Date()
    const end = new Date(now)
    end.setMonth(end.getMonth() + 1)
    await prisma.subscription.create({
      data: {
        userId: user.id,
        planId: plan.id,
        status: 'ACTIVE',
        billingPeriod: 'MONTHLY',
        currentPeriodStart: now,
        currentPeriodEnd: end,
      },
    })
  }

  await prisma.userPreference.upsert({
    where: { userId: user.id },
    update: { activeWorkspaceId: workspace.id },
    create: { userId: user.id, activeWorkspaceId: workspace.id },
  })

  if (withDefaultModel) {
    const provider = await prisma.aiProvider.create({
      data: {
        kind: 'OPENAI',
        slug: `inline-ai-e2e-${Date.now()}`,
        name: 'Inline AI E2E',
        connection: { apiKey: 'sk-e2e-fake' },
        workspaceId: workspace.id,
        createdById: user.id,
      },
      select: { id: true },
    })
    const model = await prisma.aiModel.create({
      data: {
        providerId: provider.id,
        slug: `inline-e2e-model-${Date.now()}`,
        displayName: 'Inline E2E Model',
        contextTokens: 8000,
      },
      select: { id: true },
    })
    await prisma.workspaceAiSettings.upsert({
      where: { workspaceId: workspace.id },
      update: { defaultModelId: model.id },
      create: { workspaceId: workspace.id, defaultModelId: model.id },
    })
  }

  const pageRow = await prisma.page.create({
    data: {
      workspaceId: workspace.id,
      type: 'TEXT',
      title: 'Inline AI Page',
      createdById: user.id,
    },
    select: { id: true },
  })

  return { workspaceId: workspace.id, pageId: pageRow.id }
}

/** Open the page editor and type the given text into it (in-session). */
async function openPageWithText(page: Page, pageId: string, text: string) {
  await page.goto(`/pages/${pageId}`)
  const editor = page.locator('.anynote-editor .ProseMirror').first()
  await expect(editor).toBeVisible({ timeout: 30_000 })
  await editor.click()
  await page.keyboard.type(text)
  await expect(editor.locator('p', { hasText: text })).toBeVisible({ timeout: 10_000 })
  return editor
}

/** Drag-select the given text inside the editor (the page-comments precedent). */
async function dragSelectEditorText(page: Page, editor: ReturnType<Page['locator']>, text: string) {
  const rect = await editor
    .locator('p', { hasText: text })
    .first()
    .evaluate((node, value) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
      let textNode = walker.nextNode()
      while (textNode && !textNode.textContent?.includes(value)) {
        textNode = walker.nextNode()
      }
      if (!textNode?.textContent) return null
      const start = textNode.textContent.indexOf(value)
      const range = document.createRange()
      range.setStart(textNode, start)
      range.setEnd(textNode, start + value.length)
      const box = range.getBoundingClientRect()
      return { left: box.left, right: box.right, y: box.top + box.height / 2 }
    }, text)
  expect(rect).not.toBeNull()

  await page.mouse.move(rect!.left + 1, rect!.y)
  await page.mouse.down()
  await page.mouse.move(rect!.right - 1, rect!.y, { steps: 10 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(text)
}

/** Open the «Спросить AI» popover from the selection bubble-menu. */
async function openAskAi(page: Page) {
  const askButton = page.getByRole('button', { name: 'Спросить AI' })
  await expect(askButton).toBeVisible({ timeout: 10_000 })
  await askButton.click()
  await expect(page.getByText('Кратко', { exact: true })).toBeVisible({ timeout: 10_000 })
}

const mockOk = (page: Page) =>
  page.route('**/api/ai/inline', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'cache-control': 'no-cache' },
      body: OK_SSE_BODY,
    }),
  )

const preview = (page: Page) => page.locator('.anynote-inline-ai-preview')
const previewBody = (page: Page) => page.locator('.anynote-inline-ai-preview__body')

test.describe('inline AI — preset transforms in the editor', () => {
  let prisma: Prisma

  test.beforeAll(async () => {
    loadEnvFromRoot()
    const db = await import('../../packages/db/src/index')
    prisma = db.prisma
  })

  test.afterAll(async () => {
    if (prisma) await prisma.$disconnect()
  })

  test('select → «Спросить AI» → «Кратко» streams a preview, «Принять» inserts it', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const { pageId } = await setupPage(
      page,
      prisma,
      `inline-ai-accept+${Date.now()}@example.com`,
      true,
    )
    await mockOk(page)

    const source = 'Длинный исходный текст про котов.'
    const editor = await openPageWithText(page, pageId, source)
    await dragSelectEditorText(page, editor, source)

    await openAskAi(page)
    await page.getByText('Кратко', { exact: true }).click()

    // Streaming preview shows the concatenated tokens (local decoration).
    await expect(previewBody(page)).toHaveText(STREAMED, { timeout: 15_000 })

    await page.getByRole('button', { name: 'Принять' }).click()

    // The accepted text lands in the doc; the preview is dismissed.
    await expect(editor).toContainText(STREAMED, { timeout: 10_000 })
    await expect(preview(page)).toHaveCount(0)
    // Replace action removed the original source text.
    await expect(editor).not.toContainText(source)
  })

  test('«Отклонить» leaves the original text unchanged (no preview inserted)', async ({ page }) => {
    test.setTimeout(120_000)
    const { pageId } = await setupPage(
      page,
      prisma,
      `inline-ai-discard+${Date.now()}@example.com`,
      true,
    )
    await mockOk(page)

    const original = 'Оригинальный текст для проверки отмены.'
    const editor = await openPageWithText(page, pageId, original)
    await dragSelectEditorText(page, editor, original)

    await openAskAi(page)
    await page.getByText('Переписать', { exact: true }).click()
    await expect(previewBody(page)).toHaveText(STREAMED, { timeout: 15_000 })

    await page.getByRole('button', { name: 'Отклонить' }).click()

    // Preview gone, original intact, streamed text never written to the doc.
    await expect(preview(page)).toHaveCount(0)
    await expect(editor.locator('p', { hasText: original })).toBeVisible()
    await expect(editor).not.toContainText(STREAMED)
  })

  test('«Повторить» restreams and accepting once inserts the text exactly once', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const { pageId } = await setupPage(
      page,
      prisma,
      `inline-ai-retry+${Date.now()}@example.com`,
      true,
    )

    // Count how many times the mock fires so we can assert «Повторить» re-calls.
    let calls = 0
    await page.route('**/api/ai/inline', (route) => {
      calls += 1
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: OK_SSE_BODY,
      })
    })

    const source = 'Текст для повторного запроса.'
    const editor = await openPageWithText(page, pageId, source)
    await dragSelectEditorText(page, editor, source)

    await openAskAi(page)
    await page.getByText('Кратко', { exact: true }).click()
    await expect(previewBody(page)).toHaveText(STREAMED, { timeout: 15_000 })
    expect(calls).toBe(1)

    await page.getByRole('button', { name: 'Повторить' }).click()
    // Restreams: the mock fires a second time; the preview shows the text again.
    await expect.poll(() => calls, { timeout: 15_000 }).toBe(2)
    await expect(previewBody(page)).toHaveText(STREAMED, { timeout: 15_000 })

    await page.getByRole('button', { name: 'Принять' }).click()
    await expect(preview(page)).toHaveCount(0)

    // Inserted exactly once — no duplication from the retry.
    const occurrences = await editor.evaluate(
      (node, needle) => (node.textContent?.split(needle).length ?? 1) - 1,
      STREAMED,
    )
    expect(occurrences).toBe(1)
  })

  test('no-provider path: the preview shows the configure hint', async ({ page }) => {
    test.setTimeout(120_000)
    // Deliberately do NOT seed a default model.
    const { pageId } = await setupPage(
      page,
      prisma,
      `inline-ai-noprovider+${Date.now()}@example.com`,
      false,
    )

    // Mock the route returning the same 400/NO_MODEL the real route emits when
    // unconfigured — deterministic in E2E.
    await page.route('**/api/ai/inline', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Workspace AI default model is not configured',
          code: 'NO_MODEL',
        }),
      }),
    )

    const source = 'Текст без настроенного провайдера.'
    const editor = await openPageWithText(page, pageId, source)
    await dragSelectEditorText(page, editor, source)

    await openAskAi(page)
    await page.getByText('Кратко', { exact: true }).click()

    // The bridge maps NO_MODEL → CONFIGURE_AI; the preview paints it as an error.
    await expect(previewBody(page)).toHaveText(CONFIGURE_HINT, { timeout: 15_000 })
    await expect(preview(page)).toHaveAttribute('data-status', 'error')
    // No «Принять» — accept is hidden in the error state (only retry/discard).
    await expect(page.getByRole('button', { name: 'Принять' })).toHaveCount(0)
    // The original paragraph text is untouched.
    await expect(editor.locator('p', { hasText: source })).toBeVisible()
  })

  test('свободная инструкция трансформирует выделение через превью', async ({ page }) => {
    test.setTimeout(120_000)
    const { pageId } = await setupPage(
      page,
      prisma,
      `inline-ai-custom+${Date.now()}@example.com`,
      true,
    )

    // Capture the request body so we can assert the free-form submit carries
    // action:'custom' + the typed instruction (the retry test's counting pattern).
    let requestBody: { action?: string; instruction?: string } | null = null
    await page.route('**/api/ai/inline', (route) => {
      requestBody = route.request().postDataJSON() as typeof requestBody
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: OK_SSE_BODY,
      })
    })

    const source = 'Текст для свободной инструкции.'
    const editor = await openPageWithText(page, pageId, source)
    await dragSelectEditorText(page, editor, source)

    // Open the popover but do NOT pick a preset — type into the free-form input.
    await openAskAi(page)
    const instruction = 'сделай список'
    const input = page.getByTestId('inline-ai-custom-input')
    await input.fill(instruction)
    await input.press('Enter')

    // The custom action streams into the same preview widget.
    await expect(previewBody(page)).toHaveText(STREAMED, { timeout: 15_000 })
    expect(requestBody?.action).toBe('custom')
    expect(requestBody?.instruction).toBe(instruction)

    await page.getByRole('button', { name: 'Принять' }).click()
    await expect(editor).toContainText(STREAMED, { timeout: 10_000 })
    await expect(preview(page)).toHaveCount(0)
  })

  test('«Вставить ниже» сохраняет оригинал и добавляет результат ниже', async ({ page }) => {
    test.setTimeout(120_000)
    const { pageId } = await setupPage(
      page,
      prisma,
      `inline-ai-insert-below+${Date.now()}@example.com`,
      true,
    )
    await mockOk(page)

    const original = 'Оригинал остаётся на месте.'
    const editor = await openPageWithText(page, pageId, original)
    await dragSelectEditorText(page, editor, original)

    await openAskAi(page)
    await page.getByText('Переписать', { exact: true }).click()
    await expect(previewBody(page)).toHaveText(STREAMED, { timeout: 15_000 })

    await page.getByRole('button', { name: 'Вставить ниже' }).click()

    // Insert-below keeps the original block AND adds the result after it.
    await expect(editor.locator('p', { hasText: original })).toBeVisible({ timeout: 10_000 })
    await expect(editor).toContainText(STREAMED)
    await expect(preview(page)).toHaveCount(0)
  })
})
