import { test, expect } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

async function signInToWorkspace(page: import('@playwright/test').Page, slug: string) {
  const email = `${slug}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Юзер' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Пространство')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+$/)
  return email
}

async function seedNotificationsForEmail(email: string, count: number) {
  const { prisma } = await import('../../packages/db/src/index')
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })
  for (let index = 0; index < count; index += 1) {
    const event = await prisma.notificationEvent.create({
      data: {
        type: 'NEW_LOGIN',
        category: 'SECURITY',
        userId: user.id,
        payload: { ipAddress: `127.0.0.${index + 1}`, userAgent: 'playwright' },
        createdAt: new Date(Date.now() - index * 1000),
      },
    })
    await prisma.notificationInApp.create({
      data: {
        eventId: event.id,
        userId: user.id,
        createdAt: event.createdAt,
      },
    })
  }
}

test('sidebar defaults to full and persists across reload', async ({ page }) => {
  await signInToWorkspace(page, 'full-default')

  await expect(page.getByRole('button', { name: 'Скрыть' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Открыть сайдбар' })).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('button', { name: 'Скрыть' })).toBeVisible()
})

test('full sidebar collapses to hidden, burger in toolbar reopens it', async ({ page }) => {
  await signInToWorkspace(page, 'hide-burger')

  await page.getByRole('button', { name: 'Скрыть' }).click()
  await expect(page.getByRole('button', { name: 'Скрыть' })).toHaveCount(0)

  const burger = page.getByRole('button', { name: 'Открыть сайдбар' })
  await expect(burger).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: 'Открыть сайдбар' })).toBeVisible()

  await page.getByRole('button', { name: 'Открыть сайдбар' }).click()
  await expect(page.getByRole('button', { name: 'Скрыть' })).toBeVisible()
})

test('trash shortcut in pages header navigates to trash', async ({ page }) => {
  await signInToWorkspace(page, 'trash-shortcut')

  await page.getByRole('link', { name: 'Корзина' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/trash$/)
})

test('notifications bell opens popover from full sidebar', async ({ page }) => {
  await signInToWorkspace(page, 'notif-bell')

  await page.getByRole('button', { name: 'Уведомления' }).click()
  await expect(page.getByText('Здесь будут ваши уведомления')).toBeVisible()
})

test('notifications bell keeps first popover render within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  const email = await signInToWorkspace(page, 'notif-bell-position')
  await seedNotificationsForEmail(email, 20)

  await page.getByRole('button', { name: 'Уведомления' }).click()
  await expect(page.getByText('Новый вход в аккаунт').first()).toBeVisible()

  const paper = page.locator('.MuiPopover-paper')
  const box = await paper.boundingBox()
  const viewport = page.viewportSize()
  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual((viewport?.height ?? 0) - 1)
})

test('user menu no longer contains a notifications item', async ({ page }) => {
  await signInToWorkspace(page, 'no-notif-in-menu')

  await page.getByText('Тест Юзер', { exact: true }).click()

  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Профиль' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Настройки' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Уведомления' })).toHaveCount(0)
})
