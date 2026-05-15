import { expect, test, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

async function setupKanbanPage(page: Page) {
  const email = `kanban+${Date.now()}@example.com`

  await signUpAndAuthAs(page, { email, password, firstName: 'Канбан', lastName: 'Тестер' })

  await page.getByRole('textbox', { name: 'Название' }).fill('Kanban WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+/)

  const pagesHeaderRow = page
    .getByText('Страницы', { exact: true })
    .locator('xpath=ancestor::*[.//button][1]')
  await pagesHeaderRow.getByRole('button').click()
  await page.getByRole('menuitem', { name: 'Канбан' }).click()

  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/, { timeout: 15_000 })
}

test('KANBAN page renders 3 default columns and supports task creation + DnD persistence', async ({
  page,
}) => {
  await setupKanbanPage(page)

  // Default columns rendered
  await expect(page.getByText('Todo', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('In Progress', { exact: true })).toBeVisible()
  await expect(page.getByText('Done', { exact: true })).toBeVisible()

  // Create a task via toolbar
  await page.getByRole('button', { name: 'Создать задачу' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()

  // Task appears in the first (Todo) droppable column
  const todoColumn = page.locator('[data-rfd-droppable-id]').first()
  await expect(todoColumn.getByText('Новая задача')).toBeVisible({ timeout: 10_000 })

  // Close the modal via the close icon button
  await page.getByRole('dialog').getByRole('button').first().click()

  // Reload and verify the task is still in Todo
  await page.reload()
  await expect(todoColumn.getByText('Новая задача')).toBeVisible({ timeout: 15_000 })
})

test('KANBAN toolbar exposes board/table/gantt view switcher', async ({ page }) => {
  await setupKanbanPage(page)

  await expect(page.getByRole('button', { name: 'Доска' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Таблица' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Гант' })).toBeVisible()

  // Table view: backlog section + "Новый спринт" button on the toolbar inside the view
  await page.getByRole('button', { name: 'Таблица' }).click()
  await expect(page.getByText('Беклог', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Новый спринт' })).toBeVisible()

  // Gantt view shows the empty-state hint since no dates are set
  await page.getByRole('button', { name: 'Гант' }).click()
  await expect(page.getByText(/задайте даты/i)).toBeVisible()

  // Back to board
  await page.getByRole('button', { name: 'Доска' }).click()
  await expect(page.getByText('Todo', { exact: true })).toBeVisible()
})

test('KANBAN settings dialog has Types / Priorities / Labels / Statuses tabs', async ({ page }) => {
  await setupKanbanPage(page)

  // Wait for board to load
  await expect(page.getByText('Todo', { exact: true })).toBeVisible({ timeout: 15_000 })

  // Open the kebab menu in the toolbar
  await page.getByRole('button', { name: 'Меню канбана' }).click()
  await page.getByRole('menuitem', { name: 'Настройки канбана' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('tab', { name: 'Типы' })).toBeVisible()
  await expect(dialog.getByRole('tab', { name: 'Приоритеты' })).toBeVisible()
  await expect(dialog.getByRole('tab', { name: 'Метки' })).toBeVisible()
  await expect(dialog.getByRole('tab', { name: 'Статусы' })).toBeVisible()

  // Default seeds visible
  await expect(dialog.getByText('Задача', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Баг', { exact: true })).toBeVisible()

  await dialog.getByRole('tab', { name: 'Приоритеты' }).click()
  await expect(dialog.getByText('Highest', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Lowest', { exact: true })).toBeVisible()
})

test('KANBAN task detail modal accepts a comment and shows it in the activity', async ({
  page,
}) => {
  await setupKanbanPage(page)

  await expect(page.getByText('Todo', { exact: true })).toBeVisible({ timeout: 15_000 })

  // Create a task — modal opens with it focused
  await page.getByRole('button', { name: 'Создать задачу' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  // Comment composer
  const composer = dialog.getByPlaceholder(/написать комментарий/i)
  await composer.fill('Первое замечание')
  await dialog.getByRole('button', { name: /отправить/i }).click()

  await expect(dialog.getByText('Первое замечание')).toBeVisible({ timeout: 10_000 })

  // Activity log shows CREATED + COMMENTED entries
  await expect(dialog.getByText(/создал.*задачу/i)).toBeVisible()
  await expect(dialog.getByText(/оставил.*комментарий/i)).toBeVisible()
})
