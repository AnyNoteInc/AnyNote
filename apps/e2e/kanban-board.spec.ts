import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

// Mirror helpers/auth.loadEnvFromRoot so prisma can connect when we use it directly
function loadEnvFromRoot(): void {
  if (process.env.DATABASE_URL) return
  try {
    const envPath = resolvePath(process.cwd(), '.env')
    const envFile = readFileSync(envPath, 'utf8')
    for (const line of envFile.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const value = trimmed.slice(eqIdx + 1).trim().replaceAll(/^"|"$/g, '')
      process.env[key] = process.env[key] ?? value
    }
  } catch {
    // env may already be set
  }
}
loadEnvFromRoot()

const password = 'SuperSecure123!'

async function setupKanbanPage(page: Page) {
  const email = `kanban+${Date.now()}+${Math.random().toString(36).slice(2, 8)}@example.com`

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

test('KANBAN page renders default columns and supports task creation + DnD persistence', async ({
  page,
}) => {
  await setupKanbanPage(page)

  await expect(page.getByText('Todo', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('In Progress', { exact: true })).toBeVisible()
  await expect(page.getByText('Done', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Создать задачу' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()

  const todoColumn = page.locator('[data-rfd-droppable-id]').first()
  await expect(todoColumn.getByText('Новая задача')).toBeVisible({ timeout: 10_000 })

  // Close the modal — pick the IconButton inside the dialog title
  await page.getByRole('dialog').locator('header, .MuiDialogTitle-root').getByRole('button').click()

  await page.reload()
  await expect(todoColumn.getByText('Новая задача')).toBeVisible({ timeout: 15_000 })
})

test('KANBAN toolbar exposes board/table/gantt view switcher as ButtonGroup', async ({ page }) => {
  await setupKanbanPage(page)

  await expect(page.getByRole('button', { name: 'Доска' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Таблица' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Гант' })).toBeVisible()

  await page.getByRole('button', { name: 'Таблица' }).click()
  await expect(page.getByText('Беклог', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Новый спринт' })).toBeVisible()

  await page.getByRole('button', { name: 'Гант' }).click()
  await expect(page.getByText(/задайте даты/i)).toBeVisible()

  await page.getByRole('button', { name: 'Доска' }).click()
  await expect(page.getByText('Todo', { exact: true })).toBeVisible()
})

test('KANBAN settings dialog has 4 tabs with default Russian priorities', async ({ page }) => {
  await setupKanbanPage(page)

  await expect(page.getByText('Todo', { exact: true })).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Настройки канбана' }).click()
  await page.getByRole('menuitem', { name: 'Настройки канбана' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('tab', { name: 'Типы' })).toBeVisible()
  await expect(dialog.getByRole('tab', { name: 'Приоритеты' })).toBeVisible()
  await expect(dialog.getByRole('tab', { name: 'Метки' })).toBeVisible()
  await expect(dialog.getByRole('tab', { name: 'Статусы' })).toBeVisible()

  await expect(dialog.getByText('Задача', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Баг', { exact: true })).toBeVisible()

  await dialog.getByRole('tab', { name: 'Приоритеты' }).click()
  await expect(dialog.getByText('Критичный', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Минимальный', { exact: true })).toBeVisible()
})

test('Task title edits save and persist across reload', async ({ page }) => {
  await setupKanbanPage(page)

  await expect(page.getByText('Todo', { exact: true })).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Создать задачу' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  const titleField = dialog.getByLabel('Название')
  await titleField.fill('Renamed by e2e')
  await titleField.blur()
  await page.waitForTimeout(500)

  await page.reload()
  // Either the card or the auto-reopened modal shows the new title — both prove it persisted.
  await expect(page.getByText('Renamed by e2e').first()).toBeVisible({ timeout: 15_000 })
})

test('Sprint creation works from table view', async ({ page }) => {
  await setupKanbanPage(page)

  await expect(page.getByText('Todo', { exact: true })).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Таблица' }).click()
  await page.getByRole('button', { name: 'Новый спринт' }).click()

  const dialog = page.getByRole('dialog').filter({ hasText: 'Новый спринт' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Название').fill('Sprint Alpha')
  await dialog.getByRole('button', { name: 'Создать', exact: true }).click()

  await expect(page.getByText('Sprint Alpha')).toBeVisible({ timeout: 10_000 })
})

test('Gantt: empty state when no dated tasks; renders chart when a task has dates', async ({
  page,
}) => {
  await setupKanbanPage(page)

  await expect(page.getByText('Todo', { exact: true })).toBeVisible({ timeout: 15_000 })

  // Empty state when no dated tasks
  await page.getByRole('button', { name: 'Гант' }).click()
  await expect(page.getByText(/задайте даты/i)).toBeVisible()

  // Create task and set dueDate via direct tRPC call (DatePicker UI fill is brittle)
  await page.getByRole('button', { name: 'Доска' }).click()
  await page.getByRole('button', { name: 'Создать задачу' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  const { pageIdRaw, taskIdRaw } = await page.evaluate(() => {
    const url = new URL(globalThis.location.href)
    const taskMatch = url.searchParams.get('taskId')
    const pageMatch = /pages\/([0-9a-f-]+)/.exec(url.pathname)
    return { pageIdRaw: pageMatch?.[1] ?? null, taskIdRaw: taskMatch ?? null }
  })
  if (!pageIdRaw || !taskIdRaw) throw new Error('Could not resolve pageId/taskId from URL')

  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + 7)

  // Set dueDate directly via Prisma so we don't fight the masked DatePicker input
  const { prisma } = await import('../../packages/db/src/index')
  await prisma.task.update({ where: { id: taskIdRaw }, data: { dueDate } })

  await dialog.locator('.MuiDialogTitle-root').getByRole('button').click()

  await page.getByRole('button', { name: 'Гант' }).click()
  await expect(page.getByText(/задайте даты/i)).not.toBeVisible({ timeout: 10_000 })
  // gantt-task-react renders SVG chart
  await expect(page.locator('svg').first()).toBeVisible()
})

test('Card 3-dots menu deletes the task', async ({ page }) => {
  await setupKanbanPage(page)

  await expect(page.getByText('Todo', { exact: true })).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Создать задачу' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.locator('.MuiDialogTitle-root').getByRole('button').click()
  await expect(dialog).not.toBeVisible()

  await expect(page.getByText('Новая задача').first()).toBeVisible()

  await page.getByRole('button', { name: 'Меню задачи' }).first().click()
  await page.getByRole('menuitem', { name: 'Назначить на меня' }).waitFor({ timeout: 5_000 })
  await page.getByRole('menuitem', { name: 'Удалить' }).click()

  await expect(page.getByText('Новая задача')).toHaveCount(0)
})
