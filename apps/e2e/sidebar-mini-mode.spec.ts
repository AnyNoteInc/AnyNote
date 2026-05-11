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
  await expect(page.getByRole('button', { name: 'Свернуть' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Развернуть' }).click()
  await expect(page.getByRole('button', { name: 'Свернуть' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: 'Свернуть' })).toBeVisible()

  await page.getByRole('button', { name: 'Свернуть' }).click()
  await expect(page.getByRole('button', { name: 'Развернуть' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: 'Развернуть' })).toBeVisible()
})

test('trash shortcut in pages header navigates to trash', async ({ page }) => {
  await signInToWorkspace(page, 'trash-shortcut')

  await page.getByRole('button', { name: 'Развернуть' }).click()
  await page.getByRole('link', { name: 'Корзина' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/trash$/)
})

test('notifications appear inside the user menu popover', async ({ page }) => {
  await signInToWorkspace(page, 'notif-menu')

  await page.getByRole('button', { name: /Меню пользователя/ }).click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: 'Уведомления' })).toBeVisible()

  await menu.getByRole('menuitem', { name: 'Уведомления' }).click()
  await expect(menu).toBeHidden()
  await expect(page.getByText('Здесь будут ваши уведомления')).toBeVisible()
})
