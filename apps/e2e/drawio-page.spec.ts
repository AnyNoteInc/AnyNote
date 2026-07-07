import { type Page, expect, test } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

async function createDrawioPage(page: Page) {
  const email = `drawio+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Тест' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Drawio WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/(pages|chats)\//, { timeout: 30_000 })

  const createPageButton = page.getByRole('button', { name: 'Новая страница' }).first()
  await expect(createPageButton).toBeVisible()
  await createPageButton.click()
  await page.getByRole('button', { name: 'Создать страницу: Draw.io' }).click()
  await page.waitForURL(/\/pages\/[a-f0-9-]+/, { timeout: 15_000 })
}

test('creates a DRAWIO page that mounts the draw.io embed iframe', async ({ page }) => {
  await createDrawioPage(page)
  const frame = page.locator('iframe[src*="diagrams.net"], iframe[src*="drawio"]')
  await expect(frame.first()).toBeAttached({ timeout: 20_000 })
  await expect(frame.first()).not.toHaveAttribute('src', /noSaveBtn=1/)
  await expect(frame.first()).not.toHaveAttribute('src', /saveAndExit=0/)
  await expect(frame.first()).toHaveAttribute('src', /noExitBtn=1/)
})
