import { createHash } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'
const WORKSPACE_NAME = 'Безопасность WS'

/**
 * Security-policy E2E (8C spec §8): four flows in one serial journey — the
 * public-link kill-switch (honest «отключён администратором» state, reversible),
 * the export block (server-side 403 naming the policy), the guest-invite
 * request workflow (member request → owner queue → approve → real invite), and
 * the OWNER-only audited admin content search (ack gate, private-page find,
 * verbatim-query audit row).
 *
 * Plan gating: the security section itself is OWNER-only but NOT plan-gated
 * (spec §6). The paid fixture below exists for OTHER reasons: flow 3 needs a
 * second member seat (invitation ACCEPTANCE re-checks the WorkspaceLimit row,
 * synced at creation from the personal plan: maxMembers=1) and the «Участники»
 * section that carries the request badge is `membersSettingsEnabled`-gated.
 * So we reuse the people/identity technique — repoint the owner's ACTIVE
 * subscription at the seeded 'pro' plan and bump THIS workspace's limit row.
 *
 * Member invitations are token-HASHED at rest, so flow 3 inserts the
 * WorkspaceInvitation row directly via Prisma with a KNOWN plaintext and
 * drives `/invite/{plaintext}` (people.spec.ts precedent).
 *
 * The shared dev Postgres means every fixture is captured/restored in afterAll
 * (kept in a try/finally so $disconnect can never skip it). Registries are
 * ARRAYS: with --retries each attempt creates fresh rows and all of them must
 * be cleaned, not just the last attempt's.
 */

test.setTimeout(420_000)

let prisma: typeof import('../../packages/db/src/index').prisma

// ── fixture registries (restored/deleted in afterAll, even on failure) ───────
const subscriptionFixes: { id: string; originalPlanId: string }[] = []
const createdSubscriptionIds: string[] = []
const limitFixes: {
  workspaceId: string
  existed: boolean
  maxMembers: number
  maxFileBytes: bigint
  sourcePlanSlug: string | null
}[] = []
// One id per attempt: policy row, guest requests, approve-created guest
// invites, request notifications, and this run's audit rows are all scoped to
// the throwaway workspace and dropped wholesale.
const securityWorkspaceIds: string[] = []
const insertedInvitationHashes: string[] = []
const createdPageIds: string[] = []

function sha256(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** base62-only, unique per attempt — tokenHash columns are UNIQUE in the shared DB. */
function makeToken(label: string): string {
  return `E2ESecurity${label}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.replaceAll(
    /[^A-Za-z0-9]/g,
    '',
  )
}

function uniqueRun(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function uniqueEmail(slug: string): string {
  return `${slug}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
}

test.beforeAll(async () => {
  loadEnvFromRoot()
  const db = await import('../../packages/db/src/index')
  prisma = db.prisma
})

test.afterAll(async () => {
  if (!prisma) return
  try {
    for (const workspaceId of securityWorkspaceIds) {
      // The whole workspace is a run-unique throwaway, so workspace-scoped
      // deletes are fixture-scoped. Catch-swallowed: cleanup must never fail
      // the suite (rows may not exist when an attempt died early).
      await prisma.pageGuestInvite.deleteMany({ where: { workspaceId } }).catch(() => {})
      await prisma.pageGuestInviteRequest.deleteMany({ where: { workspaceId } }).catch(() => {})
      await prisma.workspaceSecurityPolicy.deleteMany({ where: { workspaceId } }).catch(() => {})
      await prisma.notificationEvent
        .deleteMany({ where: { workspaceId, type: 'GUEST_INVITE_REQUESTED' } })
        .catch(() => {})
      // Security audit rows are append-only product data, but the workspace is
      // a test fixture — drop this run's security/search/guest actions
      // (approve also writes the people-side `guest.invited`).
      await prisma.workspaceAuditLog
        .deleteMany({
          where: {
            workspaceId,
            OR: [
              { action: { startsWith: 'security.' } },
              { action: { startsWith: 'content_search.' } },
              { action: { startsWith: 'guest_request.' } },
              { action: { startsWith: 'guest.' } },
            ],
          },
        })
        .catch(() => {})
    }
    if (insertedInvitationHashes.length > 0) {
      await prisma.workspaceInvitation.deleteMany({
        where: { tokenHash: { in: insertedInvitationHashes } },
      })
    }
    if (createdPageIds.length > 0) {
      // The marker page is prisma-created (never via the UI) — drop it so the
      // shared dev DB doesn't accumulate orphans (shares cascade with it).
      await prisma.page.deleteMany({ where: { id: { in: createdPageIds } } }).catch(() => {})
    }
    for (const limitFix of limitFixes) {
      if (limitFix.existed) {
        await prisma.workspaceLimit.update({
          where: { workspaceId: limitFix.workspaceId },
          data: {
            maxMembers: limitFix.maxMembers,
            maxFileBytes: limitFix.maxFileBytes,
            sourcePlanSlug: limitFix.sourcePlanSlug,
          },
        })
      } else {
        await prisma.workspaceLimit.deleteMany({ where: { workspaceId: limitFix.workspaceId } })
      }
    }
    for (const subscriptionFix of subscriptionFixes) {
      await prisma.subscription.update({
        where: { id: subscriptionFix.id },
        data: { planId: subscriptionFix.originalPlanId },
      })
    }
    if (createdSubscriptionIds.length > 0) {
      await prisma.subscription.deleteMany({ where: { id: { in: createdSubscriptionIds } } })
    }
  } finally {
    await prisma.$disconnect()
  }
})

async function signUpAndCreateWorkspace(
  page: Page,
  email: string,
  names: { firstName: string; lastName: string },
): Promise<void> {
  await signUpAndAuthAs(page, { email, password, ...names })

  // After sign-up the user lands on the workspace-creation form. On a cold dev
  // server hydration can lag behind the first fill() — re-fill until React
  // registers the value (webhooks.spec.ts pattern).
  const nameInput = page.getByRole('textbox', { name: 'Название' })
  const createButton = page.getByRole('button', { name: 'Создать пространство' })
  await expect(async () => {
    await nameInput.fill(WORKSPACE_NAME)
    await expect(createButton).toBeEnabled({ timeout: 2_000 })
  }).toPass({ timeout: 60_000 })
  await createButton.click()
  await page.waitForURL(/\/(pages|chats)\//, { timeout: 30_000 })
}

/**
 * Create a fresh TEXT page via the sidebar's first «Новая страница» button
 * (the «Команда» section comes first) and return its id (page-sharing.spec
 * pattern). Works for the owner and for an EDITOR member alike.
 */
async function createTextPage(page: Page): Promise<string> {
  const startUrl = page.url()
  await page.getByRole('button', { name: 'Новая страница' }).first().click()
  await page.getByRole('button', { name: 'Создать страницу: Текст' }).click()
  await page.waitForURL((url) => /\/pages\/[a-f0-9-]+/.test(url.href) && url.href !== startUrl, {
    timeout: 30_000,
  })
  await expect(page.locator('.anynote-editor .ProseMirror')).toBeVisible({ timeout: 45_000 })
  const pageId = /\/pages\/([a-f0-9-]+)/.exec(page.url())?.[1]
  expect(pageId).toBeTruthy()
  return pageId!
}

/** Settings live in a full-screen dialog opened from the space menu. */
async function openSettingsSection(page: Page, section: string) {
  await page.locator('aside').getByText(WORKSPACE_NAME, { exact: true }).click()
  await page.getByRole('button', { name: 'Настройки' }).click()
  const dialog = page.getByRole('dialog')
  const nav = dialog.getByRole('button', { name: section, exact: true })
  await expect(nav).toBeVisible({ timeout: 30_000 })
  await nav.click()
  await expect(nav).toHaveAttribute('aria-current', 'page')
  return dialog
}

/**
 * A policy switch by its FormControlLabel text. The rendered MUI Switch input
 * is `role="switch"` (database-access.spec precedent) and carries the label as
 * its accessible name. Server-confirmed (no optimistic toggle): click, then
 * await the state.
 */
function policySwitch(page: Page, label: string) {
  return page.getByRole('switch', { name: label })
}

test('security policies: link kill-switch, export block, guest requests, admin search', async ({
  browser,
}) => {
  const run = uniqueRun()

  // ════ Owner (A): sign up, create workspace, become paid ════════════════════
  const ctxA = await browser.newContext()
  const a = await ctxA.newPage()
  const emailA = `security-owner-${run}@example.com`
  await signUpAndCreateWorkspace(a, emailA, { firstName: 'Ольга', lastName: 'Владелец' })

  const userA = await prisma.user.findUniqueOrThrow({
    where: { email: emailA },
    select: { id: true },
  })
  const workspace = await prisma.workspace.findFirstOrThrow({
    where: { createdById: userA.id },
    select: { id: true },
  })
  securityWorkspaceIds.push(workspace.id)

  // Paid-workspace fixture (people.spec.ts technique) — see the header comment
  // for WHY (member seat + «Участники» badge), not for the security section.
  const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
  const activeSub = await prisma.subscription.findFirst({
    where: { userId: userA.id, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, planId: true },
  })
  if (activeSub) {
    subscriptionFixes.push({ id: activeSub.id, originalPlanId: activeSub.planId })
    await prisma.subscription.update({ where: { id: activeSub.id }, data: { planId: pro.id } })
  } else {
    const created = await prisma.subscription.create({
      data: { userId: userA.id, planId: pro.id, status: 'ACTIVE' },
      select: { id: true },
    })
    createdSubscriptionIds.push(created.id)
  }
  const existingLimit = await prisma.workspaceLimit.findUnique({
    where: { workspaceId: workspace.id },
  })
  limitFixes.push(
    existingLimit
      ? {
          workspaceId: workspace.id,
          existed: true,
          maxMembers: existingLimit.maxMembers,
          maxFileBytes: existingLimit.maxFileBytes,
          sourcePlanSlug: existingLimit.sourcePlanSlug,
        }
      : {
          workspaceId: workspace.id,
          existed: false,
          maxMembers: 0,
          maxFileBytes: 0n,
          sourcePlanSlug: null,
        },
  )
  await prisma.workspaceLimit.upsert({
    where: { workspaceId: workspace.id },
    create: {
      workspaceId: workspace.id,
      maxMembers: pro.maxMembersPerWorkspace,
      maxFileBytes: pro.maxFileBytes,
      sourcePlanSlug: pro.slug,
      syncedAt: new Date(),
    },
    update: {
      maxMembers: pro.maxMembersPerWorkspace,
      maxFileBytes: pro.maxFileBytes,
      sourcePlanSlug: pro.slug,
    },
  })
  // Plan features are resolved server-side in the (active) layout — reload so
  // the members section renders unlocked.
  await a.reload()
  await a.waitForURL(/\/(pages|chats)/, { timeout: 30_000 })

  // ════ Flow 1: public-link kill-switch ══════════════════════════════════════
  const ownerPageId = await createTextPage(a)

  // Make the page PUBLIC via the share dialog. NOT `getByRole('combobox')
  // .first()` (the page-sharing.spec way): since 8A the guest-invite ROLE
  // Select («Читатель») renders above the general-access Select, so target
  // the access Select by its rendered value instead.
  await a.getByRole('button', { name: 'Поделиться' }).click()
  await expect(a.getByRole('button', { name: 'Копировать ссылку' })).toBeVisible({
    timeout: 15_000,
  })
  await a
    .getByRole('dialog')
    .getByRole('combobox')
    .filter({ hasText: 'Доступ ограничен' })
    .click({ timeout: 15_000 })
  await a.getByRole('option', { name: 'Всем, у кого есть ссылка' }).click({ timeout: 15_000 })

  // Resolve the shareId from the DB (headless clipboard access is unreliable).
  let shareId: string | undefined
  for (let i = 0; i < 50; i += 1) {
    const row = await prisma.pageShare.findUnique({
      where: { pageId: ownerPageId },
      select: { shareId: true, access: true },
    })
    if (row?.access === 'PUBLIC') {
      shareId = row.shareId
      break
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  expect(shareId).toMatch(/^[0-9a-f]{64}$/)
  await a.getByRole('button', { name: 'Готово' }).click()

  // Anonymous visitor (fresh context, no auth cookies) opens the public link.
  const anonCtx = await browser.newContext()
  const anon = await anonCtx.newPage()
  await anon.goto(`/s/${shareId}`)
  await expect(anon.getByText('Общий доступ')).toBeVisible({ timeout: 30_000 })

  // Owner flips the links policy ON — the EXISTING link must stop resolving
  // with the honest policy message (never a silent 404), and come back on OFF.
  const settingsDialog = await openSettingsSection(a, 'Безопасность')
  const linksSwitch = policySwitch(a, 'Отключить публичные ссылки и сайты')
  await expect(linksSwitch).not.toBeChecked({ timeout: 30_000 })
  await linksSwitch.click()
  await expect(linksSwitch).toBeChecked({ timeout: 30_000 })

  await anon.goto(`/s/${shareId}`)
  await expect(
    anon.getByText('Доступ по ссылке отключён администратором пространства'),
  ).toBeVisible({ timeout: 30_000 })
  // The page body must NOT render while the policy is on.
  await expect(anon.locator('.share-page-content')).toHaveCount(0)

  await linksSwitch.click()
  await expect(linksSwitch).not.toBeChecked({ timeout: 30_000 })

  await anon.goto(`/s/${shareId}`)
  await expect(anon.getByText('Общий доступ')).toBeVisible({ timeout: 30_000 })
  await anonCtx.close()

  // ════ Flow 2: export block (server-side; the dialog is a thin fetch wrapper) ═
  // The route owns auth + policy (page-export.spec precedent), so the honest
  // server-denied state is asserted via the same request the export dialog
  // would fire. Baseline first: export works while the policy is off.
  const exportUrl = `/api/pages/${ownerPageId}/export/md`
  const before = await a.request.get(exportUrl)
  expect(before.status()).toBe(200)

  const exportSwitch = policySwitch(a, 'Отключить экспорт')
  await expect(exportSwitch).not.toBeChecked({ timeout: 30_000 })
  await exportSwitch.click()
  await expect(exportSwitch).toBeChecked({ timeout: 30_000 })

  const denied = await a.request.get(exportUrl)
  expect(denied.status()).toBe(403)
  // The 403 NAMES the policy (spec §4: never vague denials).
  expect(((await denied.json()) as { error: string }).error).toContain(
    'Экспорт отключён политикой безопасности',
  )

  // Reversible, like the links switch.
  await exportSwitch.click()
  await expect(exportSwitch).not.toBeChecked({ timeout: 30_000 })
  const restored = await a.request.get(exportUrl)
  expect(restored.status()).toBe(200)

  // ════ Flow 3: guest-invite request workflow ════════════════════════════════
  // Policy: invites OFF, requests ON (the zero-value default for the nested
  // flag is true — assert it, since the whole flow rides on the combo).
  const guestsSwitch = policySwitch(a, 'Запретить гостевые приглашения')
  await guestsSwitch.click()
  await expect(guestsSwitch).toBeChecked({ timeout: 30_000 })
  const requestsSwitch = policySwitch(a, 'Разрешить запросы на гостевой доступ')
  await expect(requestsSwitch).toBeEnabled()
  await expect(requestsSwitch).toBeChecked()
  await settingsDialog.getByRole('button', { name: 'Закрыть' }).click()

  // Member B joins via a known-token invitation (people.spec flow 2 pattern).
  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  const emailB = uniqueEmail('security-member')
  await signUpAndAuthAs(b, { email: emailB, password, firstName: 'Борис', lastName: 'Участник' })
  const userB = await prisma.user.findUniqueOrThrow({
    where: { email: emailB },
    select: { id: true },
  })

  const memberToken = makeToken('Member')
  insertedInvitationHashes.push(sha256(memberToken))
  await prisma.workspaceInvitation.create({
    data: {
      workspaceId: workspace.id,
      email: emailB, // domain stores lowercase; uniqueEmail() is already lowercase
      role: 'EDITOR',
      tokenHash: sha256(memberToken),
      inviterId: userA.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })
  await b.goto(`/invite/${memberToken}`)
  await expect(b.getByTestId('invite-state')).toHaveAttribute('data-state', 'READY', {
    timeout: 30_000,
  })
  await b.getByTestId('invite-accept').click()
  await b.waitForURL(/\/(app$|pages\/|chats)/, { timeout: 60_000 })
  await expect(b.locator('aside').getByText(WORKSPACE_NAME, { exact: true })).toBeVisible({
    timeout: 30_000,
  })

  // B creates a page (B is its creator ⇒ holds edit access AND the share
  // dialog's manage probe passes) and pins it to the TEAM collection — the
  // requester scenario is a member asking to invite an EXTERNAL email to a
  // team page. The first sidebar «Новая страница» is the «Команда» section,
  // but don't let the suite depend on sidebar ordering.
  const memberPageId = await createTextPage(b)
  const teamCollection = await prisma.collection.findFirstOrThrow({
    where: { workspaceId: workspace.id, kind: 'TEAM', ownerId: null },
    select: { id: true },
  })
  const memberPage = await prisma.page.findUniqueOrThrow({
    where: { id: memberPageId },
    select: { collection: { select: { id: true, kind: true } } },
  })
  if (memberPage.collection?.kind !== 'TEAM') {
    await prisma.page.update({
      where: { id: memberPageId },
      data: { collectionId: teamCollection.id },
    })
  }

  // The share dialog shows the REQUEST form instead of the invite form
  // (invites disabled + requests allowed) — submit one for an external email.
  const externalEmail = uniqueEmail('security-guest-ext')
  await b.getByRole('button', { name: 'Поделиться' }).click()
  const bShareDialog = b.getByRole('dialog')
  await expect(b.getByTestId('share-guest-request-email')).toBeVisible({ timeout: 30_000 })
  await b.getByTestId('share-guest-request-email').fill(externalEmail)
  await b.getByTestId('share-guest-request-submit').click()
  await expect(bShareDialog.getByText('Запрос отправлен.')).toBeVisible({ timeout: 30_000 })
  await expect(bShareDialog.getByText('Ожидает решения', { exact: true })).toBeVisible()
  await b.getByRole('button', { name: 'Готово' }).click()

  // Every workspace OWNER got the IN_APP notification row (spec §7.5).
  const notification = await prisma.notificationEvent.findFirst({
    where: { workspaceId: workspace.id, userId: userA.id, type: 'GUEST_INVITE_REQUESTED' },
    select: { id: true },
  })
  expect(notification).not.toBeNull()

  // Owner: the members section carries the pending badge…
  await a.reload()
  await a.waitForURL(/\/(pages|chats)/, { timeout: 30_000 })
  const ownerDialog = await openSettingsSection(a, 'Участники')
  const pendingChip = a.getByTestId('guest-requests-pending-chip')
  await expect(pendingChip).toBeVisible({ timeout: 30_000 })
  await expect(pendingChip).toContainText('1')

  // …and the «Безопасность» queue shows the request row — approve it.
  await ownerDialog.getByRole('button', { name: 'Безопасность', exact: true }).click()
  const requestRow = a.getByTestId('guest-request-row').filter({ hasText: externalEmail })
  await expect(requestRow).toBeVisible({ timeout: 30_000 })
  await expect(requestRow).toContainText(emailB) // the requester column
  await requestRow.getByTestId('guest-request-approve').click()
  const confirmDialog = a.getByRole('dialog').filter({ hasText: 'Одобрить запрос?' })
  await expect(confirmDialog).toBeVisible({ timeout: 15_000 })
  await confirmDialog.getByRole('button', { name: 'Одобрить' }).click()
  await expect(requestRow.getByText('Одобрен', { exact: true })).toBeVisible({ timeout: 30_000 })

  // Approval created the REAL pending guest invite — visible to B (the page's
  // share manager) in the share dialog's invite list, revocable as usual.
  const invite = await prisma.pageGuestInvite.findFirst({
    where: { pageId: memberPageId, email: externalEmail, acceptedAt: null, revokedAt: null },
    select: { id: true },
  })
  expect(invite).not.toBeNull()
  await b.reload()
  await expect(b.locator('.anynote-editor .ProseMirror')).toBeVisible({ timeout: 45_000 })
  await b.getByRole('button', { name: 'Поделиться' }).click()
  const bDialogAfter = b.getByRole('dialog')
  // The invite row: email + «Ожидает» chip + revoke; B's own request now reads
  // «Одобрен». (The exact-match chips keep the two lists distinguishable.)
  await expect(bDialogAfter.getByRole('button', { name: 'Отозвать' })).toBeVisible({
    timeout: 30_000,
  })
  await expect(bDialogAfter.getByText('Ожидает', { exact: true })).toBeVisible()
  await expect(bDialogAfter.getByText('Одобрен', { exact: true })).toBeVisible()
  await b.getByRole('button', { name: 'Готово' }).click()

  // ════ Flow 4: audited admin content search ═════════════════════════════════
  // Seed a page in B's PERSONAL collection (created by invite acceptance) with
  // a run-unique marker — the privacy-critical case: the OWNER finds ANOTHER
  // user's private page, with the audience honestly labelled «Приватная».
  const marker = `e2esecmarker${run}`
  const personalCollection = await prisma.collection.findFirstOrThrow({
    where: { workspaceId: workspace.id, kind: 'PERSONAL', ownerId: userB.id },
    select: { id: true },
  })
  const markerPage = await prisma.page.create({
    data: {
      workspaceId: workspace.id,
      collectionId: personalCollection.id,
      title: `Секретный план ${marker}`,
      type: 'TEXT',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: `Внутри спрятан ${marker} — личная заметка Бориса.` }],
          },
        ],
      },
      createdById: userB.id,
      updatedById: userB.id,
    },
    select: { id: true },
  })
  createdPageIds.push(markerPage.id)

  // The owner's settings dialog is already on «Безопасность»: the search panel
  // opens with the one-time privacy-warning gate, then finds the private page.
  await expect(a.getByTestId('security-search-ack')).toBeVisible({ timeout: 30_000 })
  await a.getByTestId('security-search-ack').click()
  const searchInput = a.getByTestId('security-search-input')
  await expect(searchInput).toBeVisible({ timeout: 30_000 })
  await searchInput.fill(marker)
  await searchInput.press('Enter')
  const resultRow = a.getByTestId('security-search-row').filter({ hasText: marker })
  await expect(resultRow).toBeVisible({ timeout: 30_000 })
  await expect(resultRow.getByText('Приватная', { exact: true })).toBeVisible()
  // The location cell prefers the collection TITLE over the kind label — B's
  // personal collection is seeded as «Личное».
  await expect(resultRow).toContainText('Личное')

  // DB truth: the search was audited with the query VERBATIM (spec §7.2). The
  // result row rendering means the tRPC call returned, and writeAudit runs in
  // the same call before it does.
  const audit = await prisma.workspaceAuditLog.findFirst({
    where: { workspaceId: workspace.id, action: 'content_search.performed' },
    orderBy: { createdAt: 'desc' },
    select: { actorId: true, metadata: true },
  })
  expect(audit).not.toBeNull()
  expect(audit!.actorId).toBe(userA.id)
  const metadata = audit!.metadata as { query?: string | null; resultCount?: number }
  expect(metadata.query).toBe(marker)
  expect(metadata.resultCount).toBeGreaterThanOrEqual(1)

  await ctxB.close()
  await ctxA.close()
})
