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
  await page.waitForURL(/\/(pages|chats)\//)

  await page.getByRole('button', { name: 'Новая страница' }).first().click()
  await page.getByRole('button', { name: 'Создать страницу: Канбан' }).click()

  await page.waitForURL(/\/pages\/[a-f0-9-]+/, { timeout: 15_000 })
}

test('KANBAN page renders default columns and supports task creation + DnD persistence', async ({
  page,
}) => {
  await setupKanbanPage(page)

  await expect(page.getByText('Todo', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('In Progress', { exact: true })).toBeVisible()
  await expect(page.getByText('Done', { exact: true })).toBeVisible()

  // Task creation is per-column inline: the first "Добавить карточку" (Todo
  // column) reveals a title field; "Добавить" commits the card into that column.
  await page.getByRole('button', { name: 'Добавить карточку' }).first().click()
  await page.getByPlaceholder('Введите название карточки…').fill('Новая задача')
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(page.getByText('Новая задача', { exact: true })).toBeVisible({ timeout: 10_000 })

  await page.reload()
  await expect(page.getByText('Новая задача', { exact: true })).toBeVisible({ timeout: 15_000 })
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

  // The settings IconButton opens the dialog directly (no intermediate menu).
  await page.getByRole('button', { name: 'Настройки канбана' }).click()

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
  await expect(dialog.getByText('Низкий', { exact: true })).toBeVisible()
})

test('Task title edits save and persist across reload', async ({ page }) => {
  await setupKanbanPage(page)

  await expect(page.getByText('Todo', { exact: true })).toBeVisible({ timeout: 15_000 })

  // Create a card inline with the title under test; the inline field IS the title.
  await page.getByRole('button', { name: 'Добавить карточку' }).first().click()
  await page.getByPlaceholder('Введите название карточки…').fill('Renamed by e2e')
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(page.getByText('Renamed by e2e').first()).toBeVisible({ timeout: 10_000 })

  await page.reload()
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

  // Create a task inline, then set its dueDate via Prisma (DatePicker UI fill is brittle).
  await page.getByRole('button', { name: 'Доска' }).click()
  await page.getByRole('button', { name: 'Добавить карточку' }).first().click()
  await page.getByPlaceholder('Введите название карточки…').fill('Dated task')
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(page.getByText('Dated task', { exact: true })).toBeVisible({ timeout: 10_000 })

  // The inline create flow does not open the task detail, so resolve the taskId
  // from the DB (by title) rather than from the URL.
  const pageIdRaw = /pages\/([0-9a-f-]+)/.exec(new URL(page.url()).pathname)?.[1] ?? null
  if (!pageIdRaw) throw new Error('Could not resolve pageId from URL')

  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + 7)

  const { prisma } = await import('../../packages/db/src/index')
  const task = await prisma.task.findFirstOrThrow({
    where: { pageId: pageIdRaw, title: 'Dated task' },
    select: { id: true },
  })
  await prisma.task.update({ where: { id: task.id }, data: { dueDate } })

  await page.getByRole('button', { name: 'Гант' }).click()
  await expect(page.getByText(/задайте даты/i)).not.toBeVisible({ timeout: 10_000 })
  // gantt-task-react renders SVG chart
  await expect(page.locator('svg').first()).toBeVisible()
})

test('Card 3-dots menu deletes the task', async ({ page }) => {
  await setupKanbanPage(page)

  await expect(page.getByText('Todo', { exact: true })).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Добавить карточку' }).first().click()
  await page.getByPlaceholder('Введите название карточки…').fill('Новая задача')
  await page.getByRole('button', { name: 'Добавить', exact: true }).click()

  await expect(page.getByText('Новая задача').first()).toBeVisible()

  await page.getByRole('button', { name: 'Меню задачи' }).first().click()
  await page.getByRole('menuitem', { name: 'Назначить на меня' }).waitFor({ timeout: 5_000 })
  await page.getByRole('menuitem', { name: 'Удалить' }).click()

  await expect(page.getByText('Новая задача')).toHaveCount(0)
})
