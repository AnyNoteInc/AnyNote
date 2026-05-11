import { test, expect } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

async function signInToWorkspace(page: import('@playwright/test').Page, slug: string) {
  const email = `${slug}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Юзер' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Пространство')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+$/)
}

test('sidebar defaults to mini and persists across reload', async ({ page }) => {
  await signInToWorkspace(page, 'mini-default')

  await expect(page.getByRole('button', { name: 'Развернуть' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Скрыть' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Развернуть' }).click()
  await expect(page.getByRole('button', { name: 'Скрыть' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: 'Скрыть' })).toBeVisible()
})

test('full sidebar collapses to hidden, burger in toolbar reopens it', async ({ page }) => {
  await signInToWorkspace(page, 'hide-burger')

  await page.getByRole('button', { name: 'Развернуть' }).click()
  await expect(page.getByRole('button', { name: 'Скрыть' })).toBeVisible()

  await page.getByRole('button', { name: 'Скрыть' }).click()
  await expect(page.getByRole('button', { name: 'Скрыть' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Развернуть' })).toHaveCount(0)

  const burger = page.getByRole('button', { name: 'Открыть сайдбар' })
  await expect(burger).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: 'Открыть сайдбар' })).toBeVisible()

  await page.getByRole('button', { name: 'Открыть сайдбар' }).click()
  await expect(page.getByRole('button', { name: 'Скрыть' })).toBeVisible()
})

test('trash shortcut in pages header navigates to trash', async ({ page }) => {
  await signInToWorkspace(page, 'trash-shortcut')

  await page.getByRole('button', { name: 'Развернуть' }).click()
  await page.getByRole('link', { name: 'Корзина' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/trash$/)
})

test('notifications bell opens popover in mini mode', async ({ page }) => {
  await signInToWorkspace(page, 'notif-bell-mini')

  await page.getByRole('button', { name: 'Уведомления' }).click()
  await expect(page.getByText('Здесь будут ваши уведомления')).toBeVisible()
})

test('notifications bell opens popover in full mode', async ({ page }) => {
  await signInToWorkspace(page, 'notif-bell-full')

  await page.getByRole('button', { name: 'Развернуть' }).click()
  await page.getByRole('button', { name: 'Уведомления' }).click()
  await expect(page.getByText('Здесь будут ваши уведомления')).toBeVisible()
})

test('user menu no longer contains a notifications item', async ({ page }) => {
  await signInToWorkspace(page, 'no-notif-in-menu')

  await page.getByRole('button', { name: 'Развернуть' }).click()
  await page.getByText('Тест Юзер', { exact: true }).click()

  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Профиль' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Настройки' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Уведомления' })).toHaveCount(0)
})
