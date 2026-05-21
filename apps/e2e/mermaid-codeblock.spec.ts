import { type Page, expect, test } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

async function setupTextPage(page: Page) {
  const email = `cbpro+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Тест' })
  await page.getByRole('textbox', { name: 'Название' }).fill('CodeBlock WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  // Wait for the /chats redirect to settle before switching sections (see
  // mermaid-page.spec.ts — avoids the section-revert race). Generous timeout:
  // two heavy editor tests share one dev server, so the redirect can lag.
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/chats/, { timeout: 30_000 })

  await page.getByRole('button', { name: 'Страницы' }).click()
  const createBtn = page.getByRole('button', { name: 'Новая страница' })
  await expect(createBtn).toBeVisible()
  await createBtn.click()
  await page.getByRole('menuitem', { name: 'Текст' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/, { timeout: 15_000 })

  const editor = page.locator('.anynote-editor .ProseMirror')
  await expect(editor).toBeVisible({ timeout: 15_000 })
  return editor
}

test('mermaid slash command inserts a code block that renders a diagram', async ({ page }) => {
  const editor = await setupTextPage(page)
  await editor.click()
  await editor.press('/')
  await page.keyboard.type('mermaid')
  await page.getByText('Mermaid', { exact: true }).click()
  await page.keyboard.type('graph TD; A-->B;')

  // code-block-pro shows mermaid blocks as editable code first; click the
  // toolbar toggle (locale 'en' → "Show diagram") to render the SVG.
  await page.getByRole('button', { name: /show diagram/i }).click()
  await expect(page.locator('.anynote-editor svg').first()).toBeVisible({ timeout: 15_000 })
})

test('python code block is syntax-highlighted', async ({ page }) => {
  const editor = await setupTextPage(page)
  await editor.click()
  await editor.press('/')
  await page.keyboard.type('код')
  await page.getByText('Код', { exact: true }).click()
  await page.keyboard.type('def hello():\n    return 1')

  // lowlight emits highlight.js token spans for the registered python grammar
  await expect(page.locator('.anynote-editor .hljs-keyword').first()).toBeVisible({
    timeout: 10_000,
  })
})
