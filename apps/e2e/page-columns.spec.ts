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
import { CalloutSchema } from '../../packages/editor/src/extensions/callout.schema'
import { ToggleSchema } from '../../packages/editor/src/extensions/toggle.schema'

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

const yjsExtensions = [StarterKit, ColumnLayoutSchema, ColumnSchema, CalloutSchema, ToggleSchema]

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

function emptyParagraph() {
  return { type: 'paragraph' }
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

function callout(...blocks: Array<Record<string, unknown>>) {
  return {
    type: 'callout',
    attrs: { emoji: '💡' },
    content: blocks,
  }
}

function toggle(...blocks: Array<Record<string, unknown>>) {
  return {
    type: 'toggle',
    attrs: { open: true },
    content: blocks,
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
  await moveBlockHandleTo(page, sourceLocator, x, y)
  await page.mouse.up()
}

async function moveBlockHandleTo(
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
}

async function createTaskListPage(page: Page, tag: string) {
  await signUp(page, tag)
  const editor = await createTextPage(page)
  await editor.click()
  await page.keyboard.type('/')
  await page.locator('[data-slash-item-id="task"]').click()
  await page.keyboard.type('Task 1')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Task 2')
  await expect(page.locator('.anynote-task-item')).toHaveCount(2, { timeout: 5_000 })
  return editor
}

test('dragging a task item past the right edge of its list creates a 2-column row with each task in its own list', async ({
  page,
}) => {
  await createTaskListPage(page, 'task-cols-right')

  const task2 = page.locator('.anynote-task-item').nth(1)
  const task2Box = await task2.boundingBox()
  const list = page.locator('ul[data-type="taskList"]').first()
  const listBox = await list.boundingBox()
  if (!task2Box || !listBox) throw new Error('task list/items not visible')

  await dragBlockTo(page, task2, listBox.x + listBox.width + 32, task2Box.y + task2Box.height / 2)

  await expect(page.locator('.column-layout')).toHaveCount(1, { timeout: 5_000 })
  const cells = page.locator('.column-layout > .column')
  await expect(cells).toHaveCount(2)

  const leftItems = cells.nth(0).locator('.anynote-task-item')
  const rightItems = cells.nth(1).locator('.anynote-task-item')
  await expect(leftItems).toHaveCount(1)
  await expect(rightItems).toHaveCount(1)
  await expect(leftItems.first()).toContainText('Task 1')
  await expect(rightItems.first()).toContainText('Task 2')

  await expect(cells.nth(0).locator('.anynote-task-item input[type="checkbox"]')).toHaveCount(1)
  await expect(cells.nth(1).locator('.anynote-task-item input[type="checkbox"]')).toHaveCount(1)

  await expect(page.locator('.column-divider')).toHaveCount(1)
})

test('dragging a task item out of a column moves the checkbox with its text', async ({
  page,
}) => {
  const editor = await createTaskListPage(page, 'task-cols-out')

  const task2 = page.locator('.anynote-task-item').nth(1)
  const task2Box = await task2.boundingBox()
  const list = page.locator('ul[data-type="taskList"]').first()
  const listBox = await list.boundingBox()
  if (!task2Box || !listBox) throw new Error('task list/items not visible')

  await dragBlockTo(page, task2, listBox.x + listBox.width + 32, task2Box.y + task2Box.height / 2)
  await expect(page.locator('.column-layout')).toHaveCount(1, { timeout: 5_000 })

  const layout = page.locator('.column-layout').first()
  const rightTask = layout.locator('.column').nth(1).locator('.anynote-task-item')
  const layoutBox = await layout.boundingBox()
  if (!layoutBox) throw new Error('column layout not visible')

  await dragBlockTo(page, rightTask, layoutBox.x + layoutBox.width / 2, layoutBox.y + layoutBox.height + 24)

  await expect(editor.locator('.anynote-task-item input[type="checkbox"]')).toHaveCount(2)
  await expect(editor.locator('.anynote-task-item', { hasText: 'Task 2' })).toHaveCount(1)
  await expect
    .poll(async () =>
      editor.locator('.anynote-task-item').evaluateAll((items) =>
        items.map((item) => ({
          text: (item.textContent ?? '').trim(),
          hasCheckbox: Boolean(item.querySelector('input[type="checkbox"]')),
        })),
      ),
    )
    .toEqual([
      { text: 'Task 1', hasCheckbox: true },
      { text: 'Task 2', hasCheckbox: true },
    ])
})

test('dragging a task item above its task list reorders it above without losing the checkbox', async ({
  page,
}) => {
  const editor = await createTaskListPage(page, 'task-cols-above')

  const task2 = page.locator('.anynote-task-item').nth(1)
  const list = page.locator('ul[data-type="taskList"]').first()
  const listBox = await list.boundingBox()
  if (!listBox) throw new Error('task list not visible')

  // Drop above the list — TOP zone needs cursor X within the list's bounds and Y above its top edge.
  await dragBlockTo(page, task2, listBox.x + listBox.width / 2, listBox.y - 16)

  await expect(page.locator('.column-layout')).toHaveCount(0)
  await expect(editor.locator('.anynote-task-item input[type="checkbox"]')).toHaveCount(2)

  const order = await editor.evaluate((root) => {
    const items = Array.from(root.querySelectorAll('.anynote-task-item')) as HTMLElement[]
    return items.map((el) => (el.textContent ?? '').trim())
  })
  expect(order[0]).toBe('Task 2')
  expect(order[1]).toBe('Task 1')
})

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

  await expect(page.locator('.column-layout')).toHaveCount(1, { timeout: 5_000 })
  const cells = page.locator('.column-layout > .column')
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

test('dragging a nested paragraph reorders it inside its parent block', async ({ page }) => {
  await createSeededPage(page, 'cols-nested-reorder', {
    type: 'doc',
    content: [callout(paragraph('Nested Alpha'), paragraph('Nested Bravo'))],
  })

  const calloutBlock = page.locator('[data-type="callout"]').first()
  const alpha = calloutBlock.locator('p', { hasText: 'Nested Alpha' })
  const bravo = calloutBlock.locator('p', { hasText: 'Nested Bravo' })
  const alphaBox = await alpha.boundingBox()
  if (!alphaBox) throw new Error('nested alpha not visible')

  await dragBlockTo(page, bravo, alphaBox.x + alphaBox.width / 2, alphaBox.y - 8)

  await expect(page.locator('.ProseMirror > .column-layout')).toHaveCount(0)
  await expect
    .poll(async () =>
      calloutBlock.locator('p').evaluateAll((nodes) =>
        nodes.map((node) => (node.textContent ?? '').trim()).filter(Boolean),
      ),
    )
    .toEqual(['Nested Bravo', 'Nested Alpha'])
})

test('dragging a nested paragraph sideways creates columns inside its parent block', async ({
  page,
}) => {
  await createSeededPage(page, 'cols-nested-create', {
    type: 'doc',
    content: [callout(paragraph('Nested Alpha'), paragraph('Nested Bravo'))],
  })

  const calloutBlock = page.locator('[data-type="callout"]').first()
  const alpha = calloutBlock.locator('p', { hasText: 'Nested Alpha' })
  const bravo = calloutBlock.locator('p', { hasText: 'Nested Bravo' })
  const alphaBox = await alpha.boundingBox()
  if (!alphaBox) throw new Error('nested alpha not visible')

  await dragBlockTo(page, bravo, alphaBox.x + alphaBox.width + 24, alphaBox.y + alphaBox.height / 2)

  await expect(page.locator('.ProseMirror > .column-layout')).toHaveCount(0)
  const nestedLayout = calloutBlock.locator('.column-layout')
  await expect(nestedLayout).toHaveCount(1, { timeout: 5_000 })
  const cells = nestedLayout.locator('> .column')
  await expect(cells).toHaveCount(2)
  await expect(cells.nth(0)).toContainText('Nested Alpha')
  await expect(cells.nth(1)).toContainText('Nested Bravo')
})

test('dragging a paragraph to the right of a callout creates a top-level column row', async ({
  page,
}) => {
  await createSeededPage(page, 'cols-callout-right', {
    type: 'doc',
    content: [callout(paragraph('Callout text')), paragraph('Outside paragraph')],
  })

  const calloutBlock = page.locator('[data-type="callout"]').first()
  const outside = page.locator('.ProseMirror > p', { hasText: 'Outside paragraph' })
  const calloutBox = await calloutBlock.boundingBox()
  if (!calloutBox) throw new Error('callout not visible')

  await dragBlockTo(
    page,
    outside,
    calloutBox.x + calloutBox.width + 24,
    calloutBox.y + calloutBox.height / 2,
  )

  await expect(calloutBlock.locator('p', { hasText: 'Outside paragraph' })).toHaveCount(0)
  await expect(page.locator('.ProseMirror > .column-layout')).toHaveCount(1, { timeout: 5_000 })
  const cells = page.locator('.ProseMirror > .column-layout > .column')
  await expect(cells).toHaveCount(2)
  await expect(cells.nth(0).locator('[data-type="callout"]')).toContainText('Callout text')
  await expect(cells.nth(1)).toContainText('Outside paragraph')
})

test('dragging a paragraph into a toggle moves it inside the toggle content', async ({ page }) => {
  await createSeededPage(page, 'cols-toggle-in', {
    type: 'doc',
    content: [toggle(emptyParagraph()), paragraph('Move into toggle')],
  })

  const toggleBlock = page.locator('.anynote-toggle').first()
  const source = page.locator('.ProseMirror > p', { hasText: 'Move into toggle' })
  const toggleBox = await toggleBlock.boundingBox()
  if (!toggleBox) throw new Error('toggle not visible')

  await dragBlockTo(
    page,
    source,
    toggleBox.x + toggleBox.width / 2,
    toggleBox.y + 8,
  )

  await expect(page.locator('.ProseMirror > p', { hasText: 'Move into toggle' })).toHaveCount(0)
  await expect(toggleBlock.locator('p', { hasText: 'Move into toggle' })).toHaveCount(1)
})

test('nested drop placeholder is anchored to the highlighted block while dragging', async ({
  page,
}) => {
  await createSeededPage(page, 'cols-nested-placeholder', {
    type: 'doc',
    content: [toggle(emptyParagraph()), paragraph('Move into toggle')],
  })

  const toggleBlock = page.locator('.anynote-toggle').first()
  const source = page.locator('.ProseMirror > p', { hasText: 'Move into toggle' })
  const toggleBox = await toggleBlock.boundingBox()
  if (!toggleBox) throw new Error('toggle not visible')

  try {
    await moveBlockHandleTo(page, source, toggleBox.x + toggleBox.width / 2, toggleBox.y + 8)

    const target = toggleBlock.locator('.column-drop-target').first()
    await expect(target).toBeVisible({ timeout: 2_000 })
    await expect
      .poll(async () => target.evaluate((node) => getComputedStyle(node).position))
      .toBe('relative')
  } finally {
    await page.mouse.up()
  }
})

test('dragging the right paragraph out of nested toggle columns dissolves the empty column row', async ({
  page,
}) => {
  await createSeededPage(page, 'cols-toggle-dissolve', {
    type: 'doc',
    content: [toggle(paragraph('Right in toggle')), paragraph('Left outside')],
  })

  const toggleBlock = page.locator('.anynote-toggle').first()
  const outside = page.locator('.ProseMirror > p', { hasText: 'Left outside' })
  const rightInToggle = toggleBlock.locator('p', { hasText: 'Right in toggle' })
  const rightBox = await rightInToggle.boundingBox()
  if (!rightBox) throw new Error('toggle paragraph not visible')

  await dragBlockTo(page, outside, rightBox.x - 24, rightBox.y + rightBox.height / 2)

  const nestedLayout = toggleBlock.locator('.column-layout')
  await expect(nestedLayout).toHaveCount(1, { timeout: 5_000 })
  const cells = nestedLayout.locator('> .column')
  await expect(cells).toHaveCount(2)
  await expect(cells.nth(0)).toContainText('Left outside')
  await expect(cells.nth(1)).toContainText('Right in toggle')

  const toggleBox = await toggleBlock.boundingBox()
  if (!toggleBox) throw new Error('toggle not visible after creating columns')
  const rightCellParagraph = cells.nth(1).locator('p', { hasText: 'Right in toggle' })
  await dragBlockTo(
    page,
    rightCellParagraph,
    toggleBox.x + toggleBox.width / 2,
    toggleBox.y + toggleBox.height + 24,
  )

  await expect(toggleBlock.locator('.column-layout')).toHaveCount(0)
  await expect(toggleBlock.locator('p', { hasText: 'Left outside' })).toHaveCount(1)
  await expect(page.locator('.ProseMirror > p', { hasText: 'Right in toggle' })).toHaveCount(1)
})

test('dragging content out of a multi-column row removes the emptied column', async ({ page }) => {
  const editor = await createSeededPage(page, 'cols-out-of-three', {
    type: 'doc',
    content: [columnLayout('Alpha', 'Bravo', 'Charlie'), paragraph('After row')],
  })

  const bravo = page.locator('.column-layout .column').nth(1).locator('p', { hasText: 'Bravo' })
  const after = page.locator('.ProseMirror > p', { hasText: 'After row' })
  const afterBox = await after.boundingBox()
  if (!afterBox) throw new Error('after paragraph not visible')

  await dragBlockTo(page, bravo, afterBox.x + afterBox.width / 2, afterBox.y + afterBox.height + 4)

  await expect(page.locator('.column-layout')).toHaveCount(1)
  const cells = page.locator('.column-layout > .column')
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

test('drag a paragraph past the right edge of a 3-column row → 4-column row', async ({ page }) => {
  const editor = await createSeededPage(page, 'cols-4', {
    type: 'doc',
    content: [columnLayout('Alpha', 'Bravo', 'Charlie'), paragraph('Delta')],
  })

  const layout = page.locator('.column-layout').first()
  const delta = page.locator('.ProseMirror > p', { hasText: 'Delta' })
  const layoutBox = await layout.boundingBox()
  if (!layoutBox) throw new Error('layout not visible')

  await dragBlockTo(
    page,
    delta,
    layoutBox.x + layoutBox.width + 24,
    layoutBox.y + layoutBox.height / 2,
  )

  const cells = page.locator('.column-layout > .column')
  await expect(cells).toHaveCount(4, { timeout: 5_000 })
  await expect(cells.nth(0)).toContainText('Alpha')
  await expect(cells.nth(1)).toContainText('Bravo')
  await expect(cells.nth(2)).toContainText('Charlie')
  await expect(cells.nth(3)).toContainText('Delta')

  await expect
    .poll(async () => topLevelNonEmptyBlocks(editor))
    .toEqual([expect.objectContaining({ className: expect.stringContaining('column-layout') })])
})

test('dragging the divider redistributes width between adjacent columns', async ({ page }) => {
  await createSeededPage(page, 'cols-resize', {
    type: 'doc',
    content: [columnLayout('Left', 'Right')],
  })

  const cells = page.locator('.column-layout > .column')
  const divider = page.locator('.column-divider').first()
  const dividerBox = await divider.boundingBox()
  if (!dividerBox) throw new Error('divider not visible')

  await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + dividerBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(dividerBox.x + 120, dividerBox.y + dividerBox.height / 2, { steps: 8 })
  await page.mouse.up()

  await expect
    .poll(async () => cells.nth(0).evaluate((el) => Number(el.dataset.width)))
    .toBeGreaterThan(1)
  await expect
    .poll(async () => cells.nth(1).evaluate((el) => Number(el.dataset.width)))
    .toBeLessThan(1)

  const sum = await cells.evaluateAll((nodes) =>
    nodes.reduce((acc, node) => acc + Number((node as HTMLElement).dataset.width || '0'), 0),
  )
  expect(sum).toBeCloseTo(2, 1)

  await expect(page.locator('.column-divider')).toHaveCount(1)
})

test('column dividers appear between columns after every column except the first', async ({
  page,
}) => {
  await createSeededPage(page, 'cols-divider-position', {
    type: 'doc',
    content: [columnLayout('Alpha', 'Bravo', 'Charlie')],
  })

  const cells = page.locator('.column-layout > .column')
  const dividers = page.locator('.column-divider')
  await expect(cells).toHaveCount(3)
  await expect(dividers).toHaveCount(2)

  const boxes = await cells.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect()
      return { left: rect.left, right: rect.right }
    }),
  )
  const dividerBoxes = await dividers.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect()
      return { left: rect.left, right: rect.right }
    }),
  )

  for (let i = 1; i < boxes.length; i++) {
    const dividerBox = dividerBoxes[i - 1]
    const previousCell = boxes[i - 1]
    const currentCell = boxes[i]
    if (!dividerBox || !previousCell || !currentCell) throw new Error('column boxes missing')

    expect(dividerBox.left).toBeGreaterThan(previousCell.right)
    expect(dividerBox.right).toBeLessThan(currentCell.left)
  }
})

test('divider drag is clamped so neither neighbor collapses below the minimum', async ({
  page,
}) => {
  await createSeededPage(page, 'cols-resize-clamp', {
    type: 'doc',
    content: [columnLayout('Left', 'Right')],
  })

  const cells = page.locator('.column-layout > .column')
  const divider = page.locator('.column-divider').first()
  const dividerBox = await divider.boundingBox()
  const layoutBox = await page.locator('.column-layout').first().boundingBox()
  if (!dividerBox || !layoutBox) throw new Error('boxes not visible')

  await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + dividerBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(layoutBox.x + layoutBox.width + 400, dividerBox.y + dividerBox.height / 2, {
    steps: 12,
  })
  await page.mouse.up()

  // sum is 2; MIN_WIDTH_FRACTION = 0.1 → each side >= 0.2.
  const rightWidth = await cells.nth(1).evaluate((el) => Number(el.dataset.width))
  expect(rightWidth).toBeGreaterThanOrEqual(0.2 - 1e-6)
})

test('drag handle does not show for columnLayout or column on row-edge hover', async ({ page }) => {
  await createSeededPage(page, 'cols-no-handle', {
    type: 'doc',
    content: [columnLayout('Alpha', 'Bravo')],
  })

  const layout = page.locator('.column-layout').first()
  const layoutBox = await layout.boundingBox()
  if (!layoutBox) throw new Error('layout not visible')

  // Hover into the gap area between columns (no content block under cursor).
  await page.mouse.move(layoutBox.x + layoutBox.width / 2, layoutBox.y + 4)

  // Drag handle wrapper should not be visible while hovering structural areas.
  const handle = page.locator('.tiptap-drag-handle-wrapper').first()
  // The handle may exist in the DOM but be hidden via opacity / not anchored
  // to a column-layout-typed node. Either way the user-visible buttons must
  // not be reachable here, so we assert it's not pointer-accessible.
  await expect(handle)
    .toBeHidden({ timeout: 2_000 })
    .catch(async () => {
      // If the library keeps the element mounted at opacity:0, ensure that's
      // the case rather than fully visible.
      const opacity = await handle.evaluate((el) => getComputedStyle(el).opacity)
      expect(Number(opacity)).toBeLessThan(0.5)
    })

  // Now hover over a paragraph inside a cell — the handle should appear.
  const alpha = page.locator('.column-layout .column p', { hasText: 'Alpha' }).first()
  await alpha.hover()
  await expect(handle).toBeVisible({ timeout: 2_000 })
})

test('drag handle menu has no cell/row actions', async ({ page }) => {
  await createSeededPage(page, 'cols-menu-clean', {
    type: 'doc',
    content: [columnLayout('Alpha', 'Bravo')],
  })

  const alpha = page.locator('.column-layout .column p', { hasText: 'Alpha' }).first()
  await alpha.hover()
  const dragButton = page
    .locator('.tiptap-drag-handle-wrapper button[aria-label="Действия блока"]')
    .first()
  await expect(dragButton).toBeVisible({ timeout: 5_000 })
  // Dispatch the DOM click directly. The column-divider widget overlays the
  // editor coordinate space at a high z-index and trips Playwright's
  // elementFromPoint actionability check, so a positional click can't always
  // hit the drag handle button reliably. We only need the React onClick
  // handler to fire — the menu visibility assertion below validates the
  // user-visible behavior.
  await dragButton.evaluate((el: HTMLElement) => el.click())

  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible({ timeout: 2_000 })
  await expect(menu.getByText('Удалить ячейку')).toHaveCount(0)
  await expect(menu.getByText('Удалить ряд')).toHaveCount(0)
  await expect(menu.getByText('Развернуть ячейку в блоки')).toHaveCount(0)
})
