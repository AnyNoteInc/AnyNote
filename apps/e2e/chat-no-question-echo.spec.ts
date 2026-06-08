/**
 * E2E spec: a trivial-route answer must NOT open with the user's own question.
 *
 * Bug: the FIRST item in the assistant's response was a repetition of the user's
 * question. Root cause (apps/agents): trivial routing seeds a single plan step
 * whose title IS the raw user_message (router.route_node) purely to give the
 * executor a current_step_id; GraphStreamingService then emitted that as a
 * `plan_step` event, which apps/web turns into a `tool` segment, rendered as a
 * ChatServiceBlock — so the user saw their question echoed back as the first
 * "step". The fix suppresses plan_step emission for trivial routing.
 *
 * Requires:
 *   - docker compose up -d (postgres) — the Playwright dev server on :3100 talks
 *     to the same Postgres the rest of the suite uses.
 *
 * The Playwright `webServer` is just `next dev` with NO agents backend, so a live
 * streamed run is not reproducible here (mirrors chat-timeline.spec.ts). Instead
 * we seed two persisted assistant ChatMessages whose `parts` are exactly the
 * ordered-segment shapes the streaming pipeline persists, and assert the renderer:
 *   1. BEFORE-fix shape (a leading `plan-` tool segment titled with the question)
 *      DOES surface the question as a service block — proving the rendering path
 *      that produced the screenshot.
 *   2. AFTER-fix shape (text-only, the trivial path no longer emits the plan step)
 *      shows the answer first and NO service block echoing the question.
 */

import { expect, test, type Page } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

// The exact question from the bug report.
const QUESTION = 'какой у меня тулинг?'
const ANSWER = 'У тебя подключены инструменты поиска и чтения страниц рабочего пространства.'

let prisma: typeof import('../../packages/db/src/index').prisma
let RoleType: typeof import('../../packages/db/src/index').RoleType
let ChatMessageRole: typeof import('../../packages/db/src/index').ChatMessageRole

test.beforeAll(async () => {
  loadEnvFromRoot()
  const db = await import('../../packages/db/src/index')
  prisma = db.prisma
  RoleType = db.RoleType
  ChatMessageRole = db.ChatMessageRole
})

test.afterAll(async () => {
  if (prisma) await prisma.$disconnect()
})

// What the OLD (buggy) trivial stream persisted: a leading plan tool segment whose
// title is the raw user question, then the answer text.
const BUGGY_PARTS = [
  { type: 'tool', id: 'plan-step-1', kind: 'tool', state: 'pending', title: QUESTION },
  { type: 'text', text: ANSWER },
]

// What the FIXED trivial stream persists: just the answer text (no plan segment).
const FIXED_PARTS = [{ type: 'text', text: ANSWER }]

async function seedChat(
  page: Page,
  slug: string,
  assistantParts: unknown,
): Promise<{ workspaceId: string; chatId: string }> {
  const email = `${slug}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Эхо', lastName: 'Тестов' })

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  })

  const workspace = await prisma.workspace.create({
    data: { name: `Echo workspace ${Date.now()}`, createdById: user.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: user.id, role: RoleType.OWNER },
  })

  const chat = await prisma.chat.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      title: 'Echo chat',
      messages: {
        create: [
          { role: ChatMessageRole.USER, parts: [{ type: 'text', text: QUESTION }] },
          { role: ChatMessageRole.ASSISTANT, parts: assistantParts as object },
        ],
      },
    },
    select: { id: true },
  })

  return { workspaceId: workspace.id, chatId: chat.id }
}

test('REPRO: a leading plan tool segment echoes the question as a service block', async ({
  page,
}) => {
  const { chatId } = await seedChat(page, 'chat-echo-repro', BUGGY_PARTS)

  await page.goto(`/chats/${chatId}`)

  const list = page.getByTestId('chat-message-list')
  await expect(list).toBeVisible({ timeout: 60_000 })
  await expect(list.getByText(ANSWER)).toBeVisible({ timeout: 15_000 })

  // The buggy plan segment renders as a service block whose summary text is the
  // user's own question — this is the echoed first message from the screenshot.
  const serviceBlocks = page.getByTestId('chat-service-block-summary')
  await expect(serviceBlocks).toHaveCount(1)
  await expect(serviceBlocks.filter({ hasText: QUESTION })).toHaveCount(1)
})

test('FIXED: the trivial answer renders first with no question echo', async ({ page }) => {
  const { chatId } = await seedChat(page, 'chat-echo-fixed', FIXED_PARTS)

  await page.goto(`/chats/${chatId}`)

  const list = page.getByTestId('chat-message-list')
  await expect(list).toBeVisible({ timeout: 60_000 })

  // The answer is present.
  await expect(list.getByText(ANSWER)).toBeVisible({ timeout: 15_000 })

  // No service block at all (the plan segment is gone) — so nothing can echo the
  // question. Assert there is no tool/service block in the assistant bubble.
  await expect(page.getByTestId('chat-service-block-summary')).toHaveCount(0)

  // And the question text appears EXACTLY once on the page: in the user bubble,
  // never re-rendered inside the assistant response.
  await expect(page.getByText(QUESTION, { exact: true })).toHaveCount(1)
})
