import { expect, test } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

test('text page mounts the AnyNoteEditor', async ({ page }) => {
  const email = `editor+${Date.now()}@example.com`

  // Sign up and authenticate
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Редактор' })

  // First-workspace create. On a cold dev server hydration can lag behind the
  // first fill() — re-fill until React registers the value (security.spec.ts /
  // appearance-pwa.spec.ts pattern).
  const nameInput = page.getByRole('textbox', { name: 'Название' })
  const createButton = page.getByRole('button', { name: 'Создать пространство' })
  await expect(async () => {
    await nameInput.fill('Editor Smoke')
    await expect(createButton).toBeEnabled({ timeout: 2_000 })
  }).toPass({ timeout: 60_000 })
  await createButton.click()
  await page.waitForURL(/\/(pages|chats)\//)

  // Open the "Создание страницы" dialog from the sidebar and pick "Текст".
  await page.getByRole('button', { name: 'Новая страница' }).first().click()
  await page.getByRole('button', { name: 'Создать страницу: Текст' }).click()

  // Page route should navigate, and the editor DOM should appear.
  await page.waitForURL(/\/pages\/[a-f0-9-]+/, { timeout: 15_000 })

  const editor = page.locator('.anynote-editor .ProseMirror')
  await expect(editor).toBeVisible({ timeout: 15_000 })
})
