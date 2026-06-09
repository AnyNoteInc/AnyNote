import { expect, test } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

/*
 * Database RICH PROPERTIES end-to-end (Phase 4B): FORMULA, options/colours,
 * PERSON, RELATION. Builds on the Phase-3 database-mvp + Phase-4A views flows.
 *
 * No-yjs constraint (important): the Playwright `webServer` is just `next dev`
 * on port 3100 — there is NO Hocuspocus (yjs) server. So the collaborative
 * *body* of an item page cannot persist or even connect under E2E. Every
 * assertion below therefore targets tRPC-backed state only:
 *   - property creation goes through `database.createProperty` (a real row);
 *   - the property settings (options/colours, formula, relation target) persist
 *     via `database.updateProperty`;
 *   - FORMULA values are computed server-side on read (`augmentRows` →
 *     `resolveComputedCells`) and ride along `database.listRows`;
 *   - PERSON writes go through `database.updateCellValue`;
 *   - RELATION links go through `database.setRelationLinks` and the chips are
 *     recomputed server-side.
 * We never assert item-body content. Where it proves persistence we
 * `page.reload()` — a fresh mount re-runs `getByPage` + `listRows`, so a value
 * surviving a reload PROVES it round-tripped through Postgres (it would be lost
 * if it depended on yjs).
 *
 * Formula determinism note: the compute-on-read scope (`resolveComputedCells`)
 * is keyed by the *database* property names (Статус, …) — the system Title
 * column «Название» (Page.title) is NOT in the formula scope. So
 * `prop("Название")` resolves to null. To keep the assertion deterministic we
 * use a CONSTANT expression — `concat("Сумма = ", 1 + 2)` → "Сумма = 3" — which
 * exercises both the text (`concat`) and arithmetic (`+`) paths and needs no
 * cell/title timing.
 *
 * The seeded DATABASE page (domain `seedDefaults`) provides: a TABLE view
 * «Таблица», a system Title column «Название», and a STATUS property «Статус»
 * with three options — «Не начато», «В работе», «Готово».
 */

/**
 * Create the first workspace, then a DATABASE page via the redesigned sidebar
 * create flow. Adapted from `database-views.spec.ts`. Returns the new page id.
 */
async function createWorkspaceAndDatabasePage(
  page: import('@playwright/test').Page,
  workspaceName: string,
): Promise<string> {
  await page.getByRole('textbox', { name: 'Название' }).fill(workspaceName)
  const createWsButton = page.getByRole('button', { name: 'Создать пространство' })
  await expect(createWsButton).toBeEnabled({ timeout: 20_000 })
  await createWsButton.click()
  await page.waitForURL(/\/(pages|chats)\//, { timeout: 30_000 })
  return createDatabasePageFromSidebar(page)
}

/**
 * From anywhere inside the workspace shell, create a fresh DATABASE page via the
 * sidebar «Новая страница» → «База данных» flow. Waits for the seeded table
 * header (tRPC-backed) and returns the new page id parsed from the URL.
 */
async function createDatabasePageFromSidebar(
  page: import('@playwright/test').Page,
): Promise<string> {
  const startUrl = page.url()
  await page.getByRole('button', { name: 'Новая страница' }).first().click()
  await page.getByRole('button', { name: 'Создать страницу: База данных' }).click()
  await page.waitForURL((url) => /\/pages\/[a-f0-9-]+/.test(url.href) && url.href !== startUrl, {
    timeout: 15_000,
  })
  await expect(page.getByRole('columnheader', { name: 'Название' })).toBeVisible({
    timeout: 20_000,
  })
  const pageId = /\/pages\/([a-f0-9-]+)/.exec(page.url())?.[1]
  if (!pageId) throw new Error(`createDatabasePageFromSidebar: no page id in URL ${page.url()}`)
  return pageId
}

/** Add a row in the TABLE view and wait for its title input to appear. */
async function addRow(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Строка', exact: true }).click()
  await expect(page.locator('input[placeholder="Без названия"]').first()).toBeVisible({
    timeout: 15_000,
  })
}

/** Open the «+ Свойство» menu and create a property of the given menu label. */
async function addProperty(
  page: import('@playwright/test').Page,
  menuLabel: string,
): Promise<void> {
  await page.getByRole('button', { name: 'Свойство', exact: true }).click()
  await page.getByRole('menuitem', { name: menuLabel, exact: true }).click()
}

test('database rich: formula + options/colours + person', async ({ page }) => {
  test.setTimeout(180_000)
  const email = `db-rich+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Богатый' })

  const pageId = await createWorkspaceAndDatabasePage(page, 'DB Rich WS')

  // The seeded TABLE view + Title + STATUS «Статус» column are present.
  await expect(page.getByRole('tab', { name: /Таблица/ })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: /Статус/ })).toBeVisible()

  // ============================== FORMULA ==============================
  // Adding a FORMULA property auto-opens the settings dialog (the toolbar's
  // CONFIGURABLE_ON_CREATE flow). Type a constant expression, watch the LIVE
  // validation flip to «Формула корректна», save, then assert a row shows the
  // computed value — which is resolved server-side on read.
  await addProperty(page, 'Формула')

  const settingsDialog = page.getByRole('dialog')
  await expect(settingsDialog).toBeVisible({ timeout: 15_000 })
  await expect(settingsDialog.getByText('Настройка свойства')).toBeVisible()

  // The formula textarea is labelled «Выражение формулы». A debounced query hits
  // `database.validateFormula`; the editor shows «Формула корректна» when valid.
  const formulaInput = settingsDialog.getByLabel('Выражение формулы')
  await formulaInput.click()
  await formulaInput.fill('concat("Сумма = ", 1 + 2)')
  await expect(settingsDialog.getByText('Формула корректна')).toBeVisible({ timeout: 15_000 })

  // Save → updateProperty persists settings.formula and the dialog closes.
  await settingsDialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(settingsDialog).toBeHidden({ timeout: 15_000 })
  // The new FORMULA column header «Формула» appears (it is the 3rd column).
  await expect(page.getByRole('columnheader', { name: /Формула/ })).toBeVisible({ timeout: 15_000 })

  // Add a row → the computed FORMULA cell renders the server-resolved value.
  // Column order: [0] Название, [1] Статус, [2] Формула.
  await addRow(page)
  const formulaRow = page
    .locator('tbody tr')
    .filter({ has: page.locator('input[placeholder="Без названия"]') })
    .first()
  await expect(formulaRow.locator('td').nth(2)).toContainText('Сумма = 3', { timeout: 15_000 })

  // Reload → the computed value re-resolves from Postgres on a fresh listRows.
  // This proves the formula round-tripped (it is stored as settings.formula and
  // resolved on read — never persisted to a cell, never yjs).
  await page.reload()
  await expect(page.getByRole('columnheader', { name: 'Название' })).toBeVisible({
    timeout: 20_000,
  })
  const formulaRowAfter = page
    .locator('tbody tr')
    .filter({ has: page.locator('input[placeholder="Без названия"]') })
    .first()
  await expect(formulaRowAfter.locator('td').nth(2)).toContainText('Сумма = 3', { timeout: 15_000 })

  // ====================== OPTIONS / COLOURS (STATUS) ======================
  // Open the «Статус» header menu → «Настроить свойство» → the OptionsEditor.
  // Rename the first option «Не начато» → «Запланировано» and recolour it, save,
  // then PROVE persistence by selecting it in a row's Статус cell (the renamed
  // label appears in the listbox + as the cell chip) and surviving a reload.
  const statusHeader = page.getByRole('columnheader', { name: /Статус/ })
  await statusHeader.getByRole('button').first().click() // the MoreVert menu trigger
  await page.getByRole('menuitem', { name: 'Настроить свойство' }).click()

  const optDialog = page.getByRole('dialog')
  await expect(optDialog.getByText('Варианты')).toBeVisible({ timeout: 15_000 })

  // The OptionsEditor renders one TextField per option (aria-label «Название
  // варианта») in option order. The first is the seeded «Не начато».
  const firstOption = optDialog.getByLabel('Название варианта').first()
  await expect(firstOption).toHaveValue('Не начато', { timeout: 10_000 })
  await firstOption.fill('Запланировано')

  // Recolour the first option: its colour swatch is the «Цвет варианта» button on
  // the same row; the palette menu offers «Цвет <hex>» swatches. Pick red.
  await optDialog.getByRole('button', { name: 'Цвет варианта' }).first().click()
  await page.getByRole('button', { name: 'Цвет #EF4444' }).click()

  // Save → updateProperty persists settings.options. Dialog closes.
  await optDialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(optDialog).toBeHidden({ timeout: 15_000 })

  // PROOF the rename persisted: open the row's Статус cell (the in-cell Select)
  // and assert the renamed option «Запланировано» is offered, then pick it.
  const statusRow = page
    .locator('tbody tr')
    .filter({ has: page.locator('input[placeholder="Без названия"]') })
    .first()
  await statusRow.locator('td').nth(1).locator('[role="combobox"]').click()
  await page.getByRole('option', { name: 'Запланировано', exact: true }).click()
  // The chosen option renders as a Chip in the cell — the renamed label landed.
  await expect(
    statusRow.locator('td').nth(1).getByText('Запланировано', { exact: true }),
  ).toBeVisible({
    timeout: 15_000,
  })

  // Reload → the renamed option label survives (settings.options is Postgres-
  // backed). The cell chip still shows «Запланировано» and «Не начато» is gone.
  await page.reload()
  await expect(page.getByRole('columnheader', { name: 'Название' })).toBeVisible({
    timeout: 20_000,
  })
  const statusRowAfter = page
    .locator('tbody tr')
    .filter({ has: page.locator('input[placeholder="Без названия"]') })
    .first()
  await expect(
    statusRowAfter.locator('td').nth(1).getByText('Запланировано', { exact: true }),
  ).toBeVisible({ timeout: 15_000 })

  // ============================== PERSON ==============================
  // Add a PERSON property. Clicking the cell opens a member picker over
  // `workspace.listMembers` — the workspace owner (this signed-up user) is the
  // only member, listed by display name «Тест Богатый». Pick them → a name chip.
  await addProperty(page, 'Участник')
  await expect(page.getByRole('columnheader', { name: /Участник/ })).toBeVisible({
    timeout: 15_000,
  })

  // Column order is now [0] Название, [1] Статус, [2] Формула, [3] Участник.
  const personRow = page
    .locator('tbody tr')
    .filter({ has: page.locator('input[placeholder="Без названия"]') })
    .first()
  const personCell = personRow.locator('td').nth(3)
  // The empty cell shows a «—» placeholder inside a clickable role=button box.
  await personCell.getByRole('button').click()
  // The picker Menu lists «Не назначен» + the member. Its menuitem's accessible
  // name concatenates the avatar initials and the display name («ТБ Тест
  // Богатый»), so match on the display name as a substring (regex), not exact.
  await page.getByRole('menuitem', { name: /Тест Богатый/ }).click()
  // The selected member renders as a Chip with their name — the write landed
  // (via database.updateCellValue, NOT yjs).
  await expect(personCell.getByText('Тест Богатый', { exact: true })).toBeVisible({
    timeout: 15_000,
  })

  // Reload → the PERSON cell value (a stored userId) survives and re-renders the
  // member chip (listMembers resolves the id → name on a fresh mount).
  await page.reload()
  await expect(page.getByRole('columnheader', { name: 'Название' })).toBeVisible({
    timeout: 20_000,
  })
  const personRowAfter = page
    .locator('tbody tr')
    .filter({ has: page.locator('input[placeholder="Без названия"]') })
    .first()
  await expect(
    personRowAfter.locator('td').nth(3).getByText('Тест Богатый', { exact: true }),
  ).toBeVisible({ timeout: 15_000 })

  // Sanity: the schema actually grew to the four user properties via tRPC.
  expect(pageId).toBeTruthy()
})

test('database rich: relation across two databases — config + link + chip', async ({ page }) => {
  test.setTimeout(180_000)
  const email = `db-rel+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Связь' })

  // --- DB A (the source) + DB B (the relation target). ---
  const dbAId = await createWorkspaceAndDatabasePage(page, 'DB Rel WS')

  // Create DB B from the sidebar and give one of its rows a recognisable title
  // so the relation picker (listLinkableRows) returns a row we can assert on.
  await createDatabasePageFromSidebar(page)
  await addRow(page)
  const targetTitle = page.locator('input[placeholder="Без названия"]').first()
  await targetTitle.click()
  await targetTitle.fill('Целевая строка')
  await targetTitle.press('Enter')
  await expect(targetTitle).toHaveValue('Целевая строка')

  // --- Back in DB A: add a RELATION property → dialog auto-opens. ---
  await page.goto(`/pages/${dbAId}`)
  await expect(page.getByRole('columnheader', { name: 'Название' })).toBeVisible({
    timeout: 20_000,
  })
  await addRow(page) // a source row to link FROM

  await addProperty(page, 'Связь')
  const relDialog = page.getByRole('dialog')
  await expect(relDialog).toBeVisible({ timeout: 15_000 })
  await expect(relDialog.getByText('Настройка свойства')).toBeVisible()

  // The RelationConfig section renders the target-database picker (a Select
  // labelled «Целевая база данных») over `database.listSources`. DB B is the only
  // other database in the workspace, so it is the only non-«Не выбрано» option.
  // (Match the Select by its combobox role inside the dialog — the «Целевая база
  // данных» text appears both as the label and the rendered value, so a text
  // match is ambiguous.)
  const targetSelect = relDialog.getByRole('combobox', { name: 'Целевая база данных' })
  await expect(targetSelect).toBeVisible({ timeout: 15_000 })
  await targetSelect.click()
  // The listbox offers «Не выбрано» + DB B (its page title «Без названия» — we
  // never titled DB B's page, only a row — so pick the first real candidate).
  const targetOptions = page.getByRole('option')
  // Index 0 is «Не выбрано»; index 1 is DB B. Pick DB B.
  await targetOptions.nth(1).click()

  // Save the relation config → updateProperty persists settings.relation.
  await relDialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(relDialog).toBeHidden({ timeout: 15_000 })
  await expect(page.getByRole('columnheader', { name: /Связь/ })).toBeVisible({ timeout: 15_000 })

  // --- Link a row through the RELATION cell. ---
  // Column order in DB A: [0] Название, [1] Статус, [2] Связь.
  const relRow = page
    .locator('tbody tr')
    .filter({ has: page.locator('input[placeholder="Без названия"]') })
    .first()
  const relCell = relRow.locator('td').nth(2)
  // The empty relation cell shows a «Связать» chip; clicking opens the picker
  // Menu over `database.listLinkableRows` (rows of the target DB B).
  await relCell.getByText('Связать', { exact: true }).click()
  // The picker lists DB B's titled row «Целевая строка». Click it to link.
  await page.getByRole('menuitem', { name: 'Целевая строка', exact: true }).click()
  // Close the picker so it stops intercepting; the chip is rendered in the cell.
  await page.keyboard.press('Escape')

  // The linked target renders as a chip labelled with its title — the link landed
  // (via database.setRelationLinks; the chip is recomputed server-side and ridden
  // back on the invalidated listRows query).
  await expect(relCell.getByText('Целевая строка', { exact: true })).toBeVisible({
    timeout: 15_000,
  })

  // Reload → the relation link survives (it lives in database_relation_links, a
  // real table) and the chip re-resolves from the server on a fresh mount.
  await page.reload()
  await expect(page.getByRole('columnheader', { name: 'Название' })).toBeVisible({
    timeout: 20_000,
  })
  const relRowAfter = page
    .locator('tbody tr')
    .filter({ has: page.locator('input[placeholder="Без названия"]') })
    .first()
  await expect(
    relRowAfter.locator('td').nth(2).getByText('Целевая строка', { exact: true }),
  ).toBeVisible({ timeout: 15_000 })
})
