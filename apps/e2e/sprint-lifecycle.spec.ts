import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

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
      const value = trimmed
        .slice(eqIdx + 1)
        .trim()
        .replaceAll(/^"|"$/g, '')
      process.env[key] = process.env[key] ?? value
    }
  } catch {
    // env may already be set
  }
}
loadEnvFromRoot()

const password = 'SuperSecure123!'

test.setTimeout(120_000)

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
  return page
    .getByText(name, { exact: true })
    .locator('xpath=ancestor::*[contains(@class,"MuiPaper-root")][1]')
}

function backlogSection(page: Page) {
  return page
    .getByText('Беклог', { exact: true })
    .locator('xpath=ancestor::*[contains(@class,"MuiPaper-root")][1]')
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

test('sprint lifecycle: start, edit, complete, delete with status transitions', async ({
  page,
}) => {
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

  await page.getByText(/^Спринты:/).click()
  await expect(page.getByRole('menuitem', { name: 'Активный' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Планирование' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Завершён' })).toBeVisible()
  await page.keyboard.press('Escape')

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
  await expect(page.getByText('Sprint A renamed', { exact: true })).toHaveCount(0)

  await page.getByText(/^Спринты:/).click()
  await page.getByRole('menuitem', { name: 'Завершён' }).click()
  await page.keyboard.press('Escape')
  await expect(sprintSection(page, 'Sprint A renamed').getByText('Завершён')).toBeVisible()

  // Delete Sprint B
  await openSprintMenu(page, 'Sprint B')
  await page.getByRole('menuitem', { name: 'Удалить спринт' }).click()
  const deleteDialog = page.getByRole('dialog')
  await expect(
    deleteDialog.getByText(/нет задач|вернётся в беклог|вернутся в беклог/),
  ).toBeVisible()
  await deleteDialog.getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByText('Sprint B', { exact: true })).toHaveCount(0)
})

test('table creates sprint and backlog tasks from their menus', async ({ page }) => {
  await setupKanbanPage(page)

  await createSprint(page, 'Sprint Create')
  await openSprintMenu(page, 'Sprint Create')
  await page.getByRole('menuitem', { name: 'Стартовать спринт' }).click()
  await expect(sprintSection(page, 'Sprint Create').getByText('Активный')).toBeVisible()

  await openSprintMenu(page, 'Sprint Create')
  await page.getByRole('menuitem', { name: 'Создать задачу' }).click()

  const fromSprintInput = page.getByRole('textbox', { name: 'Название задачи' })
  await expect(fromSprintInput).toBeFocused()
  await fromSprintInput.fill('Created from sprint menu')
  await fromSprintInput.press('Enter')

  await expect(
    sprintSection(page, 'Sprint Create').getByText('Created from sprint menu', { exact: true }),
  ).toBeVisible()
  await expect(
    backlogSection(page).getByText('Created from sprint menu', { exact: true }),
  ).toHaveCount(0)

  await backlogSection(page).getByRole('button', { name: 'Действия с беклогом' }).click()
  await page.getByRole('menuitem', { name: 'Создать задачу' }).click()

  const fromBacklogInput = page.getByRole('textbox', { name: 'Название задачи' })
  await expect(fromBacklogInput).toBeFocused()
  await fromBacklogInput.fill('Created from backlog menu')
  await fromBacklogInput.press('Enter')

  await expect(backlogSection(page).getByText('Created from backlog menu', { exact: true })).toBeVisible()
})

test('table sprint status filter shows completed sprint terminal tasks as struck through', async ({
  page,
}) => {
  await setupKanbanPage(page)

  const pageId = await page.evaluate(() => {
    const match = /pages\/([0-9a-f-]+)/.exec(globalThis.location.pathname)
    return match?.[1] ?? null
  })
  if (!pageId) throw new Error('Could not resolve pageId from URL')

  const { prisma } = await import('../../packages/db/src/index')
  const pageRow = await prisma.page.findUniqueOrThrow({
    where: { id: pageId },
    select: { workspaceId: true },
  })
  const owner = await prisma.workspaceMember.findFirstOrThrow({
    where: { workspaceId: pageRow.workspaceId },
    select: { userId: true },
  })
  const todoColumn = await prisma.kanbanColumn.findFirstOrThrow({
    where: { pageId, kind: 'ACTIVE' },
    orderBy: { position: 'asc' },
    select: { id: true },
  })
  const doneColumn = await prisma.kanbanColumn.findFirstOrThrow({
    where: { pageId, kind: 'DONE' },
    select: { id: true },
  })
  const cancelledColumn = await prisma.kanbanColumn.create({
    data: { pageId, title: 'Cancelled', kind: 'CANCELLED', position: 4096 },
    select: { id: true },
  })
  const [activeSprint, plannedSprint, completedSprint] = await Promise.all([
    prisma.sprint.create({
      data: { pageId, name: 'Active Sprint', status: 'ACTIVE', position: 1 },
      select: { id: true },
    }),
    prisma.sprint.create({
      data: { pageId, name: 'Planned Sprint', status: 'PLANNED', position: 2 },
      select: { id: true },
    }),
    prisma.sprint.create({
      data: { pageId, name: 'Completed Sprint', status: 'COMPLETED', position: 3 },
      select: { id: true },
    }),
  ])
  await prisma.task.createMany({
    data: [
      {
        pageId,
        columnId: doneColumn.id,
        sprintId: activeSprint.id,
        title: 'Done in active',
        position: 1,
        sprintPosition: 1,
        createdById: owner.userId,
      },
      {
        pageId,
        columnId: todoColumn.id,
        sprintId: plannedSprint.id,
        title: 'Open in planned',
        position: 2,
        sprintPosition: 1,
        createdById: owner.userId,
      },
      {
        pageId,
        columnId: doneColumn.id,
        sprintId: completedSprint.id,
        title: 'Done in completed',
        position: 3,
        sprintPosition: 1,
        createdById: owner.userId,
      },
      {
        pageId,
        columnId: cancelledColumn.id,
        sprintId: completedSprint.id,
        title: 'Cancelled in completed',
        position: 4,
        sprintPosition: 2,
        createdById: owner.userId,
      },
    ],
  })

  await page.reload()
  await expect(sprintSection(page, 'Active Sprint')).toBeVisible({ timeout: 15_000 })
  await expect(sprintSection(page, 'Planned Sprint')).toBeVisible()
  await expect(page.getByText('Completed Sprint', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Done in active', { exact: true })).toHaveCount(0)

  await page.getByText(/^Спринты:/).click()
  await page.getByRole('menuitem', { name: 'Завершён' }).click()
  await page.keyboard.press('Escape')

  const completedSection = sprintSection(page, 'Completed Sprint')
  await expect(completedSection).toBeVisible()

  for (const title of ['Done in completed', 'Cancelled in completed']) {
    const titleNode = completedSection.getByText(title, { exact: true })
    await expect(titleNode).toBeVisible()
    await expect(titleNode).toHaveCSS('text-decoration-line', 'line-through')
  }
})
