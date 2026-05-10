import { test, expect } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

test.describe('User consents', () => {
  test('sign-up writes 5 consent rows visible in /settings/consents', async ({ page }) => {
    const email = `consents-signup-${Date.now()}@example.com`
    await signUpAndAuthAs(page, { email, password: 'Password123!' })

    await page.goto('/settings/consents')
    await expect(page.getByRole('heading', { name: 'Согласия' })).toBeVisible()
    await expect(page.getByRole('row')).toHaveCount(6) // header + 5 rows
    await expect(page.getByText('Пользовательское соглашение')).toBeVisible()
    await expect(page.getByText(/информационных и рекламных рассылок/i)).toBeVisible()
  })

  test('redirects to /onboarding/consents when required consents are missing', async ({ page }) => {
    const email = `onboarding-${Date.now()}@example.com`
    await signUpAndAuthAs(page, { email, password: 'Password123!' })

    // Simulate a legacy or OAuth user with no consent rows
    const { prisma } = await import('../../packages/db/src/index')
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } })
    if (!user) throw new Error('user disappeared')
    await prisma.userConsent.deleteMany({ where: { userId: user.id } })

    await page.goto('/profile')
    await page.waitForURL(/\/onboarding\/consents/, { timeout: 10_000 })
    await expect(page.getByRole('heading', { name: 'Завершите регистрацию' })).toBeVisible()

    // Accept required (no marketing)
    await page.getByTestId('register-terms-checkbox').check()
    await page.getByRole('button', { name: 'Принять и продолжить' }).click()

    await page.waitForURL(/\/profile/, { timeout: 10_000 })

    // Now the consents row-set should be present in /settings/consents
    await page.goto('/settings/consents')
    await expect(page.getByRole('row')).toHaveCount(6)
    await expect(page.getByText(/информационных и рекламных рассылок/i)).toBeVisible()
  })
})
