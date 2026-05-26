import { expect, test, type Page } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'
const selectedText = 'Комментируемый'
const commentText = 'Это вопрос'

async function createWorkspace(page: Page) {
  await page.getByRole('textbox', { name: 'Название' }).fill('Comments WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/chats/, { timeout: 30_000 })
}

async function createTextPage(page: Page) {
  const previousUrl = page.url()
  await page.getByRole('button', { name: 'Страницы' }).click()
  await page.getByRole('button', { name: 'Новая страница' }).click()
  await page.getByRole('menuitem', { name: 'Текст' }).click()
  await page.waitForURL(
    (url) =>
      /\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/.test(url.toString()) &&
      url.toString() !== previousUrl,
    { timeout: 15_000 },
  )

  const editor = page.locator('.anynote-editor .ProseMirror')
  await expect(editor).toBeVisible({ timeout: 15_000 })
  return editor
}

async function dragSelectEditorText(page: Page, editor: ReturnType<Page['locator']>, text: string) {
  const rect = await editor.locator('p', { hasText: text }).first().evaluate((node, value) => {
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

test('a member adds an inline comment that persists', async ({ page }) => {
  test.setTimeout(120_000)
  const email = `comments+${Date.now()}@example.com`

  await signUpAndAuthAs(page, {
    email,
    password,
    firstName: 'Тест',
    lastName: 'Тест',
  })
  await createWorkspace(page)
  const editor = await createTextPage(page)
  const pageId = /\/pages\/([a-f0-9-]+)/.exec(page.url())?.[1]
  expect(pageId).toBeTruthy()

  await editor.click()
  await page.keyboard.type(selectedText)
  await dragSelectEditorText(page, editor, selectedText)
  await page.getByRole('button', { name: 'Комментировать' }).click()
  await page.getByPlaceholder('Комментарий…').first().fill(commentText)
  await page.getByRole('button', { name: 'Отправить комментарий' }).first().click()

  loadEnvFromRoot()
  const { prisma } = await import('../../packages/db/src/index')
  let thread:
    | {
        id: string
        quotedText: string
        comments: { authorName: string; content: unknown }[]
      }
    | null = null

  for (let i = 0; i < 50; i += 1) {
    thread = await prisma.pageCommentThread.findFirst({
      where: { pageId },
      select: {
        id: true,
        quotedText: true,
        comments: {
          select: { authorName: true, content: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    })
    if (thread?.comments[0]) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  expect(thread?.quotedText).toBe(selectedText)
  expect(thread?.comments[0]?.authorName).toBe('Тест Тест')
  expect(thread?.comments[0]?.content).toMatchObject({ text: commentText })

  const threadId = thread?.id
  expect(threadId).toBeTruthy()

  await page.evaluate((id) => {
    window.localStorage.setItem(`anynote.page-outline-mode.${id}`, 'full')
    window.dispatchEvent(
      new CustomEvent('anynote:outline-mode-change', { detail: { pageId: id, value: 'full' } }),
    )
  }, pageId!)

  // (a) While the doc is still loaded (pre-reload), clicking the in-text highlight
  // opens the thread as a popover and emphasizes the anchor. Verified before the
  // reload because the Playwright env runs no yjs server, so editor content does
  // not survive a reload (the thread itself does, via tRPC — see the sidebar below).
  const highlight = page.locator('.anynote-editor .comment-highlight').first()
  await expect(highlight).toBeVisible({ timeout: 15_000 })

  // The selection toolbar's "Комментировать" tooltip (focus-triggered) overlaps
  // the highlight; Escape closes it and the pointer move clears any hover one,
  // then click the highlight to open the popover.
  await page.mouse.move(0, 0)
  await page.keyboard.press('Escape')
  await highlight.click()
  const popover = page.locator('.comment-popover')
  await expect(popover).toBeVisible({ timeout: 10_000 })
  await expect(popover.getByText(commentText)).toBeVisible()
  await expect(page.locator('.anynote-editor .comment-highlight-active')).toBeVisible({ timeout: 5_000 })

  // (fix #2) Resolving from the popover closes it.
  await popover.getByRole('button', { name: 'Решить' }).click()
  await expect(popover).toBeHidden({ timeout: 5_000 })

  await page.reload()
  await expect(editor).toBeVisible({ timeout: 15_000 })

  // (b) The toolbar icon opens the full sidebar list, without hiding the left sidebar.
  await page.getByRole('button', { name: 'Комментарии', exact: true }).click()
  await expect(page.locator('.workspace-sidebar')).toHaveCount(1)
  const commentsSidebar = page.locator('.comments-sidebar')
  await expect(commentsSidebar).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('navigation', { name: 'Содержание страницы' })).toBeVisible()

  // (fix #1) The comments sidebar is a full-height column: its top sits higher
  // than the content area, which starts below the toolbar.
  const sidebarBox = await commentsSidebar.boundingBox()
  const contentBox = await page.locator('.page-content-scroll').boundingBox()
  expect(sidebarBox).not.toBeNull()
  expect(contentBox).not.toBeNull()
  expect(sidebarBox!.y).toBeLessThan(contentBox!.y)

  // The thread was resolved from the popover (fix #2), so it now lives under "Решённые".
  await commentsSidebar.getByRole('button', { name: 'Решённые' }).click()
  await expect(commentsSidebar.getByText(`«${selectedText}»`)).toBeVisible({ timeout: 10_000 })
  await expect(commentsSidebar.getByText('Тест Тест')).toBeVisible()
  await expect(commentsSidebar.getByText(commentText)).toBeVisible()

  // (c) Closing, then a #comment-<id> hash re-opens the sidebar on that thread.
  await page.getByRole('button', { name: 'Закрыть комментарии' }).click()
  await expect(commentsSidebar).toBeHidden()
  await page.evaluate((id) => {
    window.location.hash = `#comment-${id}`
  }, threadId!)
  await expect(commentsSidebar).toBeVisible({ timeout: 10_000 })
  const stackOrder = await page.evaluate(() => {
    const sidebar = document.querySelector('.comments-sidebar')
    const outline = document.querySelector('nav[aria-label="Содержание страницы"]')
    if (!(sidebar instanceof HTMLElement) || !(outline instanceof HTMLElement)) return null
    return {
      sidebarZ: window.getComputedStyle(sidebar).zIndex,
      outlineZ: window.getComputedStyle(outline).zIndex,
    }
  })
  expect(stackOrder).not.toBeNull()
  expect(Number(stackOrder!.sidebarZ)).toBeGreaterThan(Number(stackOrder!.outlineZ))
  await expect(commentsSidebar.getByText(`«${selectedText}»`)).toBeVisible({ timeout: 10_000 })
})
