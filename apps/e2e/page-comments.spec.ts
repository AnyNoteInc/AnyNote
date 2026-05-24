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
  await page.getByRole('button', { name: 'Отпр.' }).first().click()

  loadEnvFromRoot()
  const { prisma } = await import('../../packages/db/src/index')
  let thread:
    | {
        quotedText: string
        comments: { authorName: string; content: unknown }[]
      }
    | null = null

  for (let i = 0; i < 50; i += 1) {
    thread = await prisma.pageCommentThread.findFirst({
      where: { pageId },
      select: {
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

  await page.reload()
  await expect(editor).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Комментарии' }).click()
  await expect(page.getByText(`«${selectedText}»`)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(`Тест Тест: ${commentText}`)).toBeVisible()
})
