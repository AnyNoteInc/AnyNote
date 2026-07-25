import { expect, type Page } from '@playwright/test'

/**
 * Create the first workspace, then a DATABASE page via the redesigned sidebar
 * create flow (each section exposes its own «Новая страница» button; the
 * page-type dialog offers a «База данных» card). Promoted from
 * database-mvp.spec.ts so new specs stop copy-pasting the flow (the older
 * database specs still carry private copies).
 *
 * Returns the new page id parsed from the URL.
 */
export async function createWorkspaceAndDatabasePage(
  page: Page,
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
