import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TiptapTransformer } from '@hocuspocus/transformer'
import StarterKit from '@tiptap/starter-kit'
import * as Y from 'yjs'

import { signUpAndAuthAs } from './helpers/auth'
import {
  ColumnLayoutSchema,
  ColumnSchema,
} from '../../packages/editor/src/extensions/column-layout.schema'

const password = 'SuperSecure123!'

let RoleType: { OWNER: string }
let prisma: {
  $disconnect: () => Promise<void>
  user: {
    findUniqueOrThrow: (args: unknown) => Promise<{ id: string }>
  }
  workspace: {
    create: (args: unknown) => Promise<{ id: string }>
  }
  workspaceMember: {
    create: (args: unknown) => Promise<unknown>
  }
  page: {
    create: (args: unknown) => Promise<{ id: string }>
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

type TiptapContent = {
  type: 'doc'
  content: Array<Record<string, unknown>>
}

const yjsExtensions = [StarterKit, ColumnLayoutSchema, ColumnSchema]

function buildContentYjs(content: TiptapContent): Uint8Array<ArrayBuffer> {
  const ydoc = TiptapTransformer.toYdoc(content, 'default', yjsExtensions)
  const src = Y.encodeStateAsUpdate(ydoc)
  const contentYjs = new Uint8Array(new ArrayBuffer(src.byteLength))
  contentYjs.set(src)
  return contentYjs
}

function paragraph(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

function heading(text: string) {
  return { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text }] }
}

function columnLayout(...cells: string[]) {
  return {
    type: 'columnLayout',
    content: cells.map((text) => ({ type: 'column', content: [paragraph(text)] })),
  }
}

async function createSeededPage(page: Page, tag: string, content: TiptapContent) {
  const email = `${tag}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Кол', lastName: 'Тестов' })

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  })
  const workspace = await prisma.workspace.create({
    data: { name: `Cols ${Date.now()}`, createdById: user.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: user.id, role: RoleType.OWNER },
  })
  const pageRow = await prisma.page.create({
    data: {
      workspaceId: workspace.id,
      title: 'Columns DnD',
      type: 'TEXT',
      content,
      contentYjs: buildContentYjs(content),
      createdById: user.id,
      updatedById: user.id,
    },
    select: { id: true },
  })

  await page.goto(`/workspaces/${workspace.id}/pages/${pageRow.id}`)
  const editor = page.locator('.anynote-editor .ProseMirror').first()
  await expect(editor).toBeVisible({ timeout: 15_000 })
  return editor
}

async function topLevelNonEmptyBlocks(editor: ReturnType<Page['locator']>) {
  return editor.evaluate((node) =>
    Array.from(node.children)
      .map((child) => ({
        tag: child.tagName.toLowerCase(),
        className: child.className,
        text: child.textContent ?? '',
      }))
      .filter((child) => child.tag !== 'p' || child.text.trim() !== ''),
  )
}

async function signUp(page: Page, tag: string) {
  const email = `${tag}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Кол', lastName: 'Тестов' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Cols Test')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+/)
}

async function createTextPage(page: Page) {
  const previousUrl = page.url()
  const pagesSection = page
    .getByText('Страницы', { exact: true })
    .locator('xpath=ancestor::*[.//*[@data-testid="AddIcon"]][1]')
  await pagesSection.locator('button:has([data-testid="AddIcon"])').first().click()
  await page.getByRole('menuitem', { name: 'Текст' }).click()
  await page.waitForURL(
    (url) =>
      /\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/.test(url.toString()) &&
      url.toString() !== previousUrl,
    { timeout: 15_000 },
  )
  const editor = page.locator('.anynote-editor .ProseMirror').first()
  await expect(editor).toBeVisible({ timeout: 15_000 })
  return editor
}

async function dragBlockTo(
  page: Page,
  sourceLocator: ReturnType<Page['locator']>,
  x: number,
  y: number,
) {
  await sourceLocator.hover()
  const handle = page
    .locator('.tiptap-drag-handle-wrapper button[aria-label="Действия блока"]')
    .first()
  await expect(handle).toBeVisible({ timeout: 5_000 })
  const handleBox = await handle.boundingBox()
  if (!handleBox) throw new Error('drag handle not visible')
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  // intermediate move so dragstart fires deterministically
  await page.mouse.move(handleBox.x + 20, handleBox.y + 20, { steps: 5 })
  await page.mouse.move(x, y, { steps: 10 })
  await page.mouse.up()
}

test('drag a paragraph past the right edge of another → 2-column row', async ({ page }) => {
  await signUp(page, 'cols-2')
  const editor = await createTextPage(page)
  await editor.click()
  await editor.type('Alpha')
  await editor.press('Enter')
  await editor.type('Bravo')

  const alpha = page.locator('p', { hasText: 'Alpha' }).first()
  const bravo = page.locator('p', { hasText: 'Bravo' }).first()
  const alphaBox = await alpha.boundingBox()
  if (!alphaBox) throw new Error('alpha not visible')

  await dragBlockTo(page, bravo, alphaBox.x + alphaBox.width + 16, alphaBox.y + alphaBox.height / 2)

  await expect(page.locator('.column-layout--2')).toHaveCount(1, { timeout: 5_000 })
  const cells = page.locator('.column-layout--2 > .column')
  await expect(cells).toHaveCount(2)
  await expect(cells.nth(0)).toContainText('Alpha')
  await expect(cells.nth(1)).toContainText('Bravo')
})

test('vertical drag of two plain paragraphs still reorders without creating a row', async ({
  page,
}) => {
  await signUp(page, 'cols-vert')
  const editor = await createTextPage(page)
  await editor.click()
  await editor.type('One')
  await editor.press('Enter')
  await editor.type('Two')

  const one = page.locator('p', { hasText: 'One' }).first()
  const two = page.locator('p', { hasText: 'Two' }).first()
  const twoBox = await two.boundingBox()
  if (!twoBox) throw new Error('two not visible')

  await dragBlockTo(page, one, twoBox.x + twoBox.width / 2, twoBox.y + twoBox.height + 5)

  await expect(page.locator('.column-layout')).toHaveCount(0)
})

test('dragging a heading from below a column row to the gap above it moves before the row', async ({
  page,
}) => {
  const editor = await createSeededPage(page, 'cols-above', {
    type: 'doc',
    content: [columnLayout('Alpha', 'Bravo'), heading('Move Me Above')],
  })

  const layout = page.locator('.column-layout').first()
  const h1 = page.getByRole('heading', { level: 1, name: 'Move Me Above' })
  const layoutBox = await layout.boundingBox()
  if (!layoutBox) throw new Error('layout not visible')

  await dragBlockTo(page, h1, layoutBox.x - 24, layoutBox.y - 32)

  await expect
    .poll(async () => topLevelNonEmptyBlocks(editor))
    .toEqual([
      expect.objectContaining({ tag: 'h1', text: 'Move Me Above' }),
      expect.objectContaining({ className: expect.stringContaining('column-layout') }),
    ])
})

test('dragging a heading from below two column rows to the gap between them moves between rows', async ({
  page,
}) => {
  const editor = await createSeededPage(page, 'cols-between', {
    type: 'doc',
    content: [
      columnLayout('Alpha', 'Bravo'),
      columnLayout('Charlie', 'Delta'),
      heading('Move Me Between'),
    ],
  })

  const layouts = page.locator('.column-layout')
  const firstBox = await layouts.nth(0).boundingBox()
  const secondBox = await layouts.nth(1).boundingBox()
  if (!firstBox || !secondBox) throw new Error('layouts not visible')

  const h1 = page.getByRole('heading', { level: 1, name: 'Move Me Between' })
  const gapY = firstBox.y + firstBox.height + (secondBox.y - (firstBox.y + firstBox.height)) / 2
  await dragBlockTo(page, h1, secondBox.x - 24, gapY)

  await expect
    .poll(async () => topLevelNonEmptyBlocks(editor))
    .toEqual([
      expect.objectContaining({ className: expect.stringContaining('column-layout') }),
      expect.objectContaining({ tag: 'h1', text: 'Move Me Between' }),
      expect.objectContaining({ className: expect.stringContaining('column-layout') }),
    ])
})

test('dragging a heading from below a column row into a specific column moves inside that column', async ({
  page,
}) => {
  await createSeededPage(page, 'cols-into-cell', {
    type: 'doc',
    content: [columnLayout('Alpha', 'Bravo'), heading('Move Me Into Bravo')],
  })

  const bravo = page.locator('.column-layout .column').nth(1).locator('p', { hasText: 'Bravo' })
  const h1 = page.getByRole('heading', { level: 1, name: 'Move Me Into Bravo' })
  const bravoBox = await bravo.boundingBox()
  if (!bravoBox) throw new Error('bravo not visible')

  await dragBlockTo(page, h1, bravoBox.x + bravoBox.width / 2, bravoBox.y + bravoBox.height + 4)

  const cells = page.locator('.column-layout .column')
  await expect(cells.nth(0)).toContainText('Alpha')
  await expect(cells.nth(1)).toContainText('Bravo')
  await expect(cells.nth(1)).toContainText('Move Me Into Bravo')
  await expect(page.locator('.ProseMirror > h1', { hasText: 'Move Me Into Bravo' })).toHaveCount(0)
})

test('dragging content out of a 3-column row removes the emptied column', async ({ page }) => {
  const editor = await createSeededPage(page, 'cols-out-of-three', {
    type: 'doc',
    content: [columnLayout('Alpha', 'Bravo', 'Charlie'), paragraph('After row')],
  })

  const bravo = page.locator('.column-layout .column').nth(1).locator('p', { hasText: 'Bravo' })
  const after = page.locator('.ProseMirror > p', { hasText: 'After row' })
  const afterBox = await after.boundingBox()
  if (!afterBox) throw new Error('after paragraph not visible')

  await dragBlockTo(page, bravo, afterBox.x + afterBox.width / 2, afterBox.y + afterBox.height + 4)

  await expect(page.locator('.column-layout--2')).toHaveCount(1)
  const cells = page.locator('.column-layout--2 > .column')
  await expect(cells).toHaveCount(2)
  await expect(cells.nth(0)).toContainText('Alpha')
  await expect(cells.nth(1)).toContainText('Charlie')

  await expect
    .poll(async () => topLevelNonEmptyBlocks(editor))
    .toEqual([
      expect.objectContaining({ className: expect.stringContaining('column-layout') }),
      expect.objectContaining({ tag: 'p', text: 'After row' }),
      expect.objectContaining({ tag: 'p', text: 'Bravo' }),
    ])
})
