import { expect, test } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

test('a COMMENTER public link renders a non-text board read-only', async ({ page, browser }) => {
  test.setTimeout(120_000)
  const email = `sharecomm+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Тест' })

  await page.getByRole('textbox', { name: 'Название' }).fill('Comm WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/(pages|chats)\//, { timeout: 30_000 })
  const workspaceId = /\/workspaces\/([a-f0-9-]+)\//.exec(page.url())?.[1]
  expect(workspaceId).toBeTruthy()

  loadEnvFromRoot()
  const { prisma } = await import('../../packages/db/src/index')
  const crypto = await import('node:crypto')
  const me = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })

  const created = await prisma.page.create({
    data: { workspaceId: workspaceId!, type: 'MERMAID', title: 'Diagram', createdById: me.id },
    select: { id: true },
  })
  const shareId = crypto.randomBytes(32).toString('hex')
  await prisma.pageShare.create({
    data: { pageId: created.id, shareId, access: 'PUBLIC', linkRole: 'COMMENTER', createdById: me.id },
  })

  const anon = await browser.newContext()
  const anonPage = await anon.newPage()
  await anonPage.goto(`http://localhost:3100/s/${shareId}`)

  await expect(anonPage.getByText('Общий доступ')).toBeVisible({ timeout: 30_000 })
  await expect(anonPage.getByText('Только просмотр')).toBeVisible()
  await anon.close()
})
