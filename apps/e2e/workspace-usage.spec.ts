import { expect, test, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

async function signUpAndCreateWorkspace(page: Page, slug: string): Promise<string> {
  const email = `${slug}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Юзер' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Usage WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/chats\/new$/, { timeout: 30_000 })
  const workspaceId = /\/workspaces\/([a-f0-9-]+)\//.exec(page.url())?.[1]
  if (!workspaceId) throw new Error('Failed to extract workspaceId from URL')
  return workspaceId
}

test('workspace usage page renders limits for personal user', async ({ page }) => {
  const workspaceId = await signUpAndCreateWorkspace(page, 'usage-e2e')

  await page.goto(`/workspaces/${workspaceId}/settings/usage`)

  // Page heading
  await expect(page.getByRole('heading', { name: 'Использование' })).toBeVisible({
    timeout: 15_000,
  })

  // Member card. "Участники" also appears in the settings nav, so scope to the
  // card heading explicitly.
  await expect(page.getByRole('heading', { name: 'Участники' })).toBeVisible()
  await expect(page.getByText(/1 из 1/)).toBeVisible()

  // Storage card
  await expect(page.getByRole('heading', { name: 'Хранилище файлов' })).toBeVisible()
  await expect(page.getByText(/0 .{0,5}из 500\.0 МБ/)).toBeVisible()

  // Two LinearProgress bars (one per card)
  const progressBars = page.locator('[role="progressbar"]')
  await expect(progressBars).toHaveCount(2)
})

test('settings nav contains usage link', async ({ page }) => {
  const workspaceId = await signUpAndCreateWorkspace(page, 'usage-nav-e2e')

  await page.goto(`/workspaces/${workspaceId}/settings/general`)
  await page.getByRole('link', { name: 'Использование' }).click()
  await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/settings/usage$`))
})
