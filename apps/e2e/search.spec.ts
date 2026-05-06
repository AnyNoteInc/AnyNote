import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'
import { TiptapTransformer } from '@hocuspocus/transformer'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import * as Y from 'yjs'

import { signUpAndAuthAs } from './helpers/auth'

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
  searchHistory: {
    deleteMany: (args: unknown) => Promise<unknown>
  }
}

test.setTimeout(120_000)

test.beforeAll(async () => {
  const envPath = join(process.cwd(), '.env')
  const envFile = readFileSync(envPath, 'utf8')
  const readVar = (key: string): string | undefined =>
    envFile
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith(`${key}=`))
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
const extensions = [Document, Paragraph, Text]

function buildContentYjs(content: object): Uint8Array<ArrayBuffer> {
  const ydoc = TiptapTransformer.toYdoc(content, 'default', extensions)
  const src = Y.encodeStateAsUpdate(ydoc)
  const contentYjs = new Uint8Array(new ArrayBuffer(src.byteLength))
  contentYjs.set(src)
  return contentYjs
}

test('Cmd/Alt+K search opens result, anchors block, and records history', async ({
  page,
  browserName,
}) => {
  const email = `workspace-search+${Date.now()}@example.com`

  await page.goto('/sign-up')
  await page.waitForLoadState('networkidle')
  await signUpAndAuthAs(page, { email, password, firstName: 'Search', lastName: 'Tester' })

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  })
  const workspace = await prisma.workspace.create({
    data: { name: `Search ${Date.now()}`, createdById: user.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: user.id, role: RoleType.OWNER },
  })

  const content = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Opening paragraph' }] },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Second block with needleworkspace marker' }],
      },
    ],
  }
  const pageRow = await prisma.page.create({
    data: {
      workspaceId: workspace.id,
      title: 'Workspace Search Alpha',
      type: 'TEXT',
      content,
      contentYjs: buildContentYjs(content),
      createdById: user.id,
      updatedById: user.id,
    },
    select: { id: true },
  })

  try {
    await page.goto(`/workspaces/${workspace.id}`)

    const hotkey = browserName === 'webkit' || process.platform === 'darwin' ? 'Meta+K' : 'Alt+K'
    await page.keyboard.press(hotkey)
    await expect(page.getByPlaceholder('Поиск по страницам')).toBeVisible()

    await page.getByPlaceholder('Поиск по страницам').fill('needleworkspace')
    const result = page.getByRole('option', { name: /Workspace Search Alpha/ })
    await expect(result).toBeVisible({ timeout: 10_000 })
    await result.click()

    await page.waitForURL(new RegExp(`/workspaces/${workspace.id}/pages/${pageRow.id}#1$`))
    const target = page.locator('[data-block-index="1"]')
    await expect(target).toBeVisible({ timeout: 15_000 })
    await expect(target).toHaveClass(/block-flash/, { timeout: 2_000 })
    await expect(target).not.toHaveClass(/block-flash/, { timeout: 6_000 })

    await page.getByRole('button', { name: 'Открыть поиск' }).click()
    await expect(page.getByText('Ранее искали')).toBeVisible()
    await page.getByRole('button', { name: /Workspace Search Alpha/ }).click()

    await page.waitForURL(new RegExp(`/workspaces/${workspace.id}/pages/${pageRow.id}#1$`))
    await expect(target).toHaveClass(/block-flash/, { timeout: 2_000 })
  } finally {
    await prisma.searchHistory
      .deleteMany({ where: { workspaceId: workspace.id } })
      .catch(() => undefined)
    await prisma.page.delete({ where: { id: pageRow.id } }).catch(() => undefined)
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined)
  }
})
