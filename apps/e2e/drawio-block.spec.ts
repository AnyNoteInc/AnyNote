import { type Page, expect, test } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

test.setTimeout(120_000)

async function createTextPage(page: Page, tag: string) {
  const email = `${tag}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Драв', lastName: 'Тестов' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Drawio Block Test')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+/)

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

test('Встраивание slash group opens the Draw.io editor modal; Отмена inserts nothing', async ({
  page,
}) => {
  const editor = await createTextPage(page, 'drawio-block')
  await editor.click()
  await editor.press('/')

  await expect(page.getByText('Встраивание', { exact: true })).toBeVisible()
  await page.locator('[data-slash-item-id="drawio"]').click()

  await expect(page.getByRole('button', { name: 'Сохранить' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'Отмена' })).toBeVisible()
  await expect(page.locator('iframe[src*="diagrams.net"], iframe[src*="drawio"]')).toBeAttached({
    timeout: 15_000,
  })

  await page.getByRole('button', { name: 'Отмена' }).click()
  await expect(editor.locator('[data-type="drawio"]')).toHaveCount(0)
})
