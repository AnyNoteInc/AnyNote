import { expect, test } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

test('create, reveal once, list masked, revoke', async ({ page }) => {
  const email = `api-keys-${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password: 'Test12345!' })

  await page.goto('/settings/api')
  await expect(page.getByText('Список пуст — создайте первый ключ.')).toBeVisible({
    timeout: 15_000,
  })

  await page.getByTestId('api-key-create-button').click()
  await page.getByTestId('api-key-name-input').fill('Cursor laptop')
  await page.getByRole('radio', { name: '30 дней' }).check()
  await page.getByTestId('api-key-create-submit').click()

  const fullKey = await page
    .getByTestId('api-key-reveal-fullkey')
    .innerText({ timeout: 10_000 })
  expect(fullKey).toMatch(/^ank_[0-9A-Za-z]{24}$/)

  await page.getByTestId('api-key-reveal-close').click()

  await expect(page.getByTestId('api-keys-table')).toBeVisible()
  const masked = page.locator('[data-testid^="api-key-row-"] td:nth-child(2)').first()
  // Component renders: ank_{keyPrefix(8)}…{keyLastFour(4)} — ellipsis is U+2026
  await expect(masked).toContainText(/ank_[0-9A-Za-z]{8}…[0-9A-Za-z]{4}/)

  // Attach dialog listener BEFORE clicking revoke so the native confirm() is caught
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('[data-testid^="api-key-revoke-"]').first().click()

  await expect(page.getByText('Список пуст — создайте первый ключ.')).toBeVisible({
    timeout: 10_000,
  })
})
