import { expect, test } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

// Types that have a renderer and can be smoke-opened anonymously with empty content.
// KANBAN is excluded: anonymous kanban share is a future cycle (needs a session).
const TYPES = ['TEXT', 'EXCALIDRAW', 'GENOGRAM', 'MERMAID', 'PLANTUML', 'LIKEC4', 'DRAWIO'] as const

test('each shareable page type renders via a public share link', async ({ page, browser }) => {
  test.setTimeout(180_000)
  const email = `sharetypes+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Тест' })

  await page.getByRole('textbox', { name: 'Название' }).fill('Types WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  // A new workspace seeds a welcome start page, so the redirect lands on
  // /workspaces/{id}/pages/{startPageId} (or /chats/new if there were none).
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/(pages|chats)\//, { timeout: 30_000 })
  const workspaceId = /\/workspaces\/([a-f0-9-]+)\//.exec(page.url())?.[1]
  expect(workspaceId).toBeTruthy()

  loadEnvFromRoot()
  const { prisma } = await import('../../packages/db/src/index')
  const crypto = await import('node:crypto')

  const me = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })

  for (const type of TYPES) {
    const created = await prisma.page.create({
      data: {
        workspaceId: workspaceId!,
        type,
        title: `${type} page`,
        createdById: me.id,
      },
      select: { id: true },
    })
    const shareId = crypto.randomBytes(32).toString('hex')
    await prisma.pageShare.create({
      data: {
        pageId: created.id,
        shareId,
        access: 'PUBLIC',
        linkRole: 'READER',
        createdById: me.id,
      },
    })

    const anon = await browser.newContext()
    const anonPage = await anon.newPage()
    await anonPage.goto(`http://localhost:3100/s/${shareId}`)
    // Share chrome proves the route resolved and the renderer mounted (no 404, no "not supported").
    await expect(anonPage.getByText('Общий доступ')).toBeVisible({ timeout: 30_000 })
    await expect(anonPage.getByText(/пока не поддерживается/)).toHaveCount(0)
    await anon.close()
  }
})
