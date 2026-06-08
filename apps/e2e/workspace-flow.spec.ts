import { test, expect } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

test('workspace + settings happy path', async ({ page }) => {
  const email = `review+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Ревьюер' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Рабочее пространство')
  await page.getByRole('button', { name: 'Создать пространство' }).click()

  // Creation redirects through /app to a neutral URL (first page or /chats/new).
  await page.waitForURL(/\/(pages|chats)\//)
  await expect(page.getByRole('heading', { name: 'Добро пожаловать в AnyNote' })).toBeVisible()

  await page.getByText('Тест Ревьюер', { exact: true }).click()
  const userMenu = page.getByRole('menu')
  await expect(userMenu.getByText('Тема', { exact: true })).toBeVisible()
  await expect(userMenu.getByRole('group', { name: 'Тема' })).toBeVisible()
  await expect(userMenu.getByRole('button', { name: 'Системная тема' })).toBeVisible()
  await expect(userMenu.getByRole('button', { name: 'Светлая тема' })).toBeVisible()
  await expect(userMenu.getByRole('button', { name: 'Тёмная тема' })).toBeVisible()
  const upgradeAction = userMenu.getByRole('menuitem', { name: 'Обновить план' })
  const logoutAction = userMenu.getByRole('menuitem', { name: 'Выйти' })
  await expect(upgradeAction).toBeVisible()
  await expect(logoutAction).toBeVisible()
  await expect(userMenu.locator('.MuiDivider-vertical')).toHaveCount(0)
  const [upgradeBox, logoutBox] = await Promise.all([
    upgradeAction.boundingBox(),
    logoutAction.boundingBox(),
  ])
  expect(upgradeBox?.y).toBeLessThan(logoutBox?.y ?? 0)
  await page.keyboard.press('Escape')

  await page.getByRole('link', { name: 'Настройки' }).click()
  // Settings live at a neutral route now (no /workspaces/{id} prefix);
  // /settings redirects to /settings/general.
  await page.waitForURL(/\/settings\/general$/)
  await expect(page.getByRole('heading', { name: 'Общее' })).toBeVisible()
})

test('free plan blocks second workspace create', async ({ page }) => {
  const email = `review2+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Ревьюер' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Первое')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  // Creation redirects through /app to a neutral URL (first page or /chats/new).
  await page.waitForURL(/\/(pages|chats)\//)

  // The workspace-creation route still exists at /workspaces/new.
  await page.goto('/workspaces/new')
  await page.getByRole('textbox', { name: 'Название' }).fill('Второе')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await expect(page.getByText(/можно создать не больше/)).toBeVisible()
})
