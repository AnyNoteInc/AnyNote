/**
 * E2E spec: page-chat panel (space-ai spec §7/§8, plan Task 17).
 *
 * On a TEXT page a circular FAB (`page-chat-fab`, bottom-right) opens the
 * 400px right panel (`page-chat-sidebar`). On a chatsEnabled plan the panel
 * hosts the page variant of the workspace chat client: a composer with the
 * context chip («Контекст: Текущая страница» ↔ «Контекст: Выделение» while
 * editor text is selected), a thread switcher Select once listByPage returns
 * ≥1 chat, and a «Новый чат» IconButton. On plans WITHOUT chatsEnabled the FAB
 * stays visible (visible-but-paywalled) and the panel shows the upsell block.
 *
 * We mock `/api/agents/generate` at the BROWSER (page.route) so no live agents
 * server is needed. The mock replays EXACTLY the real route's web-shaped SSE
 * frames (`data: {json}\n\n`, see createEntryResponse in
 * apps/web/src/app/api/agents/generate/route.ts): `message.created` (which
 * reconciles the optimistic pair's temp ids) + `message.status STREAMING`,
 * then a `message.delta`, `message.status DONE` and `message.done`. The chat
 * row itself is created by the REAL tRPC createChat (kind PAGE via pageId) —
 * only the generate stream is mocked, so the server-side auto-rename never
 * runs and the thread keeps its default title «Новый чат» in the switcher.
 *
 * E2E REALITIES (CLAUDE.md / MEMORY):
 *  - No yjs server under `next dev` → all assertions are IN-SESSION, NO reload.
 *  - The mocked generate route never writes messages, so the post-stream
 *    getChat refetch returns [] — the same sync key as the initial mount, so
 *    the optimistic user message must survive (epoch-mount fix under test).
 *  - No AI provider/model seeding: the only consumer (generate) is mocked.
 */
import { expect, test, type Page } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

const PAGE_SENTENCE = 'Это страница про русскую баню и тёплый пар.'

const CONTEXT_PAGE_LABEL = 'Контекст: Текущая страница'
const CONTEXT_SELECTION_LABEL = 'Контекст: Выделение'

// Fake-but-valid UUIDs for the reconciled message pair (message.created swaps
// the optimistic temp ids for these).
const MOCK_USER_MSG_ID = '11111111-1111-4111-8111-111111111111'
const MOCK_ASSISTANT_MSG_ID = '22222222-2222-4222-8222-222222222222'
const MOCK_ASSISTANT_TEXT = 'Ответ ассистента по странице.'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// EXACTLY the wire format the real generate route emits (encodeSseEvent):
// the two initial frames (message.created + STREAMING status), one text
// delta, then the terminal DONE status + message.done.
const OK_SSE_BODY = [
  {
    type: 'message.created',
    assistantMessageId: MOCK_ASSISTANT_MSG_ID,
    userMessageId: MOCK_USER_MSG_ID,
  },
  { type: 'message.status', assistantMessageId: MOCK_ASSISTANT_MSG_ID, status: 'STREAMING' },
  {
    type: 'message.delta',
    assistantMessageId: MOCK_ASSISTANT_MSG_ID,
    segmentIndex: 0,
    text: MOCK_ASSISTANT_TEXT,
  },
  { type: 'message.status', assistantMessageId: MOCK_ASSISTANT_MSG_ID, status: 'DONE' },
  { type: 'message.done', assistantMessageId: MOCK_ASSISTANT_MSG_ID },
]
  .map((event) => `data: ${JSON.stringify(event)}\n\n`)
  .join('')

type Prisma = typeof import('../../packages/db/src/index').prisma

type Setup = { userId: string; workspaceId: string; pageId: string }

type GenerateBody = {
  chatId?: string
  text?: string
  fileIds?: string[]
  pageContext?: { content?: string; isSelection?: boolean }
} | null

/**
 * Sign up via the form, then build workspace + OWNER membership + an EMPTY
 * TEXT page directly in the DB and set it as the active workspace (the
 * space-ai.spec.ts precedent). `plan: 'pro'` expires the sign-up default
 * subscription and activates the first chatsEnabled plan; `plan: 'default'`
 * keeps the seeded personal default (chatsEnabled=false) for the paywall test.
 */
async function setupPageChat(
  page: Page,
  prisma: Prisma,
  email: string,
  plan: 'pro' | 'default',
): Promise<Setup> {
  await signUpAndAuthAs(page, { email, password, firstName: 'Чат', lastName: 'Страничный' })
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })

  const workspace = await prisma.workspace.create({
    data: { name: `Page chat WS ${Date.now()}`, createdById: user.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: user.id, role: 'OWNER' },
  })

  if (plan === 'pro') {
    const proPlan = await prisma.plan.findFirstOrThrow({
      where: { chatsEnabled: true },
      select: { id: true },
    })
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
        planId: proPlan.id,
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

  const pageRow = await prisma.page.create({
    data: {
      workspaceId: workspace.id,
      type: 'TEXT',
      title: 'Page chat page',
      createdById: user.id,
    },
    select: { id: true },
  })

  return { userId: user.id, workspaceId: workspace.id, pageId: pageRow.id }
}

/** Open the page editor and type the given text into it (inline-ai idiom).
 *  The typed sentence is what getPageContext serialises to markdown, so the
 *  captured pageContext.content is provably non-empty. */
async function openPageWithText(page: Page, pageId: string, text: string) {
  await page.goto(`/pages/${pageId}`)
  const editor = page.locator('.anynote-editor .ProseMirror').first()
  await expect(editor).toBeVisible({ timeout: 30_000 })
  await editor.click()
  await page.keyboard.type(text)
  await expect(editor.locator('p', { hasText: text })).toBeVisible({ timeout: 10_000 })
  return editor
}

/** Open the page-chat panel via the FAB. The FAB sits fixed bottom-right —
 *  exactly under the TanStack Query devtools bubble that `next dev` injects —
 *  so a real mouse click is intercepted by the devtools overlay (dev-only;
 *  the established repo idiom is a programmatic element click, the
 *  Playwright-click-under-widget-overlay precedent). */
async function openChatPanel(page: Page) {
  const fab = page.getByTestId('page-chat-fab')
  await expect(fab).toBeVisible({ timeout: 15_000 })
  await fab.evaluate((el) => (el as HTMLElement).click())
  const panel = page.getByTestId('page-chat-sidebar')
  await expect(panel).toBeVisible({ timeout: 10_000 })
  // The FAB Zoom-hides while the panel is open (single close affordance is the
  // «Скрыть чат» header button); it reappears on close.
  await expect(fab).toBeHidden({ timeout: 5_000 })
  return panel
}

/** Drag-select the given text inside the editor (the page-comments/inline-ai
 *  precedent) — keyboard shortcuts are unreliable across platforms. */
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

test.describe('page chat — панель чата по странице', () => {
  let prisma: Prisma

  test.beforeAll(async () => {
    loadEnvFromRoot()
    const db = await import('../../packages/db/src/index')
    prisma = db.prisma
  })

  test.afterAll(async () => {
    if (prisma) await prisma.$disconnect()
  })

  test('FAB открывает панель, сообщение уходит с контекстом страницы, чат не попадает в общий список', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const { userId, workspaceId, pageId } = await setupPageChat(
      page,
      prisma,
      `page-chat-send+${Date.now()}@example.com`,
      'pro',
    )

    // Register the mock BEFORE any action that could trigger the request.
    let generateBody: GenerateBody = null
    await page.route('**/api/agents/generate', (route) => {
      generateBody = route.request().postDataJSON() as GenerateBody
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: OK_SSE_BODY,
      })
    })

    await openPageWithText(page, pageId, PAGE_SENTENCE)

    const panel = await openChatPanel(page)

    // Collapsed caret after typing → page context, not selection.
    await expect(panel.getByTestId('chat-context-chip')).toHaveText(CONTEXT_PAGE_LABEL, {
      timeout: 15_000,
    })

    const probe = `пробное сообщение ${Date.now()}`
    const composer = panel.getByTestId('chat-composer-textarea')
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await composer.fill(probe)
    await composer.press('Enter')

    // The optimistic user message renders immediately AND survives the lazy
    // chat creation + the post-stream getChat refetch (epoch-mount fix).
    const messageList = panel.getByTestId('chat-message-list')
    await expect(messageList.getByText(probe)).toBeVisible({ timeout: 15_000 })

    // The mocked SSE delta streams into the reconciled assistant message.
    await expect(messageList.getByText(MOCK_ASSISTANT_TEXT)).toBeVisible({ timeout: 15_000 })

    // Captured request: chat created lazily via the REAL createChat (UUID id),
    // page context injected as full-page markdown of the typed sentence.
    expect(generateBody).not.toBeNull()
    expect(generateBody!.chatId).toMatch(UUID_RE)
    expect(generateBody!.text).toBe(probe)
    expect(generateBody!.pageContext?.isSelection).toBe(false)
    expect(typeof generateBody!.pageContext?.content).toBe('string')
    expect(generateBody!.pageContext!.content!.length).toBeGreaterThan(0)
    expect(generateBody!.pageContext!.content).toContain('русскую баню')

    // listByPage was invalidated after creation → the thread switcher appears,
    // showing the default title (the auto-rename lives in the REAL generate
    // route, which is mocked away — the thread stays «Новый чат»).
    const switcher = page.getByTestId('page-chat-switcher')
    await expect(switcher).toBeVisible({ timeout: 20_000 })
    await expect(switcher).toContainText('Новый чат')

    // Rename the active thread through the overflow menu (spec §7): the
    // switcher label reflects the new title after the listByPage refetch.
    await page.getByTestId('page-chat-menu').click()
    await page.getByTestId('page-chat-rename').click()
    const renameField = page.getByRole('dialog').getByRole('textbox')
    await expect(renameField).toBeVisible()
    await renameField.fill('Переименованный тред')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(switcher).toContainText('Переименованный тред', { timeout: 15_000 })

    // Control row: a NORMAL chat must show up in the global /chats sidebar —
    // proving the list rendered — while the PAGE chat id stays absent.
    const controlChat = await prisma.chat.create({
      data: { workspaceId, createdById: userId, title: 'Контрольный обычный чат' },
      select: { id: true },
    })

    const pageChatId = generateBody!.chatId!
    await page.goto('/chats/new')
    await expect(page.locator(`a[href="/chats/${controlChat.id}"]`)).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.locator(`a[href="/chats/${pageChatId}"]`)).toHaveCount(0)
    await expect(page.getByText(probe)).toHaveCount(0)
  })

  test('выделение переключает контекст-чип', async ({ page }) => {
    test.setTimeout(120_000)
    const { pageId } = await setupPageChat(
      page,
      prisma,
      `page-chat-selection+${Date.now()}@example.com`,
      'pro',
    )

    const editor = await openPageWithText(page, pageId, PAGE_SENTENCE)

    await openChatPanel(page)

    const chip = page.getByTestId('chat-context-chip')
    await expect(chip).toHaveText(CONTEXT_PAGE_LABEL, { timeout: 15_000 })

    // Select the typed sentence → the chip flips to selection context.
    await dragSelectEditorText(page, editor, PAGE_SENTENCE)
    await expect(chip).toHaveText(CONTEXT_SELECTION_LABEL, { timeout: 10_000 })

    // Collapse the selection (caret to the right edge) → back to page context.
    await page.keyboard.press('ArrowRight')
    await expect(chip).toHaveText(CONTEXT_PAGE_LABEL, { timeout: 10_000 })
  })

  test('панель показывает апселл на тарифе без чатов, FAB виден', async ({ page }) => {
    test.setTimeout(120_000)
    // No plan upgrade: the sign-up default (personal, chatsEnabled=false).
    const { pageId } = await setupPageChat(
      page,
      prisma,
      `page-chat-paywall+${Date.now()}@example.com`,
      'default',
    )

    await page.goto(`/pages/${pageId}`)
    await expect(page.locator('.anynote-editor .ProseMirror').first()).toBeVisible({
      timeout: 30_000,
    })

    // Visible-but-paywalled: the FAB renders on EVERY plan (openChatPanel
    // asserts FAB visibility before opening).
    await openChatPanel(page)

    const upsell = page.getByTestId('page-chat-upsell')
    await expect(upsell).toBeVisible({ timeout: 10_000 })
    await expect(upsell).toContainText('на тарифе ПРО и выше')

    const pricingLink = upsell.locator('a[href="/pricing"]')
    await expect(pricingLink).toBeVisible()

    // No chat UI on the paywalled panel.
    await expect(page.getByTestId('chat-composer-textarea')).toHaveCount(0)
    await expect(page.getByTestId('page-chat-new')).toHaveCount(0)
  })

  test('режим отображения переключается на плавающее окно и обратно', async ({ page }) => {
    test.setTimeout(120_000)
    const { pageId } = await setupPageChat(
      page,
      prisma,
      `page-chat-mode+${Date.now()}@example.com`,
      'pro',
    )

    await openPageWithText(page, pageId, PAGE_SENTENCE)
    const panel = await openChatPanel(page)
    await expect(panel).toHaveAttribute('data-mode', 'docked')

    // Switch to the floating window via the header mode menu.
    await panel.getByTestId('page-chat-mode').evaluate((el) => (el as HTMLElement).click())
    await page.getByTestId('page-chat-mode-floating').click()
    const floating = page.getByTestId('page-chat-sidebar')
    await expect(floating).toHaveAttribute('data-mode', 'floating', { timeout: 10_000 })
    await expect(floating).toBeVisible()
    // Floating window keeps the header controls (the static «Чат» label is
    // gone — the mode button anchors the header now); the FAB stays hidden.
    await expect(floating.getByTestId('page-chat-mode')).toBeVisible()
    await expect(page.getByTestId('page-chat-fab')).toBeHidden()

    // Hide via «Скрыть чат» — the FAB comes back.
    await floating.getByRole('button', { name: 'Скрыть чат' }).click()
    await expect(page.getByTestId('page-chat-sidebar')).toBeHidden({ timeout: 10_000 })
    await expect(page.getByTestId('page-chat-fab')).toBeVisible({ timeout: 10_000 })

    // Re-open: the floating preference persisted (localStorage).
    await page.getByTestId('page-chat-fab').evaluate((el) => (el as HTMLElement).click())
    await expect(page.getByTestId('page-chat-sidebar')).toHaveAttribute('data-mode', 'floating', {
      timeout: 10_000,
    })
  })
})
