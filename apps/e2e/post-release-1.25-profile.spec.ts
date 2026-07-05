import { test, expect, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const password = 'Test12345!'

/**
 * Create the first workspace, then a fresh TEXT page via the redesigned sidebar
 * create flow. Returns the new page id from the URL. Mirrors the warmed flow in
 * `page-history-notify.spec.ts`.
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
 * Rename a page via the sidebar context menu («Переименовать»), which is the
 * only UI path that calls `page.rename` and therefore records a `TITLE_CHANGE`
 * structural revision (the page-header title edit uses `page.update`, which does
 * not). A `page_revisions` row with `actor_id = caller` is exactly what
 * `user.activity` reads back into `recentActions`. Borrowed verbatim from
 * `page-history-notify.spec.ts`.
 */
async function renameViaSidebar(page: Page, pageId: string, newTitle: string): Promise<void> {
  const row = page.locator(`[data-page-row="${pageId}"]`).first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.hover()
  const moreButton = row.locator('.page-actions button').last()
  await moreButton.click()
  await page.getByRole('menuitem', { name: 'Переименовать' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  const input = dialog.getByRole('textbox')
  await input.fill(newTitle)
  await dialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })
}

test('/profile shows «Мои пространства» (default) and «Последние действия» tabs', async ({
  page,
}) => {
  await signUpAndAuthAs(page, {
    email: `profile-${Date.now()}@example.com`,
    password,
  })
  await page.goto('/profile')
  await expect(page.getByText('Активность', { exact: true })).toBeVisible()

  // Both tabs render; «Мои пространства» is selected by default.
  const workspacesTab = page.getByTestId('profile-tab-workspaces')
  await expect(workspacesTab).toBeVisible()
  await expect(workspacesTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('profile-tab-activity')).toBeVisible()

  // A fresh user has no workspaces yet: empty state + create CTA.
  await expect(page.getByText('У вас пока нет пространств')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Создать пространство' })).toBeVisible()

  // Switching to «Последние действия» shows the (empty) activity list.
  await page.getByTestId('profile-tab-activity').click()
  await expect(page.getByText('Пока нет активности')).toBeVisible()
})

/**
 * Regression guard for the RSC Date-serialization bug: a user WITH page-edit
 * activity has non-empty `recentActions`, each carrying a Prisma `Date`
 * `createdAt`. The profile RSC must serialize those Dates before passing them to
 * the `<RecentActivity>` client component — otherwise the page 500s at request
 * time ("Date objects are not supported"). The fresh-user test above never
 * exercises this path because a brand-new user's `recentActions` is empty.
 *
 * Activity is generated through pure UI (no Prisma seeding): a sidebar rename
 * records a `TITLE_CHANGE` revision for the signed-up user (see `renameViaSidebar`).
 */
test('/profile renders recent actions for a user WITH activity (no 500)', async ({ page }) => {
  test.setTimeout(120_000)
  await signUpAndAuthAs(page, {
    email: `profile-activity-${Date.now()}@example.com`,
    password,
  })

  // Create a TEXT page and rename it via the sidebar — this is the UI path that
  // records a `page_revisions` row (action=TITLE_CHANGE, actor_id=caller), which
  // `user.activity` reads back as a non-empty `recentActions` entry.
  const pageTitle = 'Профильная активность'
  const pageId = await createWorkspaceAndTextPage(page, 'Profile Activity WS')
  await renameViaSidebar(page, pageId, pageTitle)
  await expect(page.getByRole('heading', { name: pageTitle })).toBeVisible({ timeout: 15_000 })

  // Load /profile. With the Date-serialization fix this renders; without it the
  // RSC throws at request time and the root error boundary («Что-то пошло не
  // так») takes over.
  await page.goto('/profile')

  // The page rendered (did NOT 500): the activity heading is visible and the
  // error boundary is absent.
  await expect(page.getByText('Активность', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Последние действия')).toBeVisible()
  await expect(page.getByText('Что-то пошло не так')).toHaveCount(0)

  // The default «Мои пространства» tab lists the workspace created above.
  await expect(
    page.getByTestId('profile-workspace-card').filter({ hasText: 'Profile Activity WS' }),
  ).toBeVisible({ timeout: 15_000 })

  // The renamed page surfaces as a recent action under «Последние действия»,
  // proving the Date-carrying `recentActions` array crossed the RSC→client
  // boundary successfully (a serialized `createdAt`, not a raw Prisma Date).
  await page.getByTestId('profile-tab-activity').click()
  await expect(page.getByText(pageTitle).first()).toBeVisible({ timeout: 15_000 })

  // Clicking the workspace card routes back into the app (the card is the
  // switch-workspace entry point; for the already-active workspace it just
  // navigates to /app, which resolves to the workspace start route).
  await page.getByTestId('profile-tab-workspaces').click()
  await page
    .getByTestId('profile-workspace-card')
    .filter({ hasText: 'Profile Activity WS' })
    .click()
  await page.waitForURL(/\/(app|pages|chats)/, { timeout: 30_000 })
})
