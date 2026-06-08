import { type Page, expect, test } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

test.setTimeout(120_000)

async function createTextPage(page: Page, tag: string) {
  const email = `${tag}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Драв', lastName: 'Тестов' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Drawio Block Test')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/(pages|chats)\//)

  const previousUrl = page.url()
  await page.getByRole('button', { name: 'Страницы' }).click()
  await page.getByRole('button', { name: 'Новая страница' }).first().click()
  await page.getByRole('button', { name: 'Создать страницу: Текст' }).click()
  await page.waitForURL(
    (url) =>
      /\/pages\/[a-f0-9-]+/.test(url.toString()) &&
      url.toString() !== previousUrl,
    { timeout: 15_000 },
  )

  const editor = page.locator('.anynote-editor .ProseMirror')
  await expect(editor).toBeVisible({ timeout: 15_000 })
  return editor
}

test('Встраиваемые slash group opens the Draw.io editor modal; Отмена inserts nothing', async ({
  page,
}) => {
  const editor = await createTextPage(page, 'drawio-block')
  await editor.click()
  await editor.press('/')

  await expect(page.getByText('Встраиваемые', { exact: true })).toBeVisible()
  await page.locator('[data-slash-item-id="drawio"]').click()

  await expect(page.getByRole('button', { name: 'Сохранить' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'Отмена' })).toBeVisible()
  const frame = page.locator('iframe[src*="diagrams.net"], iframe[src*="drawio"]')
  await expect(frame).toBeAttached({
    timeout: 15_000,
  })
  await expect(frame).toHaveAttribute('src', /noSaveBtn=1/)
  await expect(frame).toHaveAttribute('src', /saveAndExit=0/)
  await expect(frame).toHaveAttribute('src', /noExitBtn=1/)

  await page.getByRole('button', { name: 'Отмена' }).click()
  await expect(editor.locator('[data-type="drawio"]')).toHaveCount(0)
})
