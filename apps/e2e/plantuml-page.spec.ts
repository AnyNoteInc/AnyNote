import { type Page, expect, test } from '@playwright/test'
import * as Y from 'yjs'
import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'
const source = '@startuml\nAlice->Bob : Hello\nreturn ok\n@enduml'

async function setupPlantumlPage(page: Page) {
  const email = `plantuml+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Тест' })
  await page.getByRole('textbox', { name: 'Название' }).fill('PlantUML WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/chats/, { timeout: 15_000 })

  await page.getByRole('button', { name: 'Страницы' }).click()
  const createPageButton = page.getByRole('button', { name: 'Новая страница' })
  await expect(createPageButton).toBeVisible()
  await createPageButton.click()
  await page.getByRole('menuitem', { name: 'Диаграмма' }).click()
  await page.getByRole('menuitem', { name: 'PlantUML' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/, { timeout: 15_000 })
  const pageId = /\/pages\/([a-f0-9-]+)/.exec(page.url())?.[1]
  expect(pageId).toBeTruthy()
  return pageId!
}

async function typeIntoMonaco(page: Page, text: string) {
  const editor = page.locator('.monaco-editor').first()
  await editor.waitFor({ state: 'visible', timeout: 20_000 })
  await editor.click()
  await page.keyboard.type(text)
}

test('renders a plantuml diagram from typed source', async ({ page }) => {
  await setupPlantumlPage(page)
  await typeIntoMonaco(page, '@startuml\nAlice->Bob : Hello\nreturn ok\n@enduml')

  const svg = page.locator('[data-testid="plantuml-preview"] svg')
  await expect(svg).toBeVisible({ timeout: 20_000 })
})

test('export SVG control is present once a plantuml diagram renders', async ({ page }) => {
  await setupPlantumlPage(page)
  await typeIntoMonaco(page, '@startuml\nAlice->Bob : Hello\nreturn ok\n@enduml')
  await expect(page.locator('[data-testid="plantuml-preview"] svg')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-testid="plantuml-export-svg"]')).toBeVisible()
})

test('anonymous public share renders a plantuml diagram', async ({ page, browser }) => {
  const pageId = await setupPlantumlPage(page)
  await typeIntoMonaco(page, source)
  await expect(page.locator('[data-testid="plantuml-preview"] svg')).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: 'Поделиться' }).click()
  await expect(page.getByRole('button', { name: 'Копировать ссылку' })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Всем, у кого есть ссылка' }).click()

  loadEnvFromRoot()
  const { prisma } = await import('../../packages/db/src/index')
  const ydoc = new Y.Doc()
  ydoc.getText('plantuml').insert(0, source)
  await prisma.page.update({
    where: { id: pageId },
    data: { contentYjs: Y.encodeStateAsUpdate(ydoc) },
  })

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
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  expect(shareId).toMatch(/^[0-9a-f]{64}$/)

  const anon = await browser.newContext()
  const anonPage = await anon.newPage()
  const renderResponsePromise = anonPage.waitForResponse(
    (response) => response.url().includes('/api/plantuml/render'),
    { timeout: 20_000 },
  )
  await anonPage.goto(`http://localhost:3100/s/${shareId}`)
  await expect(anonPage.getByText('Общий доступ')).toBeVisible({ timeout: 20_000 })
  const renderResponse = await renderResponsePromise
  expect(renderResponse.status()).toBe(200)
  await expect(anonPage.locator('[data-testid="plantuml-preview"] svg')).toBeVisible({
    timeout: 20_000,
  })
  await expect(anonPage.getByText('Unauthorized')).toHaveCount(0)
  await anon.close()
})
