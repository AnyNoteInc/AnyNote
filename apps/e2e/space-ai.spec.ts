/**
 * Space-AI drafting bar in the editor (space-ai spec §3, plan Task 10).
 *
 * On an editable TEXT page, pressing Space on an EMPTY top-level paragraph
 * opens the space-AI bar (`data-testid="space-ai-bar"`, a Popper — click-away
 * does NOT close it; Esc discards). The draft streams INTO the document as the
 * InlineAI plugin's `.anynote-inline-ai-preview--draft` block decoration (raw
 * markdown text, no toolbar — the bar owns the controls). «Вставить» parses
 * the markdown and replaces the empty trigger paragraph with formatted content
 * (`## Заголовок` → a real h2). Shift+Space bypasses the trigger and types a
 * plain space (prosemirror-keymap matches modifiers exactly).
 *
 * We mock `/api/ai/inline` at the BROWSER (page.route) so no live agents server
 * is needed — the same SSE frame shape the inline-ai-bridge `decodeFrames`
 * parses: `data: {json}\n\n` frames of `{type:'token',text}` + `{type:'done'}`.
 * A 403 `{code:'PLAN'}` response is mapped by the bridge to the plan upsell,
 * painted into `data-testid="space-ai-error"`.
 *
 * Setup is Prisma-driven (the inline-ai.spec.ts precedent): create the user via
 * the sign-up form, then build workspace + member + active subscription + a
 * TEXT page directly in the DB and navigate straight to /pages/[id]. The page
 * is seeded EMPTY on purpose: the space trigger requires the caret on an empty
 * top-level paragraph, which is exactly what a fresh TEXT page renders.
 *
 * E2E REALITIES (CLAUDE.md / MEMORY):
 *  - No yjs server under `next dev` → all assertions are IN-SESSION, NO reload.
 *  - `generateAI` is injected whenever the page is editable (page-renderer) —
 *    independent of provider config; the plan gate is server-side (mocked here).
 *  - The empty-line placeholder advertises the trigger when the capability is
 *    injected: «Нажмите «пробел» для AI или «/» — для команд» (data-placeholder).
 */
import { expect, test, type Page } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

// The two text deltas the mock streams. Token A carries markdown so «Вставить»
// provably parses it (## → h2); B is the body sentence the draft shows.
const DRAFT_TOKEN_A = '## Русская баня\n\n'
const DRAFT_TOKEN_B = 'Тёплый пар и берёзовые веники.'

// EXACTLY the bridge's wire format: raw agents SSE passed through the route
// unchanged. `data: {json}\n\n` frames, `{type:'token',text}` + `done`.
const OK_SSE_BODY =
  `data: {"type":"token","text":${JSON.stringify(DRAFT_TOKEN_A)}}\n\n` +
  `data: {"type":"token","text":${JSON.stringify(DRAFT_TOKEN_B)}}\n\n` +
  `data: {"type":"done"}\n\n`

// The upsell copy the bridge maps a 403/PLAN response to (PLAN_UPSELL in
// inline-ai-bridge.ts); the bar paints it as `space-ai-error`.
const PLAN_UPSELL = 'Доступно на тарифе ПРО и выше'

type Prisma = typeof import('../../packages/db/src/index').prisma

type Setup = { workspaceId: string; pageId: string }

/**
 * Sign up via the form, then build workspace + OWNER membership + active
 * subscription + an EMPTY TEXT page directly in the DB and set it as the
 * active workspace. `withDefaultModel` seeds the AI provider/model +
 * WorkspaceAiSettings.defaultModel (the real route's precondition); the
 * plan-upsell test skips it — the mocked 403 decides, not the DB.
 */
async function setupSpacePage(
  page: Page,
  prisma: Prisma,
  email: string,
  withDefaultModel: boolean,
): Promise<Setup> {
  await signUpAndAuthAs(page, { email, password, firstName: 'Спейс', lastName: 'Тест' })
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })

  const workspace = await prisma.workspace.create({
    data: { name: `Space AI WS ${Date.now()}`, createdById: user.id },
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
        slug: `space-ai-e2e-${Date.now()}`,
        name: 'Space AI E2E',
        connection: { apiKey: 'sk-e2e-fake' },
        workspaceId: workspace.id,
        createdById: user.id,
      },
      select: { id: true },
    })
    const model = await prisma.aiModel.create({
      data: {
        providerId: provider.id,
        slug: `space-e2e-model-${Date.now()}`,
        displayName: 'Space E2E Model',
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
      title: 'Space AI Page',
      createdById: user.id,
    },
    select: { id: true },
  })

  return { workspaceId: workspace.id, pageId: pageRow.id }
}

/**
 * Open the page and click into the editor. The page is seeded empty, so the
 * caret lands on the single empty top-level paragraph — the space trigger's
 * precondition. The `p.is-empty` wait doubles as the focus/caret sync point.
 */
async function openEmptyPage(page: Page, pageId: string) {
  await page.goto(`/pages/${pageId}`)
  const editor = page.locator('.anynote-editor .ProseMirror').first()
  await expect(editor).toBeVisible({ timeout: 30_000 })
  await editor.click()
  await expect(editor.locator('p.is-empty').first()).toBeVisible({ timeout: 10_000 })
  return editor
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

const bar = (page: Page) => page.getByTestId('space-ai-bar')
const draft = (page: Page) => page.locator('.anynote-inline-ai-preview--draft')

test.describe('space AI — drafting bar on an empty line', () => {
  let prisma: Prisma

  test.beforeAll(async () => {
    loadEnvFromRoot()
    const db = await import('../../packages/db/src/index')
    prisma = db.prisma
  })

  test.afterAll(async () => {
    if (prisma) await prisma.$disconnect()
  })

  test('пробел на пустой строке открывает AI-бар, черновик стримится и вставляется', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const { pageId } = await setupSpacePage(
      page,
      prisma,
      `space-ai-accept+${Date.now()}@example.com`,
      true,
    )

    // Capture the request body so we can assert the bar submits action
    // 'generate' + the typed instruction (the inline-ai retry-test pattern).
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

    const editor = await openEmptyPage(page, pageId)
    await page.keyboard.press('Space')
    await expect(bar(page)).toBeVisible({ timeout: 10_000 })

    const instruction = 'сгенерируй текст про русскую баню'
    const input = page.getByTestId('space-ai-input')
    await input.fill(instruction)
    await input.press('Enter')

    // The draft streams INTO the document as the block decoration (raw markdown).
    await expect(draft(page)).toContainText('Тёплый пар', { timeout: 15_000 })
    expect(requestBody?.action).toBe('generate')
    expect(requestBody?.instruction).toBe(instruction)

    await page.getByTestId('space-ai-accept').click()

    // «Вставить» parses the markdown: ## → a real h2 + the body paragraph
    // replace the empty trigger paragraph. Draft + bar are dismissed.
    await expect(editor.locator('h2', { hasText: 'Русская баня' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(editor).toContainText('Тёплый пар и берёзовые веники.')
    await expect(draft(page)).toHaveCount(0)
    await expect(bar(page)).toHaveCount(0)
  })

  test('Esc отклоняет черновик, документ не изменён', async ({ page }) => {
    test.setTimeout(120_000)
    const { pageId } = await setupSpacePage(
      page,
      prisma,
      `space-ai-discard+${Date.now()}@example.com`,
      true,
    )
    await mockOk(page)

    const editor = await openEmptyPage(page, pageId)
    await page.keyboard.press('Space')
    await expect(bar(page)).toBeVisible({ timeout: 10_000 })

    const input = page.getByTestId('space-ai-input')
    await input.fill('напиши текст про баню')
    await input.press('Enter')
    await expect(draft(page)).toContainText('Тёплый пар', { timeout: 15_000 })

    await page.keyboard.press('Escape')

    // Esc aborts + clears the draft + closes the bar; the doc is untouched.
    await expect(bar(page)).toHaveCount(0)
    await expect(draft(page)).toHaveCount(0)
    await expect(editor).not.toContainText('Тёплый пар')
  })

  test('Shift+Space вставляет обычный пробел и не открывает бар', async ({ page }) => {
    test.setTimeout(120_000)
    const { pageId } = await setupSpacePage(
      page,
      prisma,
      `space-ai-shift+${Date.now()}@example.com`,
      true,
    )

    const editor = await openEmptyPage(page, pageId)

    // The empty line advertises the trigger (generateAI injected → placeholder).
    await expect(editor.locator('p.is-empty').first()).toHaveAttribute(
      'data-placeholder',
      /Нажмите «пробел» для AI/,
    )

    await page.keyboard.press('Shift+Space')

    // A plain space was typed: the paragraph is no longer empty. This wait is
    // also the sync point proving the keypress was processed before we assert
    // the bar never opened.
    await expect(editor.locator('p.is-empty')).toHaveCount(0)
    await expect(bar(page)).toHaveCount(0)
    await expect(draft(page)).toHaveCount(0)
  })

  test('подсказка предзаполняет промпт', async ({ page }) => {
    test.setTimeout(120_000)
    const { pageId } = await setupSpacePage(
      page,
      prisma,
      `space-ai-suggest+${Date.now()}@example.com`,
      true,
    )

    await openEmptyPage(page, pageId)
    await page.keyboard.press('Space')
    await expect(bar(page)).toBeVisible({ timeout: 10_000 })

    await page.getByTestId('space-ai-suggestion-brainstorm').click()

    // 'brainstorm' prefills the input (does not submit); suggestions collapse
    // once the input is non-empty.
    await expect(page.getByTestId('space-ai-input')).toHaveValue(/Составь список идей/)
    await expect(page.getByTestId('space-ai-suggestion-brainstorm')).toHaveCount(0)
  })

  test('на тарифе без AI показывается апселл', async ({ page }) => {
    test.setTimeout(120_000)
    // No default model seeded — the mocked 403/PLAN plays the plan gate.
    const { pageId } = await setupSpacePage(
      page,
      prisma,
      `space-ai-plan+${Date.now()}@example.com`,
      false,
    )

    await page.route('**/api/ai/inline', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'AI is not available on this plan', code: 'PLAN' }),
      }),
    )

    await openEmptyPage(page, pageId)
    await page.keyboard.press('Space')
    await expect(bar(page)).toBeVisible({ timeout: 10_000 })

    const input = page.getByTestId('space-ai-input')
    await input.fill('сгенерируй текст про баню')
    await input.press('Enter')

    // The bridge maps 403/PLAN → the upsell copy; the bar paints it as the error.
    await expect(page.getByTestId('space-ai-error')).toHaveText(PLAN_UPSELL, { timeout: 15_000 })
  })
})
