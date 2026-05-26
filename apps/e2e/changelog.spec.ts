import { expect, test } from '@playwright/test'

test.describe('Changelog page', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      { name: 'cookie-consent', value: 'accepted', domain: 'localhost', path: '/' },
    ])
  })

  test('renders /changelog for anonymous visitors', async ({ page }) => {
    await page.goto('/changelog')

    await expect(page.getByRole('heading', { level: 1 })).toContainText('История изменений')
    await expect(page.locator('main')).toContainText('Готовится')
    await expect(page.locator('main')).toContainText('Канбан-доски')
  })

  test('is reachable from the AppBar next to pricing', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('link', { name: 'Обновления' }).first().click()
    await expect(page).toHaveURL(/\/changelog$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('История изменений')
  })
})
