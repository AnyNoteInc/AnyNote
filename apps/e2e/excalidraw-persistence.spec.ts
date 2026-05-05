import { type Page, expect, test } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

async function setupExcalidrawPage(page: Page) {
  const email = `excal+${Date.now()}@example.com`

  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Тест' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Excal WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+/)

  const pagesHeaderRow = page
    .getByText('Страницы', { exact: true })
    .locator('xpath=ancestor::*[.//button][1]')
  await pagesHeaderRow.getByRole('button').click()
  await page.getByRole('menuitem', { name: 'Холст' }).click()

  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/, { timeout: 15_000 })
  await page.getByTitle(/Rectangle — R or/).waitFor({ state: 'visible', timeout: 15_000 })
}

async function drawRectangle(page: Page) {
  await page.getByTitle(/Rectangle — R or/).click()
  await page.mouse.move(700, 300)
  await page.mouse.down()
  await page.mouse.move(800, 350, { steps: 5 })
  await page.mouse.move(950, 450, { steps: 5 })
  await page.mouse.up()
}

async function readSceneElementCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvases = document.querySelectorAll('canvas')
    let target: HTMLCanvasElement | null = null
    for (const c of canvases) {
      if (Object.keys(c).some((k) => k.startsWith('__reactFiber$'))) {
        target = c
        break
      }
    }
    if (!target) return -1
    const fiberKey = Object.keys(target).find((k) => k.startsWith('__reactFiber$'))
    if (!fiberKey) return -1
    let fiber = (target as unknown as Record<string, unknown>)[fiberKey] as
      | { return: unknown; memoizedProps?: { visibleElements?: unknown[] } }
      | undefined
    if (!fiber) return -1
    fiber = fiber.return as typeof fiber
    return fiber?.memoizedProps?.visibleElements?.length ?? -1
  })
}

test('excalidraw drawing survives page reload', async ({ page }) => {
  await setupExcalidrawPage(page)

  // Initial scene is empty
  await expect.poll(() => readSceneElementCount(page), { timeout: 5_000 }).toBe(0)

  await drawRectangle(page)

  // After drawing, scene has one element
  await expect.poll(() => readSceneElementCount(page), { timeout: 5_000 }).toBe(1)

  // Wait long enough for the Hocuspocus debounce to flush onStoreDocument.
  // Default debounce is 2s; we wait 4s to be safe.
  await page.waitForTimeout(4_000)

  await page.reload()
  await page.getByTitle(/Rectangle — R or/).waitFor({ state: 'visible', timeout: 15_000 })

  // After reload, the rectangle must still be in the scene. Without the fix
  // for the y-excalidraw initial-load race, the binding deletes loaded
  // elements right after mount and the scene drops back to 0.
  await expect.poll(() => readSceneElementCount(page), { timeout: 10_000 }).toBe(1)
})
