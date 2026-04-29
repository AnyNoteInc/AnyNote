import { expect, test } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

test('text page mounts the AnyNoteEditor', async ({ page }) => {
  const email = `editor+${Date.now()}@example.com`

  // Sign up and authenticate
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Редактор' })

  // First-workspace create
  await page.getByRole('textbox', { name: 'Название' }).fill('Editor Smoke')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+/)

  // Open the "+" menu on the "Страницы" header and pick "Текстовая страница".
  // The "+" button is a sibling of the "Страницы" overline inside the section header row.
  const pagesHeaderRow = page
    .getByText('Страницы', { exact: true })
    .locator('xpath=ancestor::*[.//button][1]')
  await pagesHeaderRow.getByRole('button').click()
  await page.getByRole('menuitem', { name: 'Текст' }).click()

  // Page route should navigate, and the editor DOM should appear.
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/, { timeout: 15_000 })

  const editor = page.locator('.anynote-editor .ProseMirror')
  await expect(editor).toBeVisible({ timeout: 15_000 })
})
