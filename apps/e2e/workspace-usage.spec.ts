import { expect, test, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

const WORKSPACE_NAME = 'Usage WS'

async function signUpAndCreateWorkspace(page: Page, slug: string): Promise<string> {
  const email = `${slug}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Юзер' })
  await page.getByRole('textbox', { name: 'Название' }).fill(WORKSPACE_NAME)
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/chats\/new$/, { timeout: 30_000 })
  const workspaceId = /\/workspaces\/([a-f0-9-]+)\//.exec(page.url())?.[1]
  if (!workspaceId) throw new Error('Failed to extract workspaceId from URL')
  return workspaceId
}

// Settings moved into a full-screen dialog opened from the owner-only space menu.
// The signing-in user created the workspace, so they are the OWNER.
async function openSettingsSection(page: Page, sectionLabel: string) {
  await page.locator('aside').getByText(WORKSPACE_NAME, { exact: true }).click()
  await page.getByRole('button', { name: 'Настройки' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: sectionLabel }).click()
  await expect(dialog.getByRole('button', { name: sectionLabel })).toHaveAttribute(
    'aria-current',
    'page',
  )
  return dialog
}

test('workspace usage section renders limits for personal user', async ({ page }) => {
  await signUpAndCreateWorkspace(page, 'usage-e2e')

  const dialog = await openSettingsSection(page, 'Использование')

  // Member card. "Участники" also appears in the settings nav, so scope to the
  // card heading explicitly.
  await expect(dialog.getByRole('heading', { name: 'Участники' })).toBeVisible()
  await expect(dialog.getByText(/1 из 1/)).toBeVisible()

  // Storage card
  await expect(dialog.getByRole('heading', { name: 'Хранилище файлов' })).toBeVisible()
  await expect(dialog.getByText(/0 .{0,5}из 500\.0 МБ/)).toBeVisible()

  // Two LinearProgress bars (one per card)
  const progressBars = dialog.locator('[role="progressbar"]')
  await expect(progressBars).toHaveCount(2)
})

test('settings dialog exposes the usage section', async ({ page }) => {
  await signUpAndCreateWorkspace(page, 'usage-nav-e2e')

  // Open the dialog on General, then navigate to the Использование section via its nav button.
  const dialog = await openSettingsSection(page, 'Использование')
  await expect(dialog.getByRole('heading', { name: 'Участники' })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Хранилище файлов' })).toBeVisible()
})
