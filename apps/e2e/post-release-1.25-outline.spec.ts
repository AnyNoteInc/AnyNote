import { expect, test, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

/**
 * Post-release 1.25 regression for the right-hand page-outline mini-bar (#3):
 * the `nav[aria-label="Содержание страницы"]` must be vertically centered in
 * the viewport instead of anchored to `top: 80`.
 *
 * Runs against `next dev` with no Hocuspocus server. The outline is driven
 * purely from the Tiptap/ProseMirror in-memory document, so editor content
 * does NOT need Yjs persistence — we only assert the nav position in the
 * current render, never after a reload.
 */

async function createWorkspace(page: Page): Promise<void> {
  await page.getByRole('textbox', { name: 'Название' }).fill('Outline 1.25')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/(pages|chats)\//, { timeout: 30_000 })
}

async function createTextPage(page: Page): Promise<void> {
  const previousUrl = page.url()
  await page.getByRole('button', { name: 'Новая страница' }).first().click()
  await page.getByRole('button', { name: 'Создать страницу: Текст' }).click()
  await page.waitForURL(
    (url) => /\/pages\/[a-f0-9-]+/.test(url.toString()) && url.toString() !== previousUrl,
    { timeout: 30_000 },
  )
  await expect(page.locator('.anynote-editor .ProseMirror')).toBeVisible({ timeout: 30_000 })
}

/**
 * Type three headings into the Tiptap editor using the markdown input rule:
 *   `## Text` + Enter  →  h2 node
 *
 * The editor uses Tiptap's `typography` / heading input rule so `## ` at the
 * start of a paragraph turns it into an h2.  We type the full `## Title` and
 * then press Enter so Tiptap fires the input rule and produces an actual
 * heading node, which `extractHeadings()` in EditorOutline picks up.
 */
async function typeHeadings(page: Page): Promise<void> {
  const editor = page.locator('.anynote-editor .ProseMirror')
  await editor.click()
  await page.keyboard.type('## Раздел первый')
  await page.keyboard.press('Enter')
  await page.keyboard.type('## Раздел второй')
  await page.keyboard.press('Enter')
  await page.keyboard.type('## Раздел третий')
  await page.keyboard.press('Enter')

  // Wait until the DOM reflects at least one h2 so we know the input rule fired.
  await expect(editor.locator('h2').first()).toBeVisible({ timeout: 10_000 })
}

test('right outline nav is vertically centered', async ({ page }) => {
  const email = `outline-centered-${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password: 'Test12345!' })
  await createWorkspace(page)

  await page.getByRole('button', { name: 'Домашняя', exact: true }).click()
  await createTextPage(page)
  await typeHeadings(page)

  // The outline only renders when headings exist and the viewport is ≥ md
  // (1280×720 is the Playwright default — well above the MUI md breakpoint).
  const nav = page.locator('nav[aria-label="Содержание страницы"]')
  await expect(nav).toBeVisible({ timeout: 10_000 })

  const box = await nav.boundingBox()
  if (!box) throw new Error('nav bounding box is null — outline not rendered')

  const viewportHeight = page.viewportSize()?.height
  if (!viewportHeight) throw new Error('viewport size not available')

  const navCenterY = box.y + box.height / 2
  const viewportCenterY = viewportHeight / 2

  // The nav's vertical midpoint must be within 40 px of the viewport midpoint.
  // 40 px is generous enough to absorb sub-pixel rounding and any thin browser
  // chrome but tight enough to catch the old `top: 80` alignment (which would
  // place the center at ~120px on a 720px viewport, ~360px off-centre).
  expect(
    Math.abs(navCenterY - viewportCenterY),
    `nav center (${navCenterY.toFixed(1)}) should be within 40 px of viewport center (${viewportCenterY})`,
  ).toBeLessThan(40)
})
