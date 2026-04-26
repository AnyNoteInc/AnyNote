import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { qdrantHasPointForBlock } from './helpers/qdrant-helpers'
import { waitUntil } from './helpers/wait-until'

let RoleType: { OWNER: string }
let prisma: {
  $disconnect: () => Promise<void>
  user: {
    findUniqueOrThrow: (args: unknown) => Promise<{ id: string }>
  }
  workspace: {
    create: (args: unknown) => Promise<{ id: string }>
    delete: (args: unknown) => Promise<unknown>
  }
  workspaceMember: {
    create: (args: unknown) => Promise<unknown>
  }
  workspaceAiSettings: {
    create: (args: unknown) => Promise<unknown>
  }
  aiProvider: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>
  }
  aiModel: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>
  }
  page: {
    create: (args: unknown) => Promise<{ id: string }>
    delete: (args: unknown) => Promise<unknown>
  }
  outboxEvent: {
    create: (args: unknown) => Promise<unknown>
    findFirst: (args: unknown) => Promise<{ status: string } | null>
  }
  chat: {
    create: (args: unknown) => Promise<{ id: string }>
  }
}

test.setTimeout(180_000)

test.beforeAll(async () => {
  const envPath = join(process.cwd(), '.env')
  const envFile = readFileSync(envPath, 'utf8')
  const readVar = (key: string): string | undefined =>
    envFile
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith(`${key}=`))
      ?.slice(`${key}=`.length)
      .replace(/^"|"$/g, '')

  if (!process.env.DATABASE_URL) {
    const databaseUrl = readVar('DATABASE_URL')
    if (!databaseUrl) throw new Error('DATABASE_URL not configured in .env')
    process.env.DATABASE_URL = databaseUrl
  }
  if (!process.env.QDRANT__AUTH__BEARER_TOKEN) {
    const token = readVar('QDRANT__AUTH__BEARER_TOKEN')
    if (token) process.env.QDRANT__AUTH__BEARER_TOKEN = token
  }
  const db = await import('../../packages/db/src/index')
  RoleType = db.RoleType
  prisma = db.prisma
})

test.afterAll(async () => {
  if (prisma) await prisma.$disconnect()
})

const password = 'SuperSecure123!'
const MARKER = 'Бразильский Медведь'
const QUERY = 'Как называется наш корпоративный кофе?'

test('assistant cites page with block-anchor link', async ({ page: browser }) => {
  const email = `rag-anchor+${Date.now()}@example.com`

  // --- Register via UI (better-auth hashes credentials) ---
  await browser.goto('/sign-up')
  await browser.getByRole('textbox', { name: 'Email' }).fill(email)
  await browser.getByRole('textbox', { name: 'Фамилия' }).fill('Тестов')
  await browser.getByRole('textbox', { name: 'Имя' }).fill('РАГ')
  await browser.getByRole('textbox', { name: /^пароль$/i }).fill(password)
  await browser.getByRole('textbox', { name: 'Повторите пароль' }).fill(password)
  await browser.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await browser.waitForURL(/\/workspaces\/new/)

  // --- Wait for user row to exist, then seed workspace + page via Prisma ---
  await expect
    .poll(
      async () =>
        prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } }).catch(() => null),
      { timeout: 10_000, intervals: [200, 500, 1000] },
    )
    .toBeTruthy()

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  })

  const workspace = await prisma.workspace.create({
    data: { name: `RAG anchor ${Date.now()}`, createdById: user.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: user.id, role: RoleType.OWNER },
  })

  const provider = await prisma.aiProvider.findFirst({ where: { slug: 'gigachat' } })
  const model = await prisma.aiModel.findFirst({ where: { slug: 'GigaChat-2' } })
  if (!provider || !model) {
    throw new Error('GigaChat provider/model not seeded; run `pnpm --filter @repo/db prisma:seed`')
  }
  await prisma.workspaceAiSettings.create({
    data: {
      workspaceId: workspace.id,
      defaultModelId: model.id,
      temperature: 0.3,
      topP: 0.9,
      systemPrompt: null,
    },
  })

  // --- Tiptap doc: block 0 = paragraph, 1 = heading (SKIP), 2 = paragraph with MARKER ---
  const pageRow = await prisma.page.create({
    data: {
      workspaceId: workspace.id,
      title: 'Корпоративные напитки',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Документ о напитках в офисе.' }],
          },
          {
            type: 'heading',
            content: [{ type: 'text', text: 'Кофе' }],
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: `Корпоративный кофе нашей компании называется "${MARKER}".`,
              },
            ],
          },
        ],
      },
      createdById: user.id,
      updatedById: user.id,
    },
    select: { id: true },
  })

  // --- Bypass 5-min quiet-period for E2E: next_attempt_at defaults to now() ---
  await prisma.outboxEvent.create({
    data: {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: pageRow.id,
      workspaceId: workspace.id,
      payload: {},
    },
  })

  // --- Wait for engines cron → agents vectorization → outbox DONE ---
  await waitUntil(
    async () => {
      const row = await prisma.outboxEvent.findFirst({
        where: { aggregateId: pageRow.id, eventType: 'page.upserted' },
        orderBy: { createdAt: 'desc' },
      })
      return row?.status === 'DONE'
    },
    { timeout: 90_000, pollMs: 1000, label: 'outbox page.upserted → DONE' },
  )

  // --- Verify Qdrant has a point for block #2 (where MARKER lives) ---
  expect(await qdrantHasPointForBlock(pageRow.id, 2)).toBe(true)

  // --- Create a chat via Prisma (matches existing rag.spec.ts pattern) ---
  const chat = await prisma.chat.create({
    data: { workspaceId: workspace.id, createdById: user.id },
    select: { id: true },
  })

  await browser.goto(`/workspaces/${workspace.id}/chats/${chat.id}`)
  const composer = browser.getByTestId('chat-composer-textarea')
  await expect(composer).toBeVisible()
  await composer.fill(QUERY)
  await browser.getByRole('button', { name: 'Send' }).click()

  // --- Poll until the marker appears in any assistant article ---
  await expect
    .poll(
      async () =>
        browser
          .locator('[role="article"]')
          .allInnerTexts()
          .then((chunks) => chunks.join('\n')),
      { timeout: 120_000, intervals: [1000, 2000] },
    )
    .toContain(MARKER)

  // --- Assert the block-anchor link exists in the DOM ---
  const anchor = browser.locator(`a[href="/workspaces/${workspace.id}/pages/${pageRow.id}#2"]`)
  await expect(anchor).toBeVisible({ timeout: 10_000 })

  // --- Cleanup ---
  await prisma.page.delete({ where: { id: pageRow.id } }).catch(() => undefined)
  await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined)
})
