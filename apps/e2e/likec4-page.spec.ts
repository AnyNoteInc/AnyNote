import { type Page, expect, test } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

const MODEL = `specification {
  element system
  element person
}
model {
  user = person 'User'
  app = system 'App'
  user -> app 'uses'
}
views {
  view index {
    include *
  }
}`

async function setupLikec4Page(page: Page) {
  const email = `likec4+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Тест' })
  await page.getByRole('textbox', { name: 'Название' }).fill('LikeC4 WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/chats/, { timeout: 15_000 })

  await page.getByRole('button', { name: 'Страницы' }).click()
  const createPageButton = page.getByRole('button', { name: 'Новая страница' })
  await expect(createPageButton).toBeVisible()
  await createPageButton.click()
  await page.getByRole('menuitem', { name: 'Диаграмма' }).click()
  await page.getByRole('menuitem', { name: 'LikeC4' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/, { timeout: 15_000 })
}

async function setMonacoSource(page: Page, text: string) {
  const editor = page.locator('.monaco-editor').first()
  await editor.waitFor({ state: 'visible', timeout: 20_000 })
  await editor.click()
  // insertText inserts the whole string via a single input event, bypassing
  // Monaco's per-keystroke bracket/quote auto-closing that would corrupt the
  // braces-heavy LikeC4 source if typed character-by-character.
  await page.keyboard.insertText(text)
}

test('renders a likec4 diagram from typed source', async ({ page }) => {
  await setupLikec4Page(page)
  await setMonacoSource(page, MODEL)

  // The xyflow canvas mounts nodes once parse + graphviz-wasm layout succeed.
  // (ReactLikeC4 renders into an open shadow root; Playwright's CSS locators
  // pierce it, so .react-flow__node still matches.)
  await expect(page.locator('[data-testid="likec4-preview"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 30_000 })
})
