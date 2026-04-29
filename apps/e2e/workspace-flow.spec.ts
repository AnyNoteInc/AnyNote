import { test, expect } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

test('workspace + settings happy path', async ({ page }) => {
  const email = `review+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Ревьюер' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Рабочее пространство')
  await page.getByRole('button', { name: 'Создать пространство' }).click()

  await page.waitForURL(/\/workspaces\/[a-f0-9-]+$/)
  await expect(page.getByRole('heading', { name: 'Welcome to AnyNote' })).toBeVisible()

  await page.getByRole('link', { name: 'Настройки' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/settings\/general$/)
  await expect(page.getByRole('heading', { name: 'Общее' })).toBeVisible()
})

test('free plan blocks second workspace create', async ({ page }) => {
  const email = `review2+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Ревьюер' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Первое')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+$/)

  await page.goto('/workspaces/new')
  await page.getByRole('textbox', { name: 'Название' }).fill('Второе')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await expect(page.getByText(/можно создать не больше/)).toBeVisible()
})
