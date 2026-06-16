import { test, expect } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

test('notifications page renders empty state for a fresh user', async ({ page }) => {
  const email = `notify-${Date.now()}@example.com`
  await signUpAndAuthAs(page, {
    email,
    password: 'pass1234',
    firstName: 'Notify',
    lastName: 'User',
  })

  await page.goto('/notifications')
  await expect(page.getByRole('heading', { name: 'Уведомления' })).toBeVisible()
  await expect(page.getByText(/Здесь будут ваши уведомления/i)).toBeVisible()

  // The standalone page renders the public home-page header (PublicHeader)…
  await expect(page.getByRole('link', { name: 'На главную' })).toBeVisible()
  await expect(page.getByText('Любые заметки')).toBeVisible()
  // …and NOT the per-workspace shell (no sidebar "Скрыть" toggle).
  await expect(page.getByRole('button', { name: 'Скрыть' })).toHaveCount(0)
})

test('preferences matrix renders on /settings/general', async ({ page }) => {
  const email = `prefs-${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password: 'pass1234', firstName: 'Prefs', lastName: 'User' })

  await page.goto('/settings/general')
  await expect(page.getByText('Безопасность').first()).toBeVisible()
  await expect(page.getByText('Совместная работа').first()).toBeVisible()
  await expect(page.getByText(/Маркетинг и дайджест/).first()).toBeVisible()
  await expect(page.getByText('Устройства для push')).toBeVisible()
})

test('profile page shows Settings and Notifications cards', async ({ page }) => {
  const email = `profile-${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password: 'pass1234', firstName: 'Card', lastName: 'User' })

  await page.goto('/profile')
  await expect(page.getByText('Настройки').first()).toBeVisible()
  await expect(page.getByText('Уведомления').first()).toBeVisible()
})
