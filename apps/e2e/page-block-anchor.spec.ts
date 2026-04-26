import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TiptapTransformer } from '@hocuspocus/transformer'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import * as Y from 'yjs'

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
  page: {
    create: (args: unknown) => Promise<{ id: string }>
    delete: (args: unknown) => Promise<unknown>
  }
}

test.setTimeout(120_000)

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
  const db = await import('../../packages/db/src/index')
  RoleType = db.RoleType
  prisma = db.prisma
})

test.afterAll(async () => {
  if (prisma) await prisma.$disconnect()
})

const password = 'SuperSecure123!'

const EXTENSIONS = [Document, Paragraph, Text]

function buildContentYjs(content: object): Uint8Array<ArrayBuffer> {
  const ydoc = TiptapTransformer.toYdoc(content, 'default', EXTENSIONS)
  const src = Y.encodeStateAsUpdate(ydoc)
  const contentYjs = new Uint8Array(new ArrayBuffer(src.byteLength))
  contentYjs.set(src)
  return contentYjs
}

test('block-anchor URL scrolls to and highlights the indexed block', async ({ page: browser }) => {
  const email = `block-anchor+${Date.now()}@example.com`

  // --- Register via UI ---
  await browser.goto('/sign-up')
  await browser.getByRole('textbox', { name: 'Email' }).fill(email)
  await browser.getByRole('textbox', { name: 'Фамилия' }).fill('Тест')
  await browser.getByRole('textbox', { name: 'Имя' }).fill('Якорь')
  await browser.getByRole('textbox', { name: /^пароль$/i }).fill(password)
  await browser.getByRole('textbox', { name: 'Повторите пароль' }).fill(password)
  await browser.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await browser.waitForURL(/\/workspaces\/new/)

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
    data: { name: `Anchor ${Date.now()}`, createdById: user.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: user.id, role: RoleType.OWNER },
  })

  // --- Page with 3 paragraphs (indices 0, 1, 2). Long filler so the
  //     viewport must scroll for #2 to be vertically centered. ---
  const filler = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40)
  const content = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: `Block 0: ${filler}` }] },
      { type: 'paragraph', content: [{ type: 'text', text: `Block 1: ${filler}` }] },
      { type: 'paragraph', content: [{ type: 'text', text: `Block 2 TARGET: ${filler}` }] },
    ],
  }
  const pageRow = await prisma.page.create({
    data: {
      workspaceId: workspace.id,
      title: 'Anchor target',
      type: 'TEXT',
      content,
      contentYjs: buildContentYjs(content),
      createdById: user.id,
      updatedById: user.id,
    },
    select: { id: true },
  })

  try {
    // Navigate directly with the hash in the URL
    await browser.goto(`/workspaces/${workspace.id}/pages/${pageRow.id}#2`)

    const target = browser.locator('[data-block-index="2"]')

    // Element appears once the editor mounts
    await expect(target).toBeVisible({ timeout: 15_000 })
    // Flash class is applied within 2s of arrival.
    // The flash duration is BLOCK_FLASH_DURATION_MS = 3000 in
    // packages/editor/src/block-anchor.ts; bumping that requires the
    // not.toHaveClass timeout below to grow accordingly.
    await expect(target).toHaveClass(/block-flash/, { timeout: 2_000 })
    // Class is removed within 4s (3s flash + slack for Playwright poll cadence).
    await expect(target).not.toHaveClass(/block-flash/, { timeout: 4_000 })
  } finally {
    await prisma.page.delete({ where: { id: pageRow.id } }).catch(() => undefined)
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined)
  }
})
