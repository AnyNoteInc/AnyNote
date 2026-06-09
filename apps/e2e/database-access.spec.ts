import { expect, test } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

/*
 * Database ACCESS RULES + STRUCTURE LOCK end-to-end (Phase 4C).
 *
 * Scope (deliberate): this spec covers the SINGLE-USER-reliable UI surfaces of
 * the cl4C "Доступ и права" dialog — the page-level access-rule CRUD panel and
 * the structure-lock toggle — and proves each round-trips through Postgres
 * (tRPC), not just the client cache.
 *
 * What is NOT here, and why:
 *   - The AUTHORITATIVE restricted-row-visibility enforcement (a 2-user flow:
 *     an owner + a restricted member, where the member's `listRows` hides
 *     unassigned rows and their `updateCellValue` on a hidden row is FORBIDDEN)
 *     is fully proven at the tRPC level in
 *     `packages/trpc/test/database-access.test.ts`. The RELATION-PICKER LEAK FIX
 *     (`listLinkableRows` must not surface target rows the viewer can't access)
 *     is proven there too. A 2nd authenticated workspace member is heavy and
 *     flaky in E2E, and would only re-assert what that test already pins, so we
 *     do not attempt it here.
 *   - The "+ Свойство" add-property button DISABLED-when-locked affordance is
 *     visible only to a viewer who is NOT a workspace OWNER/ADMIN (the page
 *     creator-as-plain-member, or a plain EDITOR). The domain computes
 *     `canEditStructure = isOwnerAdmin || (isCreator && !structureLocked)`
 *     (database.service.ts `getMyAccess`), so for the OWNER — which the lone
 *     signed-up user always is in their own workspace — `canEditStructure`
 *     stays TRUE even while locked, and the button stays ENABLED. The
 *     server-side gate (a locked source rejects a member's `createProperty`)
 *     is proven in the tRPC test. Here we assert the OWNER-correct behavior: the
 *     button stays enabled when locked (the OWNER override), and the lock STATE
 *     itself persists across a reload — which is the honest single-user proxy
 *     for "the lock flag round-tripped server-side".
 *
 * No-yjs constraint: the Playwright `webServer` is just `next dev` on port 3100
 * — there is NO Hocuspocus (yjs) server. Every assertion below targets
 * tRPC-backed state only:
 *   - access rules persist via `database.createAccessRule` /
 *     `updateAccessRule` / `deleteAccessRule` and are read by
 *     `database.listAccessRules`;
 *   - the structure lock persists via `database.setStructureLocked` and is read
 *     back through `database.getByPage().myAccess.structureLocked`.
 * Where it proves persistence we `page.reload()` — a fresh mount re-runs
 * `getByPage` + `listAccessRules`, so a value surviving a reload PROVES it
 * round-tripped through Postgres (it would be lost if it were client-only).
 *
 * The seeded DATABASE page (domain `seedDefaults`) provides: a TABLE view
 * «Таблица», a system Title column «Название», and a STATUS property «Статус».
 */

/**
 * Create the first workspace, then a DATABASE page via the redesigned sidebar
 * create flow. Adapted from `database-rich.spec.ts`. Returns the new page id.
 */
async function createWorkspaceAndDatabasePage(
  page: import('@playwright/test').Page,
  workspaceName: string,
): Promise<string> {
  await page.getByRole('textbox', { name: 'Название' }).fill(workspaceName)
  const createWsButton = page.getByRole('button', { name: 'Создать пространство' })
  await expect(createWsButton).toBeEnabled({ timeout: 20_000 })
  await createWsButton.click()
  await page.waitForURL(/\/(pages|chats)\//, { timeout: 30_000 })

  const startUrl = page.url()
  await page.getByRole('button', { name: 'Новая страница' }).first().click()
  await page.getByRole('button', { name: 'Создать страницу: База данных' }).click()
  await page.waitForURL((url) => /\/pages\/[a-f0-9-]+/.test(url.href) && url.href !== startUrl, {
    timeout: 15_000,
  })
  await expect(page.getByRole('columnheader', { name: 'Название' })).toBeVisible({
    timeout: 20_000,
  })

  const pageId = /\/pages\/([a-f0-9-]+)/.exec(page.url())?.[1]
  if (!pageId) throw new Error(`createWorkspaceAndDatabasePage: no page id in URL ${page.url()}`)
  return pageId
}

/** Open the «+ Свойство» menu and create a property of the given menu label. */
async function addProperty(
  page: import('@playwright/test').Page,
  menuLabel: string,
): Promise<void> {
  await page.getByRole('button', { name: 'Свойство', exact: true }).click()
  await page.getByRole('menuitem', { name: menuLabel, exact: true }).click()
}

/** Open the «Доступ и права» dialog from the toolbar (the SecurityIcon button). */
async function openAccessDialog(
  page: import('@playwright/test').Page,
): Promise<import('@playwright/test').Locator> {
  await page.getByRole('button', { name: 'Доступ и права' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Доступ и права' })).toBeVisible({
    timeout: 15_000,
  })
  return dialog
}

/**
 * The two `role="switch"` toggles in the «Доступ и права» dialog, by position.
 *
 * The rendered MUI Switch input is `role="switch"` with NO `aria-label` on the
 * input itself (verified via the live DOM: the «Заблокировать структуру» /
 * «Включено» text lives on a wrapping FormControlLabel `<label>` / Tooltip span,
 * not the input), so name-based role queries miss it. The dialog lays the
 * STRUCTURE section (the lock toggle) out ABOVE the rules panel, so the lock
 * switch is always index 0 and the (single) access rule's "enabled" switch is
 * always index 1. This is deterministic for this dialog. Each helper FIRST asserts
 * the expected switch count so an unexpected DOM change fails loudly here rather
 * than silently selecting the wrong toggle.
 */
async function lockSwitch(
  dialog: import('@playwright/test').Locator,
): Promise<import('@playwright/test').Locator> {
  // Only the lock switch is present until a rule exists; once a rule is added
  // there are two — the lock is always the first (Структура section renders first).
  await expect(dialog.getByRole('switch').first()).toBeVisible({ timeout: 15_000 })
  return dialog.getByRole('switch').first()
}

async function ruleEnabledSwitch(
  dialog: import('@playwright/test').Locator,
): Promise<import('@playwright/test').Locator> {
  // The lock switch (index 0) + the rule's enabled switch (index 1) — assert both
  // are present so we never mistake the lock for the rule toggle.
  await expect(dialog.getByRole('switch')).toHaveCount(2, { timeout: 15_000 })
  return dialog.getByRole('switch').nth(1)
}

test('database access: rules panel CRUD + structure-lock persistence', async ({ page }) => {
  test.setTimeout(180_000)
  const email = `db-access+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Доступ' })

  const pageId = await createWorkspaceAndDatabasePage(page, 'DB Access WS')

  // The seeded TABLE view + Title + STATUS «Статус» column are present.
  await expect(page.getByRole('tab', { name: /Таблица/ })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: /Статус/ })).toBeVisible()

  // A PERSON property is the rule TARGET (the resolver matches a viewer's userId
  // against the person cell). Add «Участник» so the access panel has a property
  // to attach a rule to.
  await addProperty(page, 'Участник')
  await expect(page.getByRole('columnheader', { name: /Участник/ })).toBeVisible({
    timeout: 15_000,
  })

  // ===================== ACCESS RULE: CREATE + appears =====================
  // Open «Доступ и права» from the toolbar. The dialog hosts the structure-lock
  // toggle + the page-access rules panel. Pick the «Участник» property, level
  // «Просмотр» (CAN_VIEW), and click «Добавить» → `createAccessRule` persists a
  // row and `listAccessRules` re-fetches it.
  let dialog = await openAccessDialog(page)

  // Before adding, the panel shows its empty-state copy.
  await expect(dialog.getByText('Правил доступа пока нет.', { exact: false })).toBeVisible({
    timeout: 15_000,
  })

  // The "add rule" controls: a «Свойство» Select (PERSON/CREATED_BY only), a
  // «Уровень» Select (defaults to «Просмотр»/CAN_VIEW), and an «Добавить» button.
  await dialog.getByLabel('Свойство').click()
  await page.getByRole('option', { name: 'Участник', exact: true }).click()
  // The level Select already defaults to «Просмотр» (CAN_VIEW); add the rule.
  await dialog.getByRole('button', { name: 'Добавить', exact: true }).click()

  // The new rule renders as a row: the target property name «Участник» + a level
  // Select (aria-label «Уровень доступа») + an enabled Switch + a delete button.
  // The empty-state copy is gone; the property-name row is present.
  await expect(dialog.getByText('Правил доступа пока нет.', { exact: false })).toHaveCount(0, {
    timeout: 15_000,
  })
  const ruleLevelSelect = dialog.getByLabel('Уровень доступа')
  await expect(ruleLevelSelect).toBeVisible({ timeout: 15_000 })
  // The level reads «Просмотр» (the CAN_VIEW label we created it with).
  await expect(ruleLevelSelect).toContainText('Просмотр')
  // The rule row names its target property «Участник».
  await expect(dialog.getByText('Участник', { exact: true }).first()).toBeVisible()

  // ===================== ACCESS RULE: toggle enabled off → on =====================
  // The rule's "enabled" Switch maps to `updateAccessRule({enabled})`. It is
  // checked on create; toggle it off, then back on — both round-trip through
  // `updateAccessRule` and the Switch reflects the persisted state.
  //
  // Locator note: the rendered MUI Switch input is `role="switch"` with NO
  // aria-label on the input (the label/Tooltip text lives on wrapper elements, not
  // the input — verified via the live DOM), so name-based role queries miss it. The
  // `ruleEnabledSwitch` helper scopes to the rule row instead. See its definition.
  //
  // Interaction note: the Switch is CONTROLLED by `rule.enabled` (driven by the
  // `listAccessRules` query), so it only flips AFTER `updateAccessRule` resolves
  // and the query re-fetches — there is no optimistic local toggle. So we `.click()`
  // (which does not assert an instantaneous state change, unlike `.check()`/
  // `.uncheck()`) and then await the eventual, server-confirmed state.
  const enabledSwitch = await ruleEnabledSwitch(dialog)
  await expect(enabledSwitch).toBeChecked()
  await enabledSwitch.click()
  await expect(enabledSwitch).not.toBeChecked({ timeout: 15_000 })
  await enabledSwitch.click()
  await expect(enabledSwitch).toBeChecked({ timeout: 15_000 })

  // ===================== ACCESS RULE: persists across reload =====================
  // Close the dialog, reload — a fresh mount re-runs `listAccessRules`. The rule
  // is still there (it lives in `database_page_access_rules`, a real table), so
  // a value surviving the reload PROVES it round-tripped through Postgres.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 })

  await page.reload()
  await expect(page.getByRole('columnheader', { name: 'Название' })).toBeVisible({
    timeout: 20_000,
  })
  dialog = await openAccessDialog(page)
  await expect(dialog.getByLabel('Уровень доступа')).toBeVisible({ timeout: 15_000 })
  await expect(dialog.getByLabel('Уровень доступа')).toContainText('Просмотр')
  await expect(dialog.getByText('Участник', { exact: true }).first()).toBeVisible()

  // ===================== ACCESS RULE: delete → gone =====================
  // The delete button (aria-label «Удалить правило») maps to
  // `deleteAccessRule`; on success `listAccessRules` re-fetches empty and the
  // panel returns to its empty-state copy.
  await dialog.getByRole('button', { name: 'Удалить правило' }).click()
  await expect(dialog.getByText('Правил доступа пока нет.', { exact: false })).toBeVisible({
    timeout: 15_000,
  })
  await expect(dialog.getByLabel('Уровень доступа')).toHaveCount(0)

  // ===================== STRUCTURE LOCK: toggle ON + persist =====================
  // The «Заблокировать структуру» Switch maps to `setStructureLocked`. As the
  // workspace OWNER, `canEditStructure` stays TRUE even when locked (the OWNER
  // override — see the header comment), so the toggle stays usable and the
  // «+ Свойство» button stays ENABLED. The honest single-user proof here is that
  // the lock STATE persists server-side: it is read back through
  // `getByPage().myAccess.structureLocked` on a fresh mount.
  // Like the rule switch, the lock Switch is CONTROLLED (by
  // `myAccess.structureLocked` from `getByPage`) and flips only after
  // `setStructureLocked` resolves, so we `.click()` and await the eventual state.
  let lock = await lockSwitch(dialog)
  await expect(lock).not.toBeChecked()
  await lock.click()
  await expect(lock).toBeChecked({ timeout: 15_000 })

  // The OWNER's «+ Свойство» button stays ENABLED while locked (the OWNER
  // override). This documents that the disabled-when-locked affordance targets
  // NON-owner viewers; the server-side gate (a member's `createProperty` on a
  // locked source is rejected) is proven in the tRPC database-access test.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'Свойство', exact: true })).toBeEnabled()

  // Reload → the lock flag re-resolves from Postgres via
  // `getByPage().myAccess.structureLocked`. The toggle is still ON, proving
  // `setStructureLocked(true)` round-tripped (it would reset to false if it were
  // client-only).
  await page.reload()
  await expect(page.getByRole('columnheader', { name: 'Название' })).toBeVisible({
    timeout: 20_000,
  })
  dialog = await openAccessDialog(page)
  lock = await lockSwitch(dialog)
  await expect(lock).toBeChecked({ timeout: 15_000 })

  // ===================== STRUCTURE LOCK: toggle OFF + persist =====================
  // Flip it back off → `setStructureLocked(false)`. Reload → the toggle is
  // unchecked again, proving the unlock also round-tripped through Postgres.
  await lock.click()
  await expect(lock).not.toBeChecked({ timeout: 15_000 })

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 })
  await page.reload()
  await expect(page.getByRole('columnheader', { name: 'Название' })).toBeVisible({
    timeout: 20_000,
  })
  dialog = await openAccessDialog(page)
  lock = await lockSwitch(dialog)
  await expect(lock).not.toBeChecked({ timeout: 15_000 })

  // Sanity: the page exists (the whole flow ran against a real DATABASE page).
  expect(pageId).toBeTruthy()
})
