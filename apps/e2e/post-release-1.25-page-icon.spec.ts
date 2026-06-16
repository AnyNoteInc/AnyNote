import { expect, test, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

/**
 * Regression for the icon-gutter change: adding a page icon must NOT shift the
 * page title to the right. The icon hangs absolutely in the left gutter; the
 * title's x position stays fixed regardless of whether an icon is present.
 *
 * Like the rest of the post-release E2E suite, this runs against `next dev`
 * with no Hocuspocus server; it only exercises tRPC/layout behavior.
 */

async function createWorkspace(page: Page): Promise<void> {
  await page.getByRole('textbox', { name: 'Название' }).fill('Иконка')
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

test('page title keeps its x position when an icon is added; icon sits to its left', async ({
  page,
}) => {
  const email = `page-icon-gutter-${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password: 'Test12345!' })
  await createWorkspace(page)

  await page.getByRole('button', { name: 'Домашняя', exact: true }).click()
  await createTextPage(page)

  // ── Locate the title element ──────────────────────────────────────────────
  // The page starts with «Новая страница» placeholder text rendered as an h3
  // (Typography variant="h3"). Use role=heading to be robust against markup
  // changes; the heading level is 3 because MUI h3 renders as <h3>.
  const titleEl = page.getByRole('heading', { level: 3 }).first()
  await expect(titleEl).toBeVisible({ timeout: 10_000 })

  const box0 = await titleEl.boundingBox()
  if (!box0) throw new Error('title bounding box not found before adding icon')
  const x0 = box0.x

  // ── Add an icon via the «Добавить иконку» ghost button ───────────────────
  // The ghost button is opacity:0 normally — hover the header area first.
  const headerArea = page.locator('.page-header__add-action').first()
  await headerArea.hover()

  const addIconBtn = page.getByRole('button', { name: 'Добавить иконку' })
  await expect(addIconBtn).toBeVisible({ timeout: 5_000 })
  await addIconBtn.click()

  // The IconPickerPopover opens. It shows an EmojiPicker from emoji-picker-react.
  // Wait for the picker shell to appear first.
  await expect(page.locator('.EmojiPickerReact').first()).toBeVisible({ timeout: 8_000 })

  // emoji-picker-react renders each individual emoji as a <button data-unified="…">
  // inside the grid. This is the most stable selector: data-unified is set to the
  // Unicode codepoint(s) of the emoji and is NOT present on meta/control buttons
  // (search-clear, category tabs, skin-tone picker).
  const emojiBtn = page.locator('button[data-unified]').first()
  await expect(emojiBtn).toBeVisible({ timeout: 8_000 })
  await emojiBtn.click()

  // Wait for the icon to appear in the page header (the IconButton aria-label
  // changes from "Добавить иконку" to "Изменить иконку" once an icon is set).
  const iconBtn = page.getByRole('button', { name: 'Изменить иконку' })
  await expect(iconBtn).toBeVisible({ timeout: 10_000 })

  // ── Measure title x after icon is set ────────────────────────────────────
  const box1 = await titleEl.boundingBox()
  if (!box1) throw new Error('title bounding box not found after adding icon')
  const x1 = box1.x

  // The title's left edge must not have moved (within 2 px tolerance).
  expect(
    Math.abs(x1 - x0),
    `title x shifted by ${Math.abs(x1 - x0)}px (was ${x0}, now ${x1})`,
  ).toBeLessThan(2)

  // ── Assert icon hangs to the LEFT of the title ───────────────────────────
  const iconBox = await iconBtn.boundingBox()
  if (!iconBox) throw new Error('icon button bounding box not found')
  const iconRightEdge = iconBox.x + iconBox.width

  expect(
    iconRightEdge,
    `icon right edge (${iconRightEdge}) must be <= title left edge (${x1})`,
  ).toBeLessThanOrEqual(x1 + 1) // +1 px tolerance for sub-pixel rendering
})
