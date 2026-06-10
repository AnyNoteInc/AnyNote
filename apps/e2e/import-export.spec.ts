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
})
