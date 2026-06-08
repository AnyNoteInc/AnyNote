import { expect, test } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

/*
 * Database MVP end-to-end.
 *
 * No-yjs constraint (important): the Playwright `webServer` is just `next dev`
 * on port 3100 — there is NO Hocuspocus (yjs) server. So the collaborative
 * *body* of an item page (the `PageView`/ProseMirror editor inside the item
 * modal) cannot persist or even reliably connect under E2E. Every assertion
 * below therefore targets tRPC-backed state — table rows, properties, cell
 * values, the item modal opening, and the item *title* (which is `Page.title`,
 * written via `database.updateRow`, NOT yjs). Cell/title edits are asserted to
 * survive a full `page.reload()` precisely because they are tRPC/Postgres-backed,
 * unlike the body which would be lost. We never assert item-body content.
 */

/**
 * Create the first workspace, then a DATABASE page via the redesigned sidebar
 * create flow (each section exposes its own «Новая страница» button; the
 * page-type dialog offers a «База данных» card). Adapted from
 * page-sharing.spec.ts `createWorkspaceAndTextPage` — the only differences are
 * picking «База данных» instead of «Текст» and waiting for the database table
 * (a DATABASE page has no ProseMirror; it renders the table toolbar instead).
 *
 * Returns the new page id parsed from the URL.
 */
async function createWorkspaceAndDatabasePage(
  page: import('@playwright/test').Page,
  workspaceName: string,
): Promise<string> {
  await page.getByRole('textbox', { name: 'Название' }).fill(workspaceName)
  // On a cold-compiled server the submit button can be momentarily disabled until
  // the form hydrates; wait for it to become enabled before clicking.
  const createWsButton = page.getByRole('button', { name: 'Создать пространство' })
  await expect(createWsButton).toBeEnabled({ timeout: 20_000 })
  await createWsButton.click()
  // Creation redirects through /app to a neutral URL (the seeded start page).
  await page.waitForURL(/\/(pages|chats)\//, { timeout: 30_000 })
  const startUrl = page.url()

  await page.getByRole('button', { name: 'Новая страница' }).first().click()
  // The page-type grid renders each type as a card labelled «Создать страницу: <label>».
  await page.getByRole('button', { name: 'Создать страницу: База данных' }).click()
  await page.waitForURL((url) => /\/pages\/[a-f0-9-]+/.test(url.href) && url.href !== startUrl, {
    timeout: 15_000,
  })

  // A freshly provisioned DATABASE page seeds a TABLE view «Таблица», the system
  // Title column «Название», and one STATUS property «Статус». Wait for the
  // table header (tRPC-backed, no yjs needed) rather than a ProseMirror editor.
  await expect(page.getByRole('columnheader', { name: 'Название' })).toBeVisible({
    timeout: 20_000,
  })

  const pageId = /\/pages\/([a-f0-9-]+)/.exec(page.url())?.[1]
  expect(pageId).toBeTruthy()
  return pageId!
}

test('database MVP: create, add row, add property, edit cell, open item modal', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const email = `db-mvp+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'База' })

  await createWorkspaceAndDatabasePage(page, 'DB WS')

  // --- Toolbar is visible (the «Строка» / «Свойство» buttons + view chip). ---
  // The toolbar buttons render the label text only (an AddIcon precedes it), so
  // they are matched by accessible name «Строка» / «Свойство».
  const addRowButton = page.getByRole('button', { name: 'Строка', exact: true })
  const addPropertyButton = page.getByRole('button', { name: 'Свойство', exact: true })
  await expect(addRowButton).toBeVisible()
  await expect(addPropertyButton).toBeVisible()
  // The seeded view shows as a chip labelled «Таблица».
  await expect(page.getByText('Таблица', { exact: true })).toBeVisible()
  // The seeded STATUS property «Статус» is a column header out of the box.
  await expect(page.getByRole('columnheader', { name: /Статус/ })).toBeVisible()

  // The table starts with no rows.
  await expect(page.getByText('Пока нет строк')).toBeVisible()

  // --- Add a row → a new row appears (title cell with «Без названия» placeholder). ---
  await addRowButton.click()
  // The system Title column renders an InputBase with placeholder «Без названия».
  const rowTitleInput = page.locator('input[placeholder="Без названия"]')
  await expect(rowTitleInput.first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Пока нет строк')).toHaveCount(0)
  // The body now has exactly one data row's title input.
  await expect(rowTitleInput).toHaveCount(1)

  // --- Add a property → a «Текст» column header appears. ---
  // Capture the header count before, so we can locate the NEW column by index
  // (the table header order is: Название, Статус, then the new property).
  await addPropertyButton.click()
  // The «+ Свойство» menu lists creatable types; pick «Текст» (creates a TEXT property).
  await page.getByRole('menuitem', { name: 'Текст', exact: true }).click()
  await expect(page.getByRole('columnheader', { name: /Текст/ })).toBeVisible({ timeout: 15_000 })

  // --- Edit the new TEXT cell → the value persists across a reload (tRPC-backed). ---
  // Column order: [0] Название (title), [1] Статус (STATUS Select), [2] Текст (TEXT
  // InputBase). Target the TEXT cell by its column index inside the single data
  // row to avoid the STATUS Select's hidden native input. The TextCell renders an
  // editable <input> inside that <td>.
  const dataRow = page.locator('tbody tr').filter({ has: rowTitleInput }).first()
  const textCellInput = dataRow.locator('td').nth(2).locator('input')
  await textCellInput.click()
  await textCellInput.fill('hello-db')
  // Commit on blur (the cell persists on blur / Enter).
  await textCellInput.press('Enter')

  // Reload — a tRPC/Postgres-backed cell survives, unlike yjs body content.
  // (Assert the live DOM value via toHaveValue, NOT a `[value=...]` attribute
  // selector: MUI InputBase is controlled, so the HTML `value` attribute does
  // not track edits — only the input *property* does, which toHaveValue reads.)
  await page.reload()
  await expect(page.getByRole('columnheader', { name: 'Название' })).toBeVisible({
    timeout: 20_000,
  })
  const dataRowAfterReload = page
    .locator('tbody tr')
    .filter({ has: page.locator('input[placeholder="Без названия"]') })
    .first()
  await expect(dataRowAfterReload.locator('td').nth(2).locator('input')).toHaveValue('hello-db', {
    timeout: 15_000,
  })

  // --- Open the item from the title column → the item modal opens (?rowId=). ---
  // First give the row a title so we can assert the modal title round-trips.
  const titleAfterReload = page.locator('input[placeholder="Без названия"]').first()
  await titleAfterReload.click()
  await titleAfterReload.fill('Моя строка')
  await titleAfterReload.press('Enter')
  await expect(titleAfterReload).toHaveValue('Моя строка')

  // The open affordance (an «Открыть строку» icon button) is hidden until the
  // title cell is hovered; hover the cell, then click the reveal button.
  const titleCellBox = page.locator('tbody tr').first().locator('td').first()
  await titleCellBox.hover()
  const openButton = page.getByRole('button', { name: 'Открыть строку' }).first()
  await openButton.click()

  // The URL gains ?rowId=<id> and the peek modal opens (a Dialog).
  await expect(page).toHaveURL(/[?&]rowId=/, { timeout: 15_000 })
  const modal = page.getByRole('dialog')
  await expect(modal).toBeVisible({ timeout: 15_000 })
  // The «Свойства» rail is part of the modal chrome (tRPC-backed, not yjs body).
  await expect(modal.getByText('Свойства', { exact: true })).toBeVisible()

  // --- Edit the item title in the modal → it updates (Page.title, tRPC-backed). ---
  // The modal title is the large InputBase (placeholder «Без названия») in the
  // dialog header; it is prefilled with the row title. Locate it structurally
  // (NOT by `[value=...]`) and assert its live value.
  const modalTitle = modal.locator('input[placeholder="Без названия"]').first()
  await expect(modalTitle).toBeVisible({ timeout: 10_000 })
  await expect(modalTitle).toHaveValue('Моя строка', { timeout: 10_000 })
  await modalTitle.click()
  await modalTitle.fill('Переименованная строка')
  await modalTitle.press('Enter')
  await expect(modalTitle).toHaveValue('Переименованная строка')

  // Close the modal (clears ?rowId=) and verify the table title cell reflects the
  // new value — proving the title write went through tRPC, not yjs.
  await modal.getByRole('button', { name: 'Закрыть' }).click()
  await expect(page).not.toHaveURL(/[?&]rowId=/, { timeout: 10_000 })
  await expect(page.locator('input[placeholder="Без названия"]').first()).toHaveValue(
    'Переименованная строка',
    { timeout: 15_000 },
  )

  // Final proof of persistence: reload and the renamed title is still there
  // (Page.title is Postgres-backed; this would be lost if it depended on yjs).
  await page.reload()
  await expect(page.getByRole('columnheader', { name: 'Название' })).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.locator('input[placeholder="Без названия"]').first()).toHaveValue(
    'Переименованная строка',
    { timeout: 15_000 },
  )
})
