import { expect, test } from '@playwright/test'

import { signUpAndAuthAs, loadEnvFromRoot } from './helpers/auth'

const password = 'SuperSecure123!'

/**
 * Create the first workspace, then a fresh TEXT page via the redesigned sidebar
 * (each section — Команда / Личное — exposes its own «Новая страница» button).
 * Returns the new page id parsed from the URL.
 */
async function createWorkspaceAndTextPage(
  page: import('@playwright/test').Page,
  workspaceName: string,
): Promise<string> {
  await page.getByRole('textbox', { name: 'Название' }).fill(workspaceName)
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  // Creation redirects through /app to a neutral URL (the seeded start page).
  await page.waitForURL(/\/(pages|chats)\//, { timeout: 30_000 })
  const startUrl = page.url()

  await page.getByRole('button', { name: 'Новая страница' }).first().click()
  await page.getByRole('button', { name: 'Создать страницу: Текст' }).click()
  await page.waitForURL((url) => /\/pages\/[a-f0-9-]+/.test(url.href) && url.href !== startUrl, {
    timeout: 15_000,
  })
  await expect(page.locator('.anynote-editor .ProseMirror')).toBeVisible({ timeout: 15_000 })

  const pageId = /\/pages\/([a-f0-9-]+)/.exec(page.url())?.[1]
  expect(pageId).toBeTruthy()
  return pageId!
}

test('owner shares a TEXT page publicly; an anonymous visitor opens it read-only', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000)
  const email = `share+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Тест' })

  const pageId = await createWorkspaceAndTextPage(page, 'Share WS')

  // Open the share dialog (the owner sees the «Поделиться» button).
  await page.getByRole('button', { name: 'Поделиться' }).click()
  await expect(page.getByRole('button', { name: 'Копировать ссылку' })).toBeVisible({
    timeout: 15_000,
  })

  // Switch to «Всем, у кого есть ссылка» — the only combobox before any grants.
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Всем, у кого есть ссылка' }).click()

  // Resolve the shareId from the DB (headless clipboard access is unreliable).
  loadEnvFromRoot()
  const { prisma } = await import('../../packages/db/src/index')
  let shareId: string | undefined
  for (let i = 0; i < 50; i += 1) {
    const row = await prisma.pageShare.findUnique({
      where: { pageId },
      select: { shareId: true, access: true },
    })
    if (row?.access === 'PUBLIC') {
      shareId = row.shareId
      break
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  expect(shareId).toMatch(/^[0-9a-f]{64}$/)

  // Anonymous visitor (fresh context, no auth cookies) opens the public link.
  const anon = await browser.newContext()
  const anonPage = await anon.newPage()
  await anonPage.goto(`http://localhost:3100/s/${shareId}`)

  // The share chrome renders for an anonymous reader (not 404, not the sign-in gate),
  // and the reader role yields a read-only view.
  await expect(anonPage.getByText('Общий доступ')).toBeVisible({ timeout: 20_000 })
  await expect(anonPage.getByText('Только просмотр')).toBeVisible()

  await anonPage.getByRole('button', { name: 'Комментарии', exact: true }).click()
  const commentsSidebar = anonPage.locator('.comments-sidebar')
  await expect(commentsSidebar).toBeVisible({ timeout: 10_000 })

  const sidebarBox = await commentsSidebar.boundingBox()
  const contentBox = await anonPage.locator('.share-page-content').boundingBox()
  expect(sidebarBox).not.toBeNull()
  expect(contentBox).not.toBeNull()
  expect(sidebarBox!.y).toBeLessThan(contentBox!.y)

  await anon.close()
})

test('a link with an expiry in the past shows the "истёк" unavailable state', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000)
  const email = `share-expiry+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Срок' })

  const pageId = await createWorkspaceAndTextPage(page, 'Expiry WS')

  // Enable the public link via the share dialog (reusing the existing open flow).
  await page.getByRole('button', { name: 'Поделиться' }).click()
  await expect(page.getByRole('button', { name: 'Копировать ссылку' })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Всем, у кого есть ссылка' }).click()

  // Resolve the shareId from the DB once the link is public.
  loadEnvFromRoot()
  const { prisma } = await import('../../packages/db/src/index')
  let shareId: string | undefined
  for (let i = 0; i < 50; i += 1) {
    const row = await prisma.pageShare.findUnique({
      where: { pageId },
      select: { shareId: true, access: true },
    })
    if (row?.access === 'PUBLIC') {
      shareId = row.shareId
      break
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  expect(shareId).toMatch(/^[0-9a-f]{64}$/)

  // (a) While the link is live, an anonymous visitor can open it.
  const anon = await browser.newContext()
  const anonPage = await anon.newPage()
  await anonPage.goto(`http://localhost:3100/s/${shareId}`)
  await expect(anonPage.getByText('Общий доступ')).toBeVisible({ timeout: 20_000 })

  // (b) Set the link's expiry into the past. The picker UI is `disablePast`, so a
  // past expiry can only originate from the clock advancing past a once-future
  // value — we simulate that terminal state directly on the tRPC-backed column
  // (the resolver reads `expiresAt` vs. now; the picker only feeds it).
  await prisma.pageShare.update({
    where: { pageId },
    data: { expiresAt: new Date(Date.now() - 60_000) },
  })

  // The same anonymous visitor now sees the expired unavailable screen. The RSC
  // resolver re-evaluates `expiresAt` on every request, so a fresh navigation
  // (no auth) surfaces the terminal state without needing yjs.
  await anonPage.goto(`http://localhost:3100/s/${shareId}`)
  await expect(anonPage.getByText('Срок действия ссылки истёк')).toBeVisible({ timeout: 20_000 })
  // The page body must NOT render once expired.
  await expect(anonPage.locator('.share-page-content')).toHaveCount(0)

  await anon.close()
})
