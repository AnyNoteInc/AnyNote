import { expect, test, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

test.setTimeout(120_000)

async function setupKanbanPage(page: Page) {
  const email = `kanban-filter+${Date.now()}+${Math.random().toString(36).slice(2, 8)}@example.com`

  await signUpAndAuthAs(page, { email, password, firstName: 'Фильтр', lastName: 'Тестер' })

  await page.getByRole('textbox', { name: 'Название' }).fill('Kanban Filter WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+/)

  const pagesHeaderRow = page
    .getByText('Страницы', { exact: true })
    .locator('xpath=ancestor::*[.//button][1]')
  await pagesHeaderRow.getByRole('button').click()
  await page.getByRole('menuitem', { name: 'Канбан' }).click()

  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/, { timeout: 15_000 })
}

test('task filter popovers stay lightweight after repeated openings', async ({ page }) => {
  await setupKanbanPage(page)

  await expect(page.getByText('Todo', { exact: true })).toBeVisible({ timeout: 15_000 })
  const pageId = await page.evaluate(() => {
    const match = /pages\/([0-9a-f-]+)/.exec(globalThis.location.pathname)
    return match?.[1] ?? null
  })
  if (!pageId) throw new Error('Could not resolve pageId from URL')
  const { prisma } = await import('../../packages/db/src/index')
  await prisma.kanbanType.createMany({
    data: Array.from({ length: 250 }, (_, index) => ({
      pageId,
      title: `Perf type ${index + 1}`,
      position: 1_000 + index,
    })),
  })
  await prisma.kanbanPriority.createMany({
    data: Array.from({ length: 250 }, (_, index) => ({
      pageId,
      title: `Perf priority ${index + 1}`,
      position: 1_000 + index,
    })),
  })
  const pageRow = await prisma.page.findUniqueOrThrow({
    where: { id: pageId },
    select: { workspaceId: true },
  })
  const owner = await prisma.workspaceMember.findFirstOrThrow({
    where: { workspaceId: pageRow.workspaceId },
    select: { userId: true },
  })
  const column = await prisma.kanbanColumn.findFirstOrThrow({
    where: { pageId },
    orderBy: { position: 'asc' },
    select: { id: true },
  })
  await prisma.task.createMany({
    data: Array.from({ length: 600 }, (_, index) => ({
      pageId,
      columnId: column.id,
      title: index === 0 ? 'Проверка фильтров' : `Perf task ${index + 1}`,
      position: 1_000 + index,
      createdById: owner.userId,
    })),
  })
  await page.reload()
  await expect(page.getByText('Todo', { exact: true })).toBeVisible({ timeout: 15_000 })

  await page.getByText('Проверка фильтров', { exact: true }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  expect(await page.evaluate(() => document.querySelectorAll('*').length)).toBeLessThan(2500)

  for (const label of ['Тип', 'Срочность', 'Тип', 'Срочность', 'Тип', 'Срочность']) {
    await dialog.getByRole('button', { name: label }).click()
    const popover = page.locator('.MuiPopover-paper').filter({ hasText: label })
    await expect(popover).toBeVisible()
    await page.waitForTimeout(100)
    await expect(popover.locator('[data-rfd-draggable-id]')).toHaveCount(0)
    expect(await popover.getByRole('radio').count()).toBeLessThan(80)
    await popover.getByRole('radio').first().click()
    await page.keyboard.press('Escape')
    await expect(page.locator('.MuiPopover-paper')).toHaveCount(0)
  }
})
