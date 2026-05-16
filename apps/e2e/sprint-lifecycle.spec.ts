import { expect, test, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

async function setupKanbanPage(page: Page) {
  const email = `sprint+${Date.now()}+${Math.random().toString(36).slice(2, 8)}@example.com`

  await signUpAndAuthAs(page, { email, password, firstName: 'Спринт', lastName: 'Тестер' })

  await page.getByRole('textbox', { name: 'Название' }).fill('Sprint WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+/)

  const pagesHeaderRow = page
    .getByText('Страницы', { exact: true })
    .locator('xpath=ancestor::*[.//button][1]')
  await pagesHeaderRow.getByRole('button').click()
  await page.getByRole('menuitem', { name: 'Канбан' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/, { timeout: 15_000 })

  // Switch to table view where sprints live
  await expect(page.getByRole('button', { name: 'Таблица' })).toBeVisible()
  await page.getByRole('button', { name: 'Таблица' }).click()
  await expect(page.getByText('Беклог', { exact: true })).toBeVisible()
}

function sprintSection(page: Page, name: string) {
  return page.getByText(name, { exact: true }).locator('xpath=ancestor::*[contains(@class,"MuiPaper-root")][1]')
}

async function createSprint(page: Page, name: string) {
  await page.getByRole('button', { name: 'Новый спринт' }).click()
  await page.getByRole('dialog').getByLabel('Название').fill(name)
  await page.getByRole('button', { name: 'Создать' }).click()
  await expect(sprintSection(page, name)).toBeVisible()
}

async function openSprintMenu(page: Page, sprintName: string) {
  await sprintSection(page, sprintName)
    .getByRole('button', { name: 'Действия со спринтом' })
    .click()
}

test('sprint lifecycle: start, edit, complete, delete with status transitions', async ({ page }) => {
  await setupKanbanPage(page)

  // Create two sprints
  await createSprint(page, 'Sprint A')
  await createSprint(page, 'Sprint B')

  // Both start as PLANNED → badge "Планирование", menu shows "Стартовать"
  await expect(sprintSection(page, 'Sprint A').getByText('Планирование')).toBeVisible()
  await expect(sprintSection(page, 'Sprint B').getByText('Планирование')).toBeVisible()

  // Start Sprint A
  await openSprintMenu(page, 'Sprint A')
  await page.getByRole('menuitem', { name: 'Стартовать спринт' }).click()
  await expect(sprintSection(page, 'Sprint A').getByText('Активный')).toBeVisible()
  await expect(sprintSection(page, 'Sprint B').getByText('Планирование')).toBeVisible()

  // Menu on ACTIVE sprint hides "Стартовать" and shows "Завершить"
  await openSprintMenu(page, 'Sprint A')
  await expect(page.getByRole('menuitem', { name: 'Стартовать спринт' })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'Завершить спринт' })).toBeVisible()
  await page.keyboard.press('Escape')

  // Edit Sprint A's name
  await openSprintMenu(page, 'Sprint A')
  await page.getByRole('menuitem', { name: 'Изменить спринт' }).click()
  const editDialog = page.getByRole('dialog')
  await editDialog.getByLabel('Название').fill('Sprint A renamed')
  await editDialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(sprintSection(page, 'Sprint A renamed')).toBeVisible()

  // Complete Sprint A renamed (no tasks, but the dialog still works)
  await openSprintMenu(page, 'Sprint A renamed')
  await page.getByRole('menuitem', { name: 'Завершить спринт' }).click()
  const completeDialog = page.getByRole('dialog')
  await expect(completeDialog.getByText('Выполнено', { exact: true })).toBeVisible()
  await expect(completeDialog.getByText('Не выполнено', { exact: true })).toBeVisible()
  await completeDialog.getByRole('button', { name: 'Завершить' }).click()
  await expect(sprintSection(page, 'Sprint A renamed').getByText('Завершён')).toBeVisible()

  // Delete Sprint B
  await openSprintMenu(page, 'Sprint B')
  await page.getByRole('menuitem', { name: 'Удалить спринт' }).click()
  const deleteDialog = page.getByRole('dialog')
  await expect(deleteDialog.getByText(/нет задач|вернётся в беклог|вернутся в беклог/)).toBeVisible()
  await deleteDialog.getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByText('Sprint B', { exact: true })).toHaveCount(0)
})
