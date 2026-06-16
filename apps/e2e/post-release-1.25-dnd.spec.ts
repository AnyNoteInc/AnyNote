import { expect, test, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

/**
 * Post-release 1.25 regressions for sidebar drag-and-drop (bugs #1 + #6):
 *
 *  #1 — dropping a page into / within the Личное/Команда sidebar tree must sort
 *       it to the EXACT dropped position (not always the head).
 *  #6 — the move must be OPTIMISTIC with no blink: the dragged row lands in
 *       place instantly and never vanishes-then-reappears; it only rolls back on
 *       a real server error.
 *
 * Like the rest of the post-release E2E, this runs against `next dev` with no
 * Hocuspocus server; it exercises only tRPC/sidebar behavior, never editor Yjs.
 *
 * dnd-kit uses a PointerSensor with `activationConstraint: { distance: 8 }`, so
 * Playwright's `dragTo` does not reliably trip it — we drive manual mouse steps
 * that exceed the 8px activation distance.
 */

async function createWorkspace(page: Page, name = 'DnD 1.25'): Promise<void> {
  await page.getByRole('textbox', { name: 'Название' }).fill(name)
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/(pages|chats)\//, { timeout: 30_000 })
}

/**
 * Create one root TEXT page from a section's «Новая страница» header button, then
 * wait for the new /pages/<id> route + editor. Returns the new page id parsed
 * from the URL so order can be asserted by the row's `data-page-row` attribute
 * (which carries the page id).
 *
 * The sidebar renders one «Новая страница» button per section, in source order:
 * index 0 = «Команда» (creates a TEAM page), index 1 = «Личное» (creates a
 * PERSONAL page). Defaults to the Команда button.
 */
async function createTextPage(page: Page, sectionButtonIndex = 0): Promise<string> {
  const previousUrl = page.url()
  await page.getByRole('button', { name: 'Новая страница' }).nth(sectionButtonIndex).click()
  await page.getByRole('button', { name: 'Создать страницу: Текст' }).click()
  await page.waitForURL(
    (url) => /\/pages\/[a-f0-9-]+/.test(url.toString()) && url.toString() !== previousUrl,
    { timeout: 30_000 },
  )
  await expect(page.locator('.anynote-editor .ProseMirror')).toBeVisible({ timeout: 30_000 })
  const match = /\/pages\/([a-f0-9-]+)/.exec(page.url())
  if (!match) throw new Error('could not parse page id from URL')
  return match[1]
}

/**
 * Drag the source row onto the target row using manual mouse steps that exceed
 * dnd-kit's 8px activation distance, with intermediate moves so the sensor and
 * the collision detection both engage.
 */
async function dragRowOnto(page: Page, sourceId: string, targetId: string): Promise<void> {
  const source = page.locator(`[data-page-row="${sourceId}"]`).first()
  const target = page.locator(`[data-page-row="${targetId}"]`).first()
  const sb = await source.boundingBox()
  const tb = await target.boundingBox()
  if (!sb || !tb) throw new Error('row not found')
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2)
  await page.mouse.down()
  // Exceed the 8px activation distance in steps to trip the PointerSensor.
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2 + 12, { steps: 3 })
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 })
  await page.mouse.up()
}

/** The page ids, in DOM order, of the rows currently rendered in the sidebar. */
async function rowOrder(page: Page): Promise<string[]> {
  return page
    .locator('[data-page-row]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-page-row') ?? ''))
}

/**
 * The persisted root-page order of a workspace, in `prevPageId` linked-list
 * order, scoped to one collection by `kind` and filtered to a known set of ids.
 *
 * Why this reads the DB instead of the DOM: root pages of a workspace form ONE
 * `prevPageId` chain across collections (`createPageTx` tail-inserts scoped by
 * (workspaceId, parentId), NOT by collectionId), and the seeded «Добро
 * пожаловать» page is the chain head and lives in the TEAM collection. The
 * sidebar filters each section to its own collection, so the Личное subtree's
 * head links to a TEAM page that is filtered out — `orderSiblings` then can't
 * root the chain and falls back to createdAt order, hiding the spliced position
 * in the render. The splice IS persisted correctly, so the dropped position is
 * asserted here against the stored linked list (the layer Task 5 fixes), walking
 * the global chain and keeping only the requested collection's pages.
 */
async function persistedRootOrder(
  workspaceName: string,
  kind: 'TEAM' | 'PERSONAL',
  onlyIds: string[],
): Promise<string[]> {
  const { prisma } = await import('../../packages/db/src/index')
  const workspace = await prisma.workspace.findFirst({
    where: { name: workspaceName },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (!workspace) throw new Error(`workspace ${workspaceName} not found`)
  const collection = await prisma.collection.findFirst({
    where: { workspaceId: workspace.id, kind },
    select: { id: true },
  })
  const rootPages = await prisma.page.findMany({
    where: { workspaceId: workspace.id, parentId: null, deletedAt: null },
    select: { id: true, prevPageId: true, collectionId: true },
  })
  // Walk the global root chain from the head (prevPageId === null).
  const byPrev = new Map<string | null, (typeof rootPages)[number]>()
  for (const p of rootPages) byPrev.set(p.prevPageId, p)
  const chain: string[] = []
  let cursor: string | null = null
  const seen = new Set<string>()
  while (byPrev.has(cursor)) {
    const next = byPrev.get(cursor)!
    if (seen.has(next.id)) break
    seen.add(next.id)
    if (next.collectionId === collection?.id) chain.push(next.id)
    cursor = next.id
  }
  const wanted = new Set(onlyIds)
  return chain.filter((id) => wanted.has(id))
}

test('drag within Личное/Команда sorts to the dropped position with no disappearance', async ({
  page,
}) => {
  const email = `dnd-1-25-${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password: 'Test12345!' })
  await createWorkspace(page)

  // Reveal the page sidebar (the «Домашняя» tab).
  await page.getByRole('button', { name: 'Домашняя', exact: true }).click()

  // Two root TEXT pages land in the same section (the first «Новая страница»
  // button creates in Команда). Created in order A then B, so by createdAt the
  // initial DOM order is A, B.
  const idA = await createTextPage(page)
  const idB = await createTextPage(page)

  // Both rows are present in the sidebar.
  const rowA = page.locator(`[data-page-row="${idA}"]`).first()
  const rowB = page.locator(`[data-page-row="${idB}"]`).first()
  await expect(rowA).toBeVisible()
  await expect(rowB).toBeVisible()

  const before = await rowOrder(page)
  expect(before).toContain(idA)
  expect(before).toContain(idB)
  // Sanity: A is before B initially (ordered by createdAt).
  expect(before.indexOf(idA)).toBeLessThan(before.indexOf(idB))
  const countBefore = before.length

  // #1 — drag B onto A: B must sort to A's position (B now before A).
  await dragRowOnto(page, idB, idA)

  // #6 — no disappearance: the dragged row stays present immediately after drop
  // (optimistic; a vanish-then-reappear regression would show a transient
  // absence). Because the success handler does NOT refetch, the optimistic
  // state is authoritative and the row never drops out.
  await expect(rowB).toBeVisible({ timeout: 1_000 })
  await expect(rowA).toBeVisible({ timeout: 1_000 })

  // No page was lost in the move.
  await expect.poll(async () => (await rowOrder(page)).length, { timeout: 5_000 }).toBe(countBefore)

  // #1 — order flipped: B is now before A.
  await expect
    .poll(
      async () => {
        const order = await rowOrder(page)
        return order.indexOf(idB) < order.indexOf(idA)
      },
      { timeout: 5_000 },
    )
    .toBe(true)
})

test('dragging a Команда page into Личное moves it there and sorts to the dropped position', async ({
  page,
}) => {
  const email = `dnd-1-25-cross-${Date.now()}@example.com`
  // Unique workspace name so the storage-order read below resolves THIS test's
  // workspace on the shared dev Postgres.
  const workspaceName = `DnD 1.25 cross ${Date.now()}`
  await signUpAndAuthAs(page, { email, password: 'Test12345!' })
  await createWorkspace(page, workspaceName)

  // Reveal the page sidebar (the «Домашняя» tab).
  await page.getByRole('button', { name: 'Домашняя', exact: true }).click()

  // M lives in Команда (section button 0); P1 + P2 live in Личное (button 1).
  // This is the cross-section setup that exercises `moveIntoHandler` (onDragEnd
  // branch 2), NOT the intra-section `reorderHandler` the first test covers.
  const idM = await createTextPage(page, 0)
  const idP1 = await createTextPage(page, 1)
  const idP2 = await createTextPage(page, 1)

  const mRowInTeam = page.locator(`[data-page-section="team"] [data-page-row="${idM}"]`)
  const mRowInPrivate = page.locator(`[data-page-section="private"] [data-page-row="${idM}"]`)
  const p1RowInPrivate = page.locator(`[data-page-section="private"] [data-page-row="${idP1}"]`)

  // Initial state: M is in Команда (1 row there, 0 under Личное); P1 + P2 are in
  // Личное.
  await expect(mRowInTeam).toHaveCount(1)
  await expect(mRowInPrivate).toHaveCount(0)
  await expect(p1RowInPrivate).toHaveCount(1)
  await expect(page.locator(`[data-page-section="private"] [data-page-row="${idP2}"]`)).toHaveCount(
    1,
  )
  // The persisted Личное order starts as [P1, P2].
  expect(await persistedRootOrder(workspaceName, 'PERSONAL', [idM, idP1, idP2])).toEqual([
    idP1,
    idP2,
  ])

  // Cross-section drag: M (Команда) dropped ONTO P1 (the first Личное row).
  // `moveIntoHandler` inserts a cross-collection drop AFTER the hovered row.
  await dragRowOnto(page, idM, idP1)

  // (c) #6 — no blink on the CROSS-section path: M's row must be present under
  // Личное IMMEDIATELY after the drop. The success handler deliberately does NOT
  // refetch (the optimistic splice is authoritative), so the moved row never
  // vanishes-then-reappears. A TIGHT 1s bound — not a 5s poll — would catch a
  // transient disappearance; a 5s poll would mask a blink.
  await expect(mRowInPrivate).toBeVisible({ timeout: 1_000 })

  // (a) #1 core — the cross-section MOVE landed: M is now under Личное and gone
  // from Команда.
  await expect.poll(async () => mRowInPrivate.count(), { timeout: 5_000 }).toBe(1)
  await expect.poll(async () => mRowInTeam.count(), { timeout: 5_000 }).toBe(0)

  // (b) #1 position — M sorted to the drop point. Dropped ONTO P1 → spliced AFTER
  // P1 and before P2, so the persisted Личное order is [P1, M, P2]; no page is
  // lost. This is asserted against the stored linked list rather than the
  // rendered row order — see `persistedRootOrder` for why the sidebar render
  // can't expose the spliced position of the personal collection.
  await expect
    .poll(async () => persistedRootOrder(workspaceName, 'PERSONAL', [idM, idP1, idP2]), {
      timeout: 5_000,
    })
    .toEqual([idP1, idM, idP2])
})
