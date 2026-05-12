import { expect, test, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

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

async function dragBlockTo(page: Page, sourceLocator: ReturnType<Page['locator']>, x: number, y: number) {
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
  await page.mouse.up()
}

test('drag a paragraph onto the right edge of another → 2-column row', async ({ page }) => {
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

  await dragBlockTo(page, bravo, alphaBox.x + alphaBox.width - 8, alphaBox.y + alphaBox.height / 2)

  await expect(page.locator('.column-layout--2')).toHaveCount(1, { timeout: 5_000 })
  const cells = page.locator('.column-layout--2 > .column')
  await expect(cells).toHaveCount(2)
})

test('vertical drag of two plain paragraphs still reorders without creating a row', async ({ page }) => {
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
