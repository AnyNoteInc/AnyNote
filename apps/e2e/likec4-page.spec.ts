import { type Page, expect, test } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

// Two views on purpose: the old custom view-picker combobox only rendered when
// views.length > 1, so a multi-view model is what guards its removal.
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
  view people {
    title 'People'
    include user
  }
}`

// Unclosed `model {` brace — a parse error. LikeC4's fromSource resolves such
// invalid source (it doesn't throw), so the model used to flow into ReactLikeC4
// and crash the page on render.
const INVALID_MODEL = `specification {
  element system
model {
  app = system 'App'`

async function setupLikec4Page(page: Page) {
  const email = `likec4+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Тест' })
  await page.getByRole('textbox', { name: 'Название' }).fill('LikeC4 WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/chats/, { timeout: 15_000 })

  await page.getByRole('button', { name: 'Страницы' }).click()
  const createPageButton = page.getByRole('button', { name: 'Новая страница' })
  await expect(createPageButton).toBeVisible()
  await createPageButton.click()
  await page.getByRole('menuitem', { name: 'Диаграмма' }).click()
  await page.getByRole('button', { name: 'Создать страницу: LikeC4' }).click()
  await page.waitForURL(/\/pages\/[a-f0-9-]+/, { timeout: 15_000 })
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

test('renders a multi-view diagram full-width with no view combobox', async ({ page }) => {
  await setupLikec4Page(page)
  await setMonacoSource(page, MODEL)

  // The xyflow canvas mounts nodes once parse + graphviz-wasm layout succeed.
  // (ReactLikeC4 renders into an open shadow root; Playwright's CSS locators
  // pierce it, so .react-flow__node still matches.)
  const preview = page.locator('[data-testid="likec4-preview"]')
  await expect(preview).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 30_000 })

  // View navigation is LikeC4's own (ReactLikeC4) — the custom combobox is gone,
  // even though the model has two views.
  await expect(page.locator('[data-testid="likec4-view-select"]')).toHaveCount(0)

  // The diagram host fills the preview width instead of being letterboxed to its
  // aspect ratio (the removed keepAspectRatio behaviour).
  const previewBox = await preview.boundingBox()
  const viewBox = await page.locator('.likec4-view').first().boundingBox()
  expect(previewBox).not.toBeNull()
  expect(viewBox).not.toBeNull()
  expect(viewBox!.width).toBeGreaterThan(previewBox!.width * 0.95)
})

test('shows a compile error for invalid source instead of crashing', async ({ page }) => {
  await setupLikec4Page(page)
  await setMonacoSource(page, INVALID_MODEL)

  // The compile error must surface as the error chip, and the preview container
  // must stay mounted — i.e. the page did not crash.
  const error = page.locator('[data-testid="likec4-error"]')
  await expect(error).toBeVisible({ timeout: 30_000 })
  await expect(error).toContainText(/Line \d+:/)
  await expect(page.locator('[data-testid="likec4-preview"]')).toBeVisible()
})
