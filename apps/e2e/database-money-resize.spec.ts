import { expect, test } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'
import { createWorkspaceAndDatabasePage } from './helpers/database'

const password = 'SuperSecure123!'

/*
 * MONEY property + table column resize end-to-end.
 *
 * Follows the database-mvp no-yjs constraint: every assertion targets
 * tRPC/Postgres-backed state (cells, view settings), never the item body.
 * Locators are lazy selectors, so the same locator is reused across reloads.
 */

test('database: MONEY property stores kopecks + column resize persists and resets', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const email = `db-money+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Деньги' })
  await createWorkspaceAndDatabasePage(page, 'Money WS')

  // --- MONEY property: create, fill in rubles, display as ₽, survive reload. ---
  await page.getByRole('button', { name: 'Строка', exact: true }).click()
  const rowTitleInput = page.locator('input[placeholder="Без названия"]')
  await expect(rowTitleInput.first()).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Свойство', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Деньги', exact: true }).click()
  await expect(page.getByRole('columnheader', { name: /Сумма/ })).toBeVisible({ timeout: 15_000 })

  // Column order: [0] Название, [1] Статус, [2] Сумма (new property appends).
  const moneyInput = page
    .locator('tbody tr')
    .filter({ has: rowTitleInput })
    .first()
    .locator('td')
    .nth(2)
    .locator('input')
  await moneyInput.click()
  await moneyInput.fill('123,45')
  await moneyInput.press('Enter')
  // At rest the cell shows the ru-RU currency format (NBSP before ₽).
  await expect(moneyInput).toHaveValue(/123,45\s?₽/, { timeout: 10_000 })

  await page.reload()
  await expect(moneyInput).toHaveValue(/123,45\s?₽/, { timeout: 20_000 })

  // --- Column resize: drag fixes the width, reload keeps it, dblclick resets. ---
  const statusHeader = page.getByRole('columnheader', { name: /Статус/ })
  const handle = page.getByRole('separator', { name: 'Изменить ширину столбца «Статус»' })
  const statusWidth = async () => (await statusHeader.boundingBox())!.width
  await expect(handle).toBeVisible()

  const startWidth = await statusWidth()
  const handleBox = (await handle.boundingBox())!
  const grabX = handleBox.x + handleBox.width / 2
  const grabY = handleBox.y + handleBox.height / 2
  await page.mouse.move(grabX, grabY)
  await page.mouse.down()
  await page.mouse.move(grabX + 120, grabY, { steps: 8 })
  await page.mouse.up()

  const target = startWidth + 120
  await expect.poll(statusWidth, { timeout: 10_000 }).toBeGreaterThan(target - 15)
  expect(await statusWidth()).toBeLessThan(target + 15)

  // The width persists in view settings (updateView) — survive a reload.
  await page.reload()
  await expect.poll(statusWidth, { timeout: 20_000 }).toBeGreaterThan(target - 15)

  // Double-click on the handle → back to automatic sizing (≈ the initial width).
  await handle.dblclick()
  await expect.poll(statusWidth, { timeout: 10_000 }).toBeLessThan(target - 40)

  // The reset persists too.
  await page.reload()
  await expect.poll(statusWidth, { timeout: 20_000 }).toBeLessThan(target - 40)
})
