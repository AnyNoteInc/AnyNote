import { expect, test, type Locator, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

/**
 * Phase 9C E2E (plan/spec §9) — synced blocks, asserted IN-SESSION.
 *
 * The Playwright webServer is just `next dev` with NO yjs server, so the LIVE
 * cross-page propagation of a synced block (the whole point — a second
 * `HocuspocusProvider` per instance) is NOT reachable here: a nested
 * collaborative editor cannot sync across two browser contexts without the
 * Hocuspocus server, and editor node state does not survive a reload. Those
 * behaviours are covered by the apps/yjs auth unit suite (Task 2) and the
 * `synced-block-router.test.ts` tRPC integration suite (Task 3, 22 tests).
 *
 * The cross-user «нет доступа» placeholder (a synced block whose origin is a
 * SECOND user's PERSONAL page) is likewise pinned at the tRPC layer
 * (`getById` returns the typed `no_access` result, never leaking content) — it
 * needs no second browser context here, so we do NOT re-assert it via E2E.
 *
 * What this spec asserts deterministically, in one loaded session:
 *  1. `/` → «Синхронизированный блок» → the picker → «Создать новый» inserts a
 *     `syncedBlock` node that renders the boundary chip + the nested editor
 *     surface (no live data, but the node mounts and the chrome appears).
 *  2. The node action menu exposes «Открыть оригинал», «Отсоединить эту копию»,
 *     «Отсоединить все» and «Удалить блок».
 *  3. «Удалить блок» flips the SAME instance to the «удалён» placeholder
 *     (the embed invalidates `getById`, which now returns `deleted`) — a
 *     deterministic placeholder path on an OWN block, no second context needed.
 *
 * NOT asserted here (deliberately): the «Отсоединить эту копию» node-removal
 * transaction. It mutates the host page's collaborative doc, whose authoritative
 * state lives in the (absent) Hocuspocus server — so under `next dev` with no
 * yjs server the page doc the detach reads from is not reliably populated. The
 * detach helper is unit-shaped (a pure `deleteRange`/`insertContentAt`), and the
 * affordance itself is asserted in (2); we keep the E2E to insert + render +
 * menu + the deterministic deleted-placeholder rather than execute the
 * yjs-doc-dependent flow.
 */

const password = 'SuperSecure123!'

test.setTimeout(180_000)

async function signUpAndCreateWorkspace(page: Page, tag: string): Promise<void> {
  const email = `${tag}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Синк', lastName: 'Тестов' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Synced Blocks Test')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/(pages|chats)\//)
}

async function createTextPage(page: Page): Promise<Locator> {
  const previousUrl = page.url()
  await page.getByRole('button', { name: 'Новая страница' }).first().click()
  await page.getByRole('button', { name: 'Создать страницу: Текст' }).click()
  await page.waitForURL(
    (url) => /\/pages\/[a-f0-9-]+/.test(url.toString()) && url.toString() !== previousUrl,
    { timeout: 15_000 },
  )
  const editor = page.locator('.anynote-editor .ProseMirror').first()
  await expect(editor).toBeVisible({ timeout: 15_000 })
  return editor
}

/**
 * Drive the `/synced` slash item → the picker → «Создать новый», which calls
 * `syncedBlock.create` and inserts the returned id as a `syncedBlock` node on
 * THIS (origin) page. Returns the node locator once it renders.
 */
async function insertNewSyncedBlock(page: Page, editor: Locator): Promise<Locator> {
  await editor.click()
  await editor.press('/')
  await page.keyboard.type('синхрон')
  const item = page.locator('[data-slash-item-id="synced-block"]')
  await expect(item).toBeVisible({ timeout: 5_000 })
  await item.click()

  // The picker dialog (create new / insert existing).
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Создать новый' })).toBeVisible({
    timeout: 10_000,
  })
  await dialog.getByRole('button', { name: 'Создать новый' }).click()

  const node = editor.locator('[data-type="synced-block"]').first()
  await expect(node).toBeVisible({ timeout: 15_000 })
  return node
}

test('inserting a new synced block renders the boundary chip and a nested editor surface', async ({
  page,
}) => {
  await signUpAndCreateWorkspace(page, 'synced-create')
  const editor = await createTextPage(page)
  const node = await insertNewSyncedBlock(page, editor)

  // The «синхронизированный блок» boundary chip marks the instance.
  await expect(node.getByText('Синхронизированный блок', { exact: true })).toBeVisible({
    timeout: 10_000,
  })

  // As the OWNER of the origin page the embed mounts the LIVE nested editor
  // surface (it never receives yjs data in E2E, but the container renders —
  // we assert the chrome, not synced content).
  await expect(node.locator('.anynote-synced-block-editor')).toBeVisible({ timeout: 10_000 })
})

test('the synced-block action menu exposes detach-all and delete affordances', async ({ page }) => {
  await signUpAndCreateWorkspace(page, 'synced-menu')
  const editor = await createTextPage(page)
  const node = await insertNewSyncedBlock(page, editor)

  await node.getByRole('button', { name: 'Действия с синхронизированным блоком' }).click()

  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible({ timeout: 5_000 })
  await expect(menu.getByRole('menuitem', { name: 'Открыть оригинал' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Отсоединить эту копию' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Отсоединить все' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Удалить блок' })).toBeVisible()
})

test('«Удалить блок» flips this instance to the «удалён» placeholder in-session', async ({
  page,
}) => {
  await signUpAndCreateWorkspace(page, 'synced-delete')
  const editor = await createTextPage(page)
  const node = await insertNewSyncedBlock(page, editor)

  await node.getByRole('button', { name: 'Действия с синхронизированным блоком' }).click()
  const menu = page.getByRole('menu')
  await menu.getByRole('menuitem', { name: 'Удалить блок' }).click()

  // delete() sets deletedAt and the embed invalidates getById, which now
  // returns the typed `deleted` result → the «удалён» placeholder, without a
  // reload and without a second viewer context. The node chrome stays (it's a
  // local node) but its body becomes the placeholder.
  await expect(node.getByText('Синхронизированный блок удалён')).toBeVisible({ timeout: 10_000 })
  // The live nested editor surface is gone once the block is deleted.
  await expect(node.locator('.anynote-synced-block-editor')).toHaveCount(0)
})
