import { test, expect, request as pwRequest } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const enginesUrl = process.env.ENGINES_URL ?? `http://localhost:${process.env.ENGINES_PORT ?? '8082'}`

// After signUpAndAuthAs the user lands on the workspace creation screen.
// Create a workspace so /v1/workspaces returns a non-empty list.
async function createDefaultWorkspace(page: Parameters<typeof signUpAndAuthAs>[0]): Promise<void> {
  await page.getByRole('textbox', { name: 'Название' }).fill('API Test WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/chats\/new$/, { timeout: 30_000 })
}

test('mint key in UI, call /v1/workspaces with Bearer, list current user workspaces', async ({
  page,
}) => {
  const email = `pubapi-${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password: 'Test12345!' })
  await createDefaultWorkspace(page)

  await page.goto('/settings/api')
  await expect(page.getByText('Список пуст — создайте первый ключ.')).toBeVisible({
    timeout: 15_000,
  })

  await page.getByTestId('api-key-create-button').click()
  await page.getByTestId('api-key-name-input').fill('e2e')
  await page.getByRole('radio', { name: '30 дней' }).check()
  await page.getByTestId('api-key-create-submit').click()

  const fullKey = await page
    .getByTestId('api-key-reveal-fullkey')
    .innerText({ timeout: 10_000 })
  expect(fullKey).toMatch(/^ank_[0-9A-Za-z]{24}$/)
  await page.getByTestId('api-key-reveal-close').click()

  const api = await pwRequest.newContext({
    baseURL: enginesUrl,
    extraHTTPHeaders: { Authorization: `Bearer ${fullKey}` },
  })

  const wsResp = await api.get('/v1/workspaces')
  expect(wsResp.status()).toBe(200)
  const data = await wsResp.json()
  expect(Array.isArray(data.workspaces)).toBe(true)
  expect(data.workspaces.length).toBeGreaterThan(0)

  await api.dispose()
})

test('rejects revoked key with 401', async ({ page }) => {
  const email = `revoke-${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password: 'Test12345!' })
  await createDefaultWorkspace(page)

  await page.goto('/settings/api')
  await expect(page.getByText('Список пуст — создайте первый ключ.')).toBeVisible({
    timeout: 15_000,
  })

  await page.getByTestId('api-key-create-button').click()
  await page.getByTestId('api-key-name-input').fill('revoke')
  await page.getByRole('radio', { name: '7 дней' }).check()
  await page.getByTestId('api-key-create-submit').click()

  const fullKey = await page
    .getByTestId('api-key-reveal-fullkey')
    .innerText({ timeout: 10_000 })
  expect(fullKey).toMatch(/^ank_[0-9A-Za-z]{24}$/)
  await page.getByTestId('api-key-reveal-close').click()

  // Attach dialog listener BEFORE clicking revoke so the native confirm() is caught
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('[data-testid^="api-key-revoke-"]').first().click()
  await expect(page.getByText('Список пуст — создайте первый ключ.')).toBeVisible({
    timeout: 10_000,
  })

  const api = await pwRequest.newContext({
    baseURL: enginesUrl,
    extraHTTPHeaders: { Authorization: `Bearer ${fullKey}` },
  })
  const resp = await api.get('/v1/workspaces')
  expect(resp.status()).toBe(401)
  await api.dispose()
})
