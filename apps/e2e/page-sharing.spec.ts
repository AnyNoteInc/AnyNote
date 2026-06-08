import { expect, test } from '@playwright/test'

import { signUpAndAuthAs, loadEnvFromRoot } from './helpers/auth'

const password = 'SuperSecure123!'

test('owner shares a TEXT page publicly; an anonymous visitor opens it read-only', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000)
  const email = `share+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Тест' })

  // First run: create a workspace.
  await page.getByRole('textbox', { name: 'Название' }).fill('Share WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/chats/, { timeout: 30_000 })

  // Create a TEXT page.
  await page.getByRole('button', { name: 'Страницы' }).click()
  await page.getByRole('button', { name: 'Новая страница' }).first().click()
  await page.getByRole('button', { name: 'Создать страницу: Текст' }).click()
  await page.waitForURL(/\/pages\/[a-f0-9-]+/, { timeout: 15_000 })
  await expect(page.locator('.anynote-editor .ProseMirror')).toBeVisible({ timeout: 15_000 })

  const pageId = /\/pages\/([a-f0-9-]+)/.exec(page.url())?.[1]
  expect(pageId).toBeTruthy()

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
