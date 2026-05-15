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
