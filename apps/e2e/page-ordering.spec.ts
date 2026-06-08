import { expect, test, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

async function createWorkspace(page: Page) {
  await page.getByRole('textbox', { name: 'Название' }).fill('Ordering WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/chats/, { timeout: 30_000 })
}

async function openPagesSection(page: Page) {
  // Click the sidebar nav button (exact match to avoid colliding with the
  // page-actions toolbar's "Действия страницы" button which contains
  // "Страницы" as a substring).
  await page.getByRole('button', { name: 'Страницы', exact: true }).click()
  // PageTreeSection's "Новая страница" header IconButton appears once the
  // pages section is mounted.
  await expect(page.getByRole('button', { name: 'Новая страница' })).toBeVisible({
    timeout: 15_000,
  })
}

/**
 * Creates a TEXT page from the PageTreeSection's "Новая страница" header
 * button (root-level). Returns the new pageId from the URL.
 */
async function createRootTextPage(page: Page): Promise<string> {
  const previousUrl = page.url()
  await page.getByRole('button', { name: 'Новая страница' }).first().click()
  await page.getByRole('button', { name: 'Создать страницу: Текст' }).click()
  await page.waitForURL(
    (url) =>
      /\/pages\/[a-f0-9-]+/.test(url.toString()) &&
      url.toString() !== previousUrl,
    { timeout: 20_000 },
  )
  await expect(page.locator('.anynote-editor .ProseMirror')).toBeVisible({ timeout: 20_000 })
  const pageId = /\/pages\/([a-f0-9-]+)/.exec(page.url())?.[1]
  if (!pageId) throw new Error('createRootTextPage: failed to extract pageId from URL')
  // Wait for the new row to actually appear in the tree so subsequent
  // assertions don't race with the optimistic list invalidation.
  await expect(page.locator(`[data-page-row="${pageId}"]`)).toBeVisible({ timeout: 10_000 })
  return pageId
}

/**
 * Returns the ordered list of pageIds currently rendered in the main page tree.
 */
async function getPageRowIds(page: Page): Promise<string[]> {
  return await page.locator('[data-page-row]').evaluateAll((rows) =>
    rows
      .map((r) => (r as HTMLElement).dataset.pageRow)
      .filter((id): id is string => !!id),
  )
}

/**
 * Returns the ordered list of pageIds currently rendered in the favorites
 * section. Favorites includes nested descendants; we only want the top-level
 * favorite rows for ordering assertions.
 */
async function getFavoriteRowIds(page: Page, expectedIds: Set<string>): Promise<string[]> {
  const all = await page.locator('[data-fav-row]').evaluateAll((rows) =>
    rows
      .map((r) => (r as HTMLElement).dataset.favRow)
      .filter((id): id is string => !!id),
  )
  // Keep only top-level favorites we created in this test, in render order.
  return all.filter((id) => expectedIds.has(id))
}

/**
 * Drag the row with `sourceId` onto the row with `targetId` so the source
 * lands above the target. Works for both [data-page-row] and [data-fav-row]
 * targets — pass the right rowSelectorAttr.
 *
 * dnd-kit PointerSensor has activationConstraint.distance = 8, so we must
 * move at least 8px after mouse.down() before the drag actually starts.
 */
async function dragRowAbove(
  page: Page,
  sourceId: string,
  targetId: string,
  targetRowAttr: 'data-page-row' | 'data-fav-row',
) {
  // After the drag-handle removal the row itself is the activator
  // (data-drag-handle is mirrored on the row container alongside data-page-row /
  // data-fav-row). Drive the drag from the row's own bounding box.
  const sourceRow = page.locator(`[${targetRowAttr}="${sourceId}"]`)
  const target = page.locator(`[${targetRowAttr}="${targetId}"]`)

  await sourceRow.scrollIntoViewIfNeeded()
  await sourceRow.hover()

  const handleBox = await sourceRow.boundingBox()
  const targetBox = await target.boundingBox()
  if (!handleBox || !targetBox) throw new Error('dragRowAbove: failed to get bounding boxes')

  const startX = handleBox.x + handleBox.width / 2
  const startY = handleBox.y + handleBox.height / 2
  const targetCenterX = targetBox.x + targetBox.width / 2
  const targetCenterY = targetBox.y + targetBox.height / 2

  await page.mouse.move(startX, startY)
  await page.mouse.down()
  // dnd-kit PointerSensor activates only once we've moved more than 8px from
  // the pointerdown point.
  await page.mouse.move(startX + 1, startY + 10, { steps: 5 })
  await page.mouse.move(startX + 2, startY + 20, { steps: 5 })
  // Glide to the target's CENTER. dnd-kit's closestCenter picks the droppable
  // whose center is nearest the pointer; the PageTreeSection / FavoritesSection
  // onDragEnd then computes "before vs after" from the relative indices of
  // active and over (active.idx > over.idx → drop before), so aiming at the
  // center reliably lands the source above the target when dragging upward.
  await page.mouse.move(targetCenterX, targetCenterY, { steps: 14 })
  await page.mouse.up()
}

test.describe('page ordering', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000)
    const email = `ordering+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
    await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Тест' })
    await createWorkspace(page)
    await openPagesSection(page)
  })

  test('new pages are appended to the tail of the sibling list', async ({ page }) => {
    const firstId = await createRootTextPage(page)
    const secondId = await createRootTextPage(page)
    const thirdId = await createRootTextPage(page)

    // workspace.create seeds an initial "start page" so the tree contains it
    // plus our three. We assert ordering of the tail (the pages we created),
    // not the full list.
    await expect
      .poll(async () => (await getPageRowIds(page)).slice(-3))
      .toEqual([firstId, secondId, thirdId])
  })

  test('drag-and-drop reorders pages in the sidebar and persists', async ({ page }) => {
    const firstId = await createRootTextPage(page)
    const secondId = await createRootTextPage(page)

    await expect
      .poll(async () => (await getPageRowIds(page)).slice(-2))
      .toEqual([firstId, secondId])

    await dragRowAbove(page, secondId, firstId, 'data-page-row')

    // Optimistic update is applied immediately.
    await expect
      .poll(async () => (await getPageRowIds(page)).slice(-2), { timeout: 10_000 })
      .toEqual([secondId, firstId])

    // Reload — the new order should still be there (persisted via page.reorder).
    await page.reload()
    await openPagesSection(page)
    await expect
      .poll(async () => (await getPageRowIds(page)).slice(-2), { timeout: 20_000 })
      .toEqual([secondId, firstId])
  })

  test('favorites order is personalized via DnD and persists after reload', async ({ page }) => {
    const firstId = await createRootTextPage(page)
    const secondId = await createRootTextPage(page)

    const expectedSet = new Set([firstId, secondId])

    // Favorite both pages via context menu on each row.
    for (const id of [firstId, secondId]) {
      const row = page.locator(`[data-page-row="${id}"]`)
      await row.scrollIntoViewIfNeeded()
      await row.hover()
      // The page-actions container has exactly two IconButtons in order:
      // [0] = "+" (CreatePageMenu trigger), [1] = "⋯" (PageContextMenu trigger).
      // Don't use row.getByRole('button') here — dnd-kit decorates the drag
      // handle Box with role="button" too, shifting the index.
      await row.locator('.page-actions button').nth(1).click()
      await page.getByRole('menuitem', { name: 'В избранное' }).click()
      // Wait until the favorite row appears in the favorites list.
      await expect(page.locator(`[data-fav-row="${id}"]`).first()).toBeVisible({ timeout: 10_000 })
    }

    // Initial favorites order matches creation order.
    await expect
      .poll(() => getFavoriteRowIds(page, expectedSet))
      .toEqual([firstId, secondId])

    await dragRowAbove(page, secondId, firstId, 'data-fav-row')

    await expect
      .poll(() => getFavoriteRowIds(page, expectedSet), { timeout: 10_000 })
      .toEqual([secondId, firstId])

    // Reload — favorites are persisted via page.reorderFavorites (per-user).
    await page.reload()
    await openPagesSection(page)
    await expect
      .poll(() => getFavoriteRowIds(page, expectedSet), { timeout: 20_000 })
      .toEqual([secondId, firstId])
  })
})
