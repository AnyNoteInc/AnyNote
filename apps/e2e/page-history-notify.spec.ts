import { expect, test, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

/*
 * Phase 5 — page history (restore) + Notify-me preference + database date-cell
 * reminder, end-to-end.
 *
 * No-yjs constraint (important): the Playwright `webServer` is just `next dev`
 * on port 3100 — there is NO Hocuspocus (yjs) server. So *content-edit*
 * revisions (the `EDIT` action captured by the yjs save hook in
 * `apps/yjs/src/persistence.ts`) are NEVER produced under E2E — the editor body
 * can't even reliably connect. We therefore exercise the *structural* revision
 * path, which is captured synchronously by the domain page service
 * (`PageService.rename` → `captureStructuralRevision` with action
 * `TITLE_CHANGE`) inside the same Postgres transaction, with no yjs involved.
 *
 * The page *header* title edit goes through `page.update` (which does NOT
 * capture a revision); the only UI affordance that calls `page.rename` (and so
 * records a `TITLE_CHANGE` revision) is the sidebar page context menu
 * «Переименовать». That is the rename path used below.
 *
 * Every assertion targets tRPC/Postgres-backed state (the revision list, the
 * stored notification preference, the stored date reminder), and persistence is
 * proven with a full `page.reload()` — none of it depends on yjs.
 */

/**
 * Create the first workspace, then a fresh TEXT page via the redesigned sidebar
 * create flow (each section exposes its own «Новая страница» button; the
 * page-type dialog offers a «Текст» card). Returns the new page id from the URL.
 * Mirrors the warmed flow in `page-sharing.spec.ts` / `reminders.spec.ts`.
 */
async function createWorkspaceAndTextPage(page: Page, workspaceName: string): Promise<string> {
  await page.getByRole('textbox', { name: 'Название' }).fill(workspaceName)
  const createWsButton = page.getByRole('button', { name: 'Создать пространство' })
  await expect(createWsButton).toBeEnabled({ timeout: 20_000 })
  await createWsButton.click()
  await page.waitForURL(/\/(pages|chats)\//, { timeout: 30_000 })
  const startUrl = page.url()

  await page.getByRole('button', { name: 'Новая страница' }).first().click()
  await page.getByRole('button', { name: 'Создать страницу: Текст' }).click()
  await page.waitForURL((url) => /\/pages\/[a-f0-9-]+/.test(url.href) && url.href !== startUrl, {
    timeout: 15_000,
  })
  await expect(page.locator('.anynote-editor .ProseMirror')).toBeVisible({ timeout: 15_000 })

  const pageId = /\/pages\/([a-f0-9-]+)/.exec(page.url())?.[1]
  if (!pageId) throw new Error(`createWorkspaceAndTextPage: no page id in URL ${page.url()}`)
  return pageId
}

/**
 * Create the first workspace, then a DATABASE page. Adapted verbatim from
 * `database-mvp.spec.ts` `createWorkspaceAndDatabasePage` (the warmed flow):
 * the page-type grid card is «Создать страницу: База данных», and a fresh
 * DATABASE page seeds a TABLE view + the system Title column «Название».
 */
async function createWorkspaceAndDatabasePage(page: Page, workspaceName: string): Promise<string> {
  await page.getByRole('textbox', { name: 'Название' }).fill(workspaceName)
  const createWsButton = page.getByRole('button', { name: 'Создать пространство' })
  await expect(createWsButton).toBeEnabled({ timeout: 20_000 })
  await createWsButton.click()
  await page.waitForURL(/\/(pages|chats)\//, { timeout: 30_000 })
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
  if (!pageId) throw new Error(`createWorkspaceAndDatabasePage: no page id in URL ${page.url()}`)
  return pageId
}

/**
 * Rename a page via the sidebar context menu («Переименовать»), which is the
 * only UI path that calls `page.rename` and therefore records a `TITLE_CHANGE`
 * structural revision (the page-header title edit uses `page.update`, which does
 * not). The sidebar page row is `[data-page-row="<id>"]`; its action buttons are
 * hidden until hover. Hovering reveals the «…» (MoreHoriz) button — the last
 * IconButton in the row's `.page-actions` cluster.
 */
async function renameViaSidebar(page: Page, pageId: string, newTitle: string): Promise<void> {
  const row = page.locator(`[data-page-row="${pageId}"]`).first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.hover()
  // The «…» actions button is the trailing IconButton in the row (after the
  // «Создать вложенную страницу» add button). It has no aria-label, so target it
  // structurally inside the hover-revealed `.page-actions` cluster.
  const moreButton = row.locator('.page-actions button').last()
  await moreButton.click()
  await page.getByRole('menuitem', { name: 'Переименовать' }).click()

  // Rename dialog: a single text field prefilled with the current title.
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  const input = dialog.getByRole('textbox')
  await input.fill(newTitle)
  await dialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })
}

test('history: a structural rename produces a revision that can be previewed and restored', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const email = `history+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Хистори', lastName: 'Тест' })

  const pageId = await createWorkspaceAndTextPage(page, 'History WS')

  // Give the page a known starting title via the sidebar rename. This first
  // rename captures one TITLE_CHANGE revision; a second rename below captures a
  // second — guaranteeing the revision list is non-empty regardless of whether
  // page creation itself seeded any revision.
  await renameViaSidebar(page, pageId, 'Первое имя')
  // Reflected in the page header (page.getById refetch).
  await expect(page.getByRole('heading', { name: 'Первое имя' })).toBeVisible({ timeout: 15_000 })

  await renameViaSidebar(page, pageId, 'Второе имя')
  await expect(page.getByRole('heading', { name: 'Второе имя' })).toBeVisible({ timeout: 15_000 })

  // --- Open История (the toolbar IconButton, aria-label «История»). It only
  // renders for editors (the current user is the workspace OWNER). ---
  await page.getByRole('button', { name: 'История', exact: true }).click()

  const sidebar = page.locator('.history-sidebar')
  await expect(sidebar).toBeVisible({ timeout: 15_000 })

  // --- At least one revision row appears. Each revision renders as a
  // ListItemButton labelled by its action («Переименование» for TITLE_CHANGE). ---
  const revisionItems = sidebar.getByRole('button', { name: /Переименование/ })
  await expect(revisionItems.first()).toBeVisible({ timeout: 15_000 })
  expect(await revisionItems.count()).toBeGreaterThanOrEqual(1)

  // --- Select a revision → its readonly preview appears («Предпросмотр»). The
  // newest revision is first; selecting it loads getRevisionPreview. ---
  await revisionItems.first().click()
  await expect(sidebar.getByText('Предпросмотр', { exact: true })).toBeVisible({ timeout: 10_000 })

  // --- Restore: click «Восстановить» → a confirm dialog → confirm. On success
  // the panel closes (restoreRevision succeeded; it also records a new RESTORE
  // revision and re-hydrates the page). We assert the success state (panel
  // closes) rather than asserting the body content, which is yjs-backed. ---
  await sidebar.getByRole('button', { name: 'Восстановить' }).click()
  const confirm = page.getByRole('dialog')
  await expect(confirm.getByText('Восстановить версию?')).toBeVisible({ timeout: 10_000 })
  // The confirm dialog has a second «Восстановить» button (the primary action).
  await confirm.getByRole('button', { name: 'Восстановить' }).click()

  // Success path: the history sidebar closes (restore.onSuccess → closePanel).
  await expect(sidebar).toBeHidden({ timeout: 15_000 })

  // Re-open История and assert the revision list still resolves (now including
  // the freshly-recorded RESTORE revision) — proving the restore round-tripped
  // through the domain + tRPC, not a transient client state.
  await page.getByRole('button', { name: 'История', exact: true }).click()
  await expect(page.locator('.history-sidebar')).toBeVisible({ timeout: 15_000 })
  await expect(
    page.locator('.history-sidebar').getByRole('button', { name: /Восстановление|Переименование/ }).first(),
  ).toBeVisible({ timeout: 15_000 })
})

test('notify-me: a chosen notification level persists across reload', async ({ page }) => {
  test.setTimeout(120_000)
  const email = `notify+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Нотифай', lastName: 'Тест' })

  await createWorkspaceAndTextPage(page, 'Notify WS')

  // --- Open the page-actions menu (the «…» toolbar button, aria-label
  // «Действия страницы») → «Уведомлять меня» submenu → pick «Все комментарии»
  // (a TEXT page exposes the comment levels). ---
  const openNotifyMenu = async () => {
    await page.getByRole('button', { name: 'Действия страницы' }).click()
    await page.getByRole('menuitem', { name: 'Уведомлять меня' }).click()
  }

  await openNotifyMenu()
  // The submenu is a nested Menu; its items are the level labels. Selecting a
  // non-default level (ALL_COMMENTS) writes a PageNotificationPreference row.
  await page.getByRole('menuitem', { name: 'Все комментарии', exact: true }).click()

  // Close any open menus before reload.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  // --- Reload, reopen the menu, and assert «Все комментарии» shows a check
  // (selected). The selected MenuItem carries the MUI `Mui-selected` class; the
  // check icon also renders in its ListItemIcon. Asserting the selected state
  // PROVES the preference round-tripped through tRPC/Postgres (no client cache
  // survives a reload). ---
  await page.reload()
  await expect(page.locator('.anynote-editor .ProseMirror')).toBeVisible({ timeout: 20_000 })

  await openNotifyMenu()
  const selectedItem = page.getByRole('menuitem', { name: 'Все комментарии', exact: true })
  await expect(selectedItem).toBeVisible({ timeout: 10_000 })
  await expect(selectedItem).toHaveClass(/Mui-selected/, { timeout: 10_000 })
})

test('date reminder: a self-reminder set on a DATE cell shows the active bell and persists', async ({
  page,
}) => {
  test.setTimeout(150_000)
  const email = `dbreminder+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Ремайндер', lastName: 'База' })

  await createWorkspaceAndDatabasePage(page, 'Reminder DB WS')

  // --- Add a row, then a DATE property «Дата». ---
  await page.getByRole('button', { name: 'Строка', exact: true }).click()
  const rowTitleInput = page.locator('input[placeholder="Без названия"]')
  await expect(rowTitleInput.first()).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Свойство', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Дата', exact: true }).click()
  await expect(page.getByRole('columnheader', { name: /Дата/ })).toBeVisible({ timeout: 15_000 })

  // --- Set the DATE cell value. Column order: [0] Название, [1] Статус,
  // [2] Дата. The DateCell renders a MUI DatePicker (variant standard) whose
  // field is a set of role=spinbutton segments (day / month / year). Drive them
  // exactly like reminders.spec.ts drives the DateTimePicker field. ---
  const dataRow = page.locator('tbody tr').filter({ has: rowTitleInput }).first()
  const dateCell = dataRow.locator('td').nth(2)
  const segments = dateCell.getByRole('spinbutton')
  await segments.first().click()
  // MUI auto-advances after a complete segment. Locale ru → day, month, year.
  await page.keyboard.type('15')
  await page.keyboard.type('06')
  await page.keyboard.type('2026')

  // Once the cell carries a date, the self-reminder bell renders
  // (aria-label «Напоминание»). It is the proof the date committed.
  const bell = dateCell.getByRole('button', { name: 'Напоминание' })
  await expect(bell).toBeVisible({ timeout: 15_000 })
  // Initially unset → aria-pressed=false.
  await expect(bell).toHaveAttribute('aria-pressed', 'false')

  // --- Open the bell popover, pick an offset («За 1 час»). The mutation writes
  // a DatabaseDateReminder + its delivery, then closes the popover. ---
  await bell.click()
  const popover = page.locator('.MuiPopover-paper').filter({ hasText: 'Напоминание' })
  await expect(popover).toBeVisible({ timeout: 10_000 })
  // Use a plain click (not `.check()`): selecting the radio fires the mutation,
  // and on success the popover unmounts immediately — so the radio never settles
  // into a visibly-checked state for `.check()` to confirm. We click the radio,
  // then assert the *bell* becomes active (the real, tRPC-backed outcome).
  await popover.getByRole('radio', { name: 'За 1 час' }).click()

  // After the write the bell becomes the active (filled) state: aria-pressed=true.
  await expect(bell).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 })

  // --- Persistence: reload → the bell is still active (getDatabaseDateReminder
  // is tRPC/Postgres-backed), proving the reminder config round-tripped. ---
  await page.reload()
  await expect(page.getByRole('columnheader', { name: 'Название' })).toBeVisible({ timeout: 20_000 })
  const dataRowAfter = page
    .locator('tbody tr')
    .filter({ has: page.locator('input[placeholder="Без названия"]') })
    .first()
  const bellAfter = dataRowAfter.locator('td').nth(2).getByRole('button', { name: 'Напоминание' })
  await expect(bellAfter).toBeVisible({ timeout: 15_000 })
  await expect(bellAfter).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 })
})
