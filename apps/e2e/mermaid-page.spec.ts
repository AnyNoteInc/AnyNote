import { type Page, expect, test } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

async function setupMermaidPage(page: Page) {
  const email = `mermaid+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Тест' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Mermaid WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  // The new workspace redirects to its /chats route; wait for that redirect to
  // settle BEFORE switching sections, otherwise the pathname-driven section sync
  // reverts our switch to Pages back to Chats mid-click.
  await page.waitForURL(/\/chats/, { timeout: 30_000 })

  // The redesigned sidebar opens on the Chats section; switch to the Pages
  // section, then open the root create-page menu and pick the Mermaid type.
  await page.getByRole('button', { name: 'Страницы' }).click()
  const createPageButton = page.getByRole('button', { name: 'Новая страница' })
  await expect(createPageButton).toBeVisible()
  await createPageButton.click()
  await page.getByRole('menuitem', { name: 'Диаграмма' }).click()
  await page.getByRole('button', { name: 'Создать страницу: MermaidJS' }).click()
  await page.waitForURL(/\/pages\/[a-f0-9-]+/, { timeout: 15_000 })
}

async function typeIntoMonaco(page: Page, text: string) {
  const editor = page.locator('.monaco-editor').first()
  await editor.waitFor({ state: 'visible', timeout: 20_000 })
  await editor.click()
  await page.keyboard.type(text)
}

test('renders a mermaid diagram from typed source', async ({ page }) => {
  await setupMermaidPage(page)
  await typeIntoMonaco(page, 'graph TD; A-->B;')

  const svg = page.locator('[data-testid="mermaid-preview"] svg')
  await expect(svg).toBeVisible({ timeout: 15_000 })
})

test('shows an error panel on invalid syntax', async ({ page }) => {
  await setupMermaidPage(page)
  await typeIntoMonaco(page, 'graph TD; A--')

  await expect(page.locator('[data-testid="mermaid-error"]')).toBeVisible({ timeout: 15_000 })
})

test('export SVG control is present once a diagram renders', async ({ page }) => {
  await setupMermaidPage(page)
  await typeIntoMonaco(page, 'graph TD; A-->B;')
  await expect(page.locator('[data-testid="mermaid-preview"] svg')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-testid="mermaid-export-svg"]')).toBeVisible()
})
