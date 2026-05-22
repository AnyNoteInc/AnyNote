import { type Page, expect, test } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

async function setupPlantumlPage(page: Page) {
  const email = `plantuml+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Тест' })
  await page.getByRole('textbox', { name: 'Название' }).fill('PlantUML WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/chats/, { timeout: 15_000 })

  await page.getByRole('button', { name: 'Страницы' }).click()
  const createPageButton = page.getByRole('button', { name: 'Новая страница' })
  await expect(createPageButton).toBeVisible()
  await createPageButton.click()
  await page.getByRole('menuitem', { name: 'Диаграмма' }).click()
  await page.getByRole('menuitem', { name: 'PlantUML' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/, { timeout: 15_000 })
}

async function typeIntoMonaco(page: Page, text: string) {
  const editor = page.locator('.monaco-editor').first()
  await editor.waitFor({ state: 'visible', timeout: 20_000 })
  await editor.click()
  await page.keyboard.type(text)
}

test('renders a plantuml diagram from typed source', async ({ page }) => {
  await setupPlantumlPage(page)
  await typeIntoMonaco(page, '@startuml\nAlice -> Bob: hi\n@enduml')

  const svg = page.locator('[data-testid="plantuml-preview"] svg')
  await expect(svg).toBeVisible({ timeout: 20_000 })
})

test('export SVG control is present once a plantuml diagram renders', async ({ page }) => {
  await setupPlantumlPage(page)
  await typeIntoMonaco(page, '@startuml\nAlice -> Bob: hi\n@enduml')
  await expect(page.locator('[data-testid="plantuml-preview"] svg')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-testid="plantuml-export-svg"]')).toBeVisible()
})
