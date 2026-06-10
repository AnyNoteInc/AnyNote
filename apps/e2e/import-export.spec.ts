import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'
const WORKSPACE_NAME = 'Импорт WS'

/**
 * Import/Export Center E2E.
 *
 * Jobs run in-process in the dev server (fire-and-forget background tasks), so
 * a job reaches «Готово» without any extra service. The Playwright webServer is
 * just `next dev` with NO yjs server — all assertions target tRPC-backed UI
 * (settings job table, sidebar page tree) and the artifact download route,
 * never collaborative editor content.
 */

test.setTimeout(180_000)

async function signUpAndCreateWorkspace(page: Page, slug: string): Promise<void> {
  const email = `${slug}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Импорт' })

  // After sign-up the user lands on the workspace-creation form. Creating the
  // workspace seeds the welcome page and redirects to a neutral URL.
  // On a cold dev server hydration can lag behind the first fill(), leaving the
  // submit button disabled — re-fill until React registers the value.
  const nameInput = page.getByRole('textbox', { name: 'Название' })
  const createButton = page.getByRole('button', { name: 'Создать пространство' })
  await expect(async () => {
    await nameInput.fill(WORKSPACE_NAME)
    await expect(createButton).toBeEnabled({ timeout: 2_000 })
  }).toPass({ timeout: 60_000 })
  await createButton.click()
  await page.waitForURL(/\/(pages|chats)\//, { timeout: 30_000 })
}

// Settings live in a full-screen dialog opened from the owner-only space menu
// (workspace name in the sidebar header → «Настройки» → section nav button).
async function openImportExportSettings(page: Page) {
  await page.locator('aside').getByText(WORKSPACE_NAME, { exact: true }).click()
  await page.getByRole('button', { name: 'Настройки' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Импорт и экспорт' }).click()
  await expect(dialog.getByRole('button', { name: 'Импорт и экспорт' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  return dialog
}

test.describe('import/export center', () => {
  test('imports a zip into a nested page tree', async ({ page }) => {
    await signUpAndCreateWorkspace(page, 'import-zip')
    await openImportExportSettings(page)

    await page.getByTestId('open-import').click()
    const wizard = page.getByTestId('import-wizard')
    await expect(wizard).toBeVisible()

    // The wizard now opens on the source-picker step; the file input only
    // renders after a source card is selected.
    await page.getByTestId('import-source-generic').click()

    // setInputFiles works on the hidden <input type="file"> directly.
    await page
      .getByTestId('import-file-input')
      .setInputFiles(path.join(__dirname, 'fixtures', 'import-sample.zip'))
    await expect(page.getByTestId('import-pick-file')).toContainText('import-sample.zip')
    await page.getByTestId('import-submit').click()

    await expect(wizard.getByText(/Импорт запущен/)).toBeVisible({ timeout: 20_000 })
    // The settings dialog's close IconButton is also labelled «Закрыть» — scope
    // the click to the wizard dialog.
    await wizard.getByRole('button', { name: 'Закрыть' }).click()
    await expect(wizard).not.toBeVisible()

    // The job table polls every 2.5s while the job is queued/processing.
    const importRow = page.getByTestId('job-row').filter({ hasText: 'Импорт' })
    await expect(importRow).toContainText('import-sample.zip')
    await expect(importRow.getByText('Готово')).toBeVisible({ timeout: 60_000 })

    // The sidebar tree query is not invalidated by the background job — reload,
    // then switch the sidebar to the pages section (no-op if already active) and
    // verify the imported root page is in the tree.
    await page.reload()
    await page.getByRole('button', { name: 'Домашняя', exact: true }).click()
    await expect(page.locator('aside').getByText('Проект', { exact: true })).toBeVisible({
      timeout: 20_000,
    })
  })

  test('imports a notion export zip with a database and a journal', async ({ page }) => {
    await signUpAndCreateWorkspace(page, 'notion-zip')
    await openImportExportSettings(page)

    await page.getByTestId('open-import').click()
    const wizard = page.getByTestId('import-wizard')
    await expect(wizard).toBeVisible()

    await page.getByTestId('import-source-notion').click()
    await page
      .getByTestId('import-file-input')
      .setInputFiles(path.join(__dirname, 'fixtures', 'notion-sample.zip'))
    await expect(page.getByTestId('import-pick-file')).toContainText('notion-sample.zip')
    await page.getByTestId('import-submit').click()

    await expect(wizard.getByText(/Импорт запущен/)).toBeVisible({ timeout: 20_000 })
    await wizard.getByRole('button', { name: 'Закрыть' }).click()
    await expect(wizard).not.toBeVisible()

    // The job row for a NOTION import is labelled «Импорт (Notion): …».
    const row = page.getByTestId('job-row').filter({ hasText: 'Notion' })
    await expect(row).toContainText('notion-sample.zip')
    await expect(row.getByText('Готово')).toBeVisible({ timeout: 60_000 })

    // Journal opens with the limitations warning + downloadable report link.
    await row.getByTestId('open-journal').click()
    const journal = page.getByTestId('import-log-dialog')
    await expect(journal).toBeVisible()
    await expect(journal.getByText(/не переносятся/)).toBeVisible()
    await expect(journal.getByTestId('download-report')).toBeVisible()
    await journal.getByRole('button', { name: 'Закрыть' }).click()
    await expect(journal).not.toBeVisible()

    // Cleaned titles (id suffixes stripped) land in the tree: the root page
    // «Проект» and the materialized database «База».
    await page.reload()
    await page.getByRole('button', { name: 'Домашняя', exact: true }).click()
    await expect(page.locator('aside').getByText('Проект', { exact: true })).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.locator('aside').getByText('База', { exact: true })).toBeVisible()
  })

  test('imports a csv with a type override into a typed database', async ({ page }) => {
    await signUpAndCreateWorkspace(page, 'csv-import')
    await openImportExportSettings(page)

    await page.getByTestId('open-import').click()
    const wizard = page.getByTestId('import-wizard')
    await expect(wizard).toBeVisible()

    await page.getByTestId('import-source-generic').click()
    await page
      .getByTestId('import-file-input')
      .setInputFiles(path.join(__dirname, 'fixtures', 'import-table.csv'))
    await expect(page.getByTestId('import-pick-file')).toContainText('import-table.csv')

    // The CSV preview pre-fills the database title from the file name and infers
    // per-column types. «Код» (full-header index 1; values 1/2/3) defaults to
    // NUMBER — pin it to text via the per-column Select.
    await expect(page.getByTestId('csv-db-title')).toBeVisible()
    await expect(page.getByTestId('csv-db-title')).toHaveValue('import-table')
    const codTypeSelect = page.getByTestId('csv-col-type-1')
    await expect(codTypeSelect).toContainText('Число')
    await codTypeSelect.click()
    await page.getByRole('option', { name: 'Текст' }).click()
    await expect(codTypeSelect).toContainText('Текст')

    await page.getByTestId('import-submit').click()
    await expect(wizard.getByText(/Импорт запущен/)).toBeVisible({ timeout: 20_000 })
    await wizard.getByRole('button', { name: 'Закрыть' }).click()
    await expect(wizard).not.toBeVisible()

    const row = page.getByTestId('job-row').filter({ hasText: 'import-table.csv' })
    await expect(row.getByText('Готово')).toBeVisible({ timeout: 60_000 })

    // The database materializes as a sidebar page named after the file (row item
    // pages stay hidden from the tree). Open it: the table view is tRPC-backed,
    // so it renders all 3 rows plus the inferred SELECT option labels.
    await page.reload()
    await page.getByRole('button', { name: 'Домашняя', exact: true }).click()
    await page.locator('aside').getByText('import-table', { exact: false }).first().click()
    await page.waitForURL(/\/pages\//, { timeout: 20_000 })

    // The editable table renders the system Title and the (override-forced) text
    // «Код» column as <input> cells, so their values live in `value`, not text
    // content — getByText('Альфа') would never match. Poll the live input values:
    // the 3 row titles (Альфа/Бета/Гамма) AND the «Код» values kept as TEXT by the
    // override (1/2/3, not coerced numbers) must all be present.
    await expect
      .poll(
        () =>
          page
            .locator('input')
            .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)),
        { timeout: 20_000 },
      )
      .toEqual(expect.arrayContaining(['Альфа', 'Бета', 'Гамма', '1', '2', '3']))

    // The overridden «Код» header and the inferred SELECT option labels render as
    // real text content.
    await expect(page.getByText('Код')).toBeVisible()
    await expect(page.getByText('Open').first()).toBeVisible()
    await expect(page.getByText('Done').first()).toBeVisible()
  })

  test('exports the workspace as a markdown zip with a download link', async ({ page }) => {
    await signUpAndCreateWorkspace(page, 'export-zip')
    await openImportExportSettings(page)

    // The fresh workspace contains the seeded welcome page, so a WORKSPACE-scope
    // export (the dialog default) has at least one page to bundle.
    await page.getByTestId('open-export').click()
    const dialog = page.getByTestId('bulk-export-dialog')
    await expect(dialog).toBeVisible()
    await page.getByTestId('export-submit').click()

    await expect(dialog.getByText(/Экспорт запущен/)).toBeVisible({ timeout: 20_000 })
    await dialog.getByRole('button', { name: 'Закрыть' }).click()
    await expect(dialog).not.toBeVisible()

    const exportRow = page.getByTestId('job-row').filter({ hasText: 'Экспорт' })
    await expect(exportRow.getByText('Готово')).toBeVisible({ timeout: 60_000 })

    const download = page.getByTestId('job-download')
    await expect(download).toBeVisible()
    const href = (await download.getAttribute('href')) ?? ''
    expect(href).toContain('/api/jobs/export/')

    // The artifact route serves the zip for the authenticated owner.
    const res = await page.request.get(href)
    expect(res.status()).toBe(200)
    const body = await res.body()
    expect(body.subarray(0, 2).toString()).toBe('PK')
  })

  test('exports a subtree as a pdf archive', async ({ page }) => {
    await signUpAndCreateWorkspace(page, 'pdf-export')
    await openImportExportSettings(page)

    await page.getByTestId('open-export').click()
    const dialog = page.getByTestId('bulk-export-dialog')
    await expect(dialog).toBeVisible()

    // PDF is disabled for the WORKSPACE scope, so switch to SUBTREE first. The
    // PageTreePicker rows are plain boxes — pick the seeded welcome page by title.
    await dialog.getByRole('button', { name: 'Поддерево' }).click()
    await dialog.getByText('Добро пожаловать в AnyNote').click()
    await dialog.getByRole('button', { name: 'PDF', exact: true }).click()
    await page.getByTestId('export-submit').click()

    await expect(dialog.getByText(/Экспорт запущен/)).toBeVisible({ timeout: 20_000 })
    await dialog.getByRole('button', { name: 'Закрыть' }).click()
    await expect(dialog).not.toBeVisible()

    // The job renders through the REAL Gotenberg container from compose; the
    // export row is labelled «Экспорт: страница с подстраницами · PDF».
    const exportRow = page.getByTestId('job-row').filter({ hasText: 'PDF' })
    await expect(exportRow.getByText('Готово')).toBeVisible({ timeout: 90_000 })

    const download = page.getByTestId('job-download')
    await expect(download).toBeVisible()
    const href = (await download.getAttribute('href')) ?? ''
    expect(href).toContain('/api/jobs/export/')

    // The artifact is a zip whose entries are real PDFs — an .html entry here
    // would mean every Gotenberg render silently fell back.
    const res = await page.request.get(href)
    expect(res.status()).toBe(200)
    const body = await res.body()
    expect(body.subarray(0, 2).toString()).toBe('PK')
    expect(body.toString('latin1')).toContain('.pdf')
  })
})
