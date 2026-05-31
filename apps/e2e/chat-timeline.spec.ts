/**
 * E2E spec: assistant chat timeline (true text↔tool interleaving + state-coloured dots).
 *
 * Requires:
 *   - docker compose up -d (postgres) — the Playwright dev server on :3100 talks
 *     to the same Postgres the rest of the suite uses.
 *
 * The Playwright `webServer` is just `next dev` with NO agents backend, so a live
 * streamed run is not reproducible here (mirrors chat-expansion.spec.ts, which only
 * asserts the optimistic insert). Instead we seed a persisted assistant ChatMessage
 * whose `parts` are an interleaved [text, tool(done), text, tool(error)] ordered
 * segment list — exactly the shape the new streaming pipeline persists — then open
 * the existing chat (`/workspaces/{id}/chats/{chatId}`) and assert the renderer:
 *   1. draws the parts inside a single MUI Timeline, in array order (the first tool
 *      appears BEFORE the second text — not hoisted/grouped to the end), and
 *   2. colours the timeline dot by tool state (done → primary, error → error).
 *
 * The live streamed timeline is verified manually via the Playwright MCP browser
 * against the real agents SSE stream (not in CI).
 */

import { expect, test, type Page } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

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

// The ordered segment list the streaming pipeline now persists to ChatMessage.parts.
// Deliberately starts with a tool and interleaves text↔tool so the OLD type-grouping
// renderer (text first, tools last) would reorder it — the assertion below proves the
// new renderer keeps array order.
const INTERLEAVED_PARTS = [
  { type: 'text', text: 'Сейчас поищу в рабочем пространстве.' },
  {
    type: 'tool',
    id: 'tl-search-1',
    kind: 'tool',
    state: 'done',
    title: 'Поиск по страницам',
    detail: JSON.stringify({ tool: 'search_workspace_pages' }),
    result: 'Найдена страница «Roadmap»',
  },
  { type: 'text', text: 'Нашёл одну подходящую страницу — вот итоговый ответ.' },
  {
    type: 'tool',
    id: 'tl-get-2',
    kind: 'tool',
    state: 'error',
    title: 'Чтение страницы',
    detail: JSON.stringify({ tool: 'get_page' }),
    result: "tool 'get_page' error: not found",
  },
]

/**
 * Sign up a fresh user, create a workspace they own, and seed a chat that already
 * holds one user message and one assistant message with interleaved parts. Returns
 * the workspace + chat ids so the test can open the existing chat directly.
 */
async function seedChatWithTimeline(
  page: Page,
  slug: string,
): Promise<{ workspaceId: string; chatId: string }> {
  const email = `${slug}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тайм', lastName: 'Лайнов' })

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  })

  const workspace = await prisma.workspace.create({
    data: { name: `Timeline workspace ${Date.now()}`, createdById: user.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: user.id, role: RoleType.OWNER },
  })

  const chat = await prisma.chat.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
      title: 'Timeline chat',
      messages: {
        // status defaults to DONE in the schema (ChatMessageStatus is a type-only
        // export from @repo/db, so we rely on the default rather than the enum value).
        create: [
          {
            role: ChatMessageRole.USER,
            parts: [{ type: 'text', text: 'Найди страницы про roadmap и сделай сводку' }],
          },
          {
            role: ChatMessageRole.ASSISTANT,
            parts: INTERLEAVED_PARTS,
          },
        ],
      },
    },
    select: { id: true },
  })

  return { workspaceId: workspace.id, chatId: chat.id }
}

test('assistant timeline renders interleaved parts in order with state-coloured dots', async ({
  page,
}) => {
  const { workspaceId, chatId } = await seedChatWithTimeline(page, 'chat-timeline')

  await page.goto(`/workspaces/${workspaceId}/chats/${chatId}`)

  const list = page.getByTestId('chat-message-list')
  // The chats route compiles slowly on a cold dev server; give it a generous window.
  await expect(list).toBeVisible({ timeout: 60_000 })

  const firstToolRow = page.getByText('Поиск по страницам')
  const secondText = page.getByText('Нашёл одну подходящую страницу — вот итоговый ответ.')
  const secondToolRow = page.getByText('Чтение страницы')

  await expect(firstToolRow).toBeVisible({ timeout: 15_000 })
  await expect(secondText).toBeVisible()
  await expect(secondToolRow).toBeVisible()

  // (2) Array order is preserved: the first tool appears BEFORE the later text —
  // the OLD type-grouping renderer would have hoisted every tool below the text.
  const toolBeforeText = await firstToolRow.evaluate(
    (tool, text) =>
      Boolean(tool.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING),
    await secondText.elementHandle(),
  )
  expect(toolBeforeText).toBe(true)

  // (1) Rendered inside a single MUI Timeline.
  await expect(page.locator('.MuiTimeline-root').first()).toBeVisible()

  // (3) Dot colour encodes tool state. Tool dots are filled, so MUI emits
  // `MuiTimelineDot-filled{Color}`: the done tool → filledPrimary, the error
  // tool → filledError. (Text/thinking dots are outlinedGrey and excluded.)
  await expect(page.locator('.MuiTimelineDot-filledPrimary')).toHaveCount(1)
  await expect(page.locator('.MuiTimelineDot-filledError')).toHaveCount(1)
})
