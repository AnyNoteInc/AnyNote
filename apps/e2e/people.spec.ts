import { createHash } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'
const WORKSPACE_NAME = 'Люди WS'
const GUEST_PAGE_TITLE = 'Гостевая страница для E2E'

/**
 * People-management E2E (people spec §9): four flows in one serial journey —
 * the member invite UI, token acceptance, guest containment, and blocking.
 *
 * Invite tokens are stored HASHED at rest (sha256 hex, no recovery by design),
 * so acceptance flows insert WorkspaceInvitation / PageGuestInvite rows
 * directly via Prisma with a KNOWN plaintext (hashed in the spec) and drive
 * `/invite/{plaintext}` / `/guest-invite/{plaintext}`. Invite CREATION through
 * the UI is asserted separately in flow 1.
 *
 * Plan gating: `people.invite` requires a PAID workspace (`assertPaidWorkspace`
 * → `features.isPaid`, derived from the workspace OWNER's active-subscription
 * plan slug — not a flippable plan flag like webhooks' developerSpaceEnabled).
 * The fixture therefore points the owner's ACTIVE subscription at the seeded
 * 'pro' plan and bumps THIS workspace's WorkspaceLimit row (seat checks read
 * the limit row, synced at creation from the personal plan: maxMembers=1).
 * The shared dev Postgres means every fixture is captured and restored in
 * afterAll (kept in a try/finally so $disconnect can never skip it).
 */

test.setTimeout(420_000)

let prisma: typeof import('../../packages/db/src/index').prisma

// ── fixture registry (restored/deleted in afterAll, even on failure) ─────────
let subscriptionFix: { id: string; originalPlanId: string } | null = null
let createdSubscriptionId: string | null = null
let limitFix: {
  workspaceId: string
  existed: boolean
  maxMembers: number
  maxFileBytes: bigint
  sourcePlanSlug: string | null
} | null = null
let uiInviteFix: { workspaceId: string; email: string } | null = null
const insertedInvitationHashes: string[] = []
const insertedGuestInviteHashes: string[] = []
let blockFix: { workspaceId: string; userId: string } | null = null

function sha256(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** base62-only, unique per attempt — tokenHash columns are UNIQUE in the shared DB. */
function makeToken(label: string): string {
  return `E2EPeople${label}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.replaceAll(
    /[^A-Za-z0-9]/g,
    '',
  )
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
    if (blockFix) {
      await prisma.workspaceBlockedUser.deleteMany({ where: blockFix })
    }
    if (uiInviteFix) {
      await prisma.workspaceInvitation.deleteMany({ where: uiInviteFix })
    }
    if (insertedInvitationHashes.length > 0) {
      await prisma.workspaceInvitation.deleteMany({
        where: { tokenHash: { in: insertedInvitationHashes } },
      })
    }
    if (insertedGuestInviteHashes.length > 0) {
      await prisma.pageGuestInvite.deleteMany({
        where: { tokenHash: { in: insertedGuestInviteHashes } },
      })
    }
    if (limitFix) {
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
    if (subscriptionFix) {
      await prisma.subscription.update({
        where: { id: subscriptionFix.id },
        data: { planId: subscriptionFix.originalPlanId },
      })
    }
    if (createdSubscriptionId) {
      await prisma.subscription.deleteMany({ where: { id: createdSubscriptionId } })
    }
  } finally {
    await prisma.$disconnect()
  }
})

async function signUpAndCreateWorkspace(page: Page, email: string): Promise<void> {
  await signUpAndAuthAs(page, { email, password, firstName: 'Анна', lastName: 'Владелец' })

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

// Settings live in a full-screen dialog opened from the space menu (workspace
// name in the sidebar header). «Пригласить» jumps straight to the members
// section; assert the nav marks it active before touching its widgets.
async function openMembersSettings(page: Page) {
  await page.locator('aside').getByText(WORKSPACE_NAME, { exact: true }).click()
  await page.getByRole('button', { name: 'Пригласить' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Участники' })).toHaveAttribute(
    'aria-current',
    'page',
  )
}

test('people management: invite, acceptance, guest scope, blocking', async ({ browser }) => {
  // ════ Owner (A): sign up, create workspace, become paid ════════════════════
  const ctxA = await browser.newContext()
  const a = await ctxA.newPage()
  const emailA = uniqueEmail('people-owner')
  await signUpAndCreateWorkspace(a, emailA)

  const userA = await prisma.user.findUniqueOrThrow({
    where: { email: emailA },
    select: { id: true },
  })
  const workspace = await prisma.workspace.findFirstOrThrow({
    where: { createdById: userA.id },
    select: { id: true },
  })

  // Paid-workspace fixture: repoint A's ACTIVE subscription at the seeded
  // 'pro' plan and sync this workspace's seat-limit row to pro's seats.
  const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
  const activeSub = await prisma.subscription.findFirst({
    where: { userId: userA.id, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, planId: true },
  })
  if (activeSub) {
    subscriptionFix = { id: activeSub.id, originalPlanId: activeSub.planId }
    await prisma.subscription.update({ where: { id: activeSub.id }, data: { planId: pro.id } })
  } else {
    const created = await prisma.subscription.create({
      data: { userId: userA.id, planId: pro.id, status: 'ACTIVE' },
      select: { id: true },
    })
    createdSubscriptionId = created.id
  }
  const existingLimit = await prisma.workspaceLimit.findUnique({
    where: { workspaceId: workspace.id },
  })
  limitFix = existingLimit
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
      }
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
  // the members section renders visible and unlocked.
  await a.reload()
  await a.waitForURL(/\/(pages|chats)/, { timeout: 30_000 })

  // ════ Flow 1: owner invites an email via the UI → row «Ожидает» ═══════════
  await openMembersSettings(a)
  const invitedEmail = uniqueEmail('people-pending')
  uiInviteFix = { workspaceId: workspace.id, email: invitedEmail }

  // The seat line proves the paid fixture took effect (locked form shows none).
  await expect(a.getByText(/Занято \d+ из \d+ мест тарифа/)).toBeVisible({ timeout: 30_000 })
  await a.getByTestId('people-invite-email').fill(invitedEmail)
  await a.getByTestId('people-invite-submit').click()
  const pendingRow = a.getByTestId('people-invitation-row').filter({ hasText: invitedEmail })
  await expect(pendingRow).toBeVisible({ timeout: 30_000 })
  await expect(pendingRow).toContainText('Ожидает')

  // ════ Flow 2: member acceptance via a known-token invitation ══════════════
  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  const emailB = uniqueEmail('people-member')
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
  // Acceptance scopes B to the workspace and lands in the app shell.
  await b.waitForURL(/\/(app$|pages\/|chats)/, { timeout: 60_000 })
  await expect(b.locator('aside').getByText(WORKSPACE_NAME, { exact: true })).toBeVisible({
    timeout: 30_000,
  })

  // A's members list shows B (fresh page → fresh queries; no stale cache).
  await a.reload()
  await a.waitForURL(/\/(pages|chats)/, { timeout: 30_000 })
  await openMembersSettings(a)
  const memberRowB = a.getByRole('row').filter({ hasText: emailB })
  await expect(memberRowB).toBeVisible({ timeout: 30_000 })

  // ════ Flow 3: guest — known-token PageGuestInvite on a TEAM-collection page ═
  const ctxC = await browser.newContext()
  const c = await ctxC.newPage()
  const emailC = uniqueEmail('people-guest')
  await signUpAndAuthAs(c, { email: emailC, password, firstName: 'Гоша', lastName: 'Гость' })

  const teamCollection = await prisma.collection.findFirstOrThrow({
    where: { workspaceId: workspace.id, kind: 'TEAM', ownerId: null },
    select: { id: true },
  })
  const guestPage = await prisma.page.create({
    data: {
      workspaceId: workspace.id,
      collectionId: teamCollection.id,
      title: GUEST_PAGE_TITLE,
      type: 'TEXT',
      createdById: userA.id,
    },
    select: { id: true },
  })
  const guestToken = makeToken('Guest')
  insertedGuestInviteHashes.push(sha256(guestToken))
  await prisma.pageGuestInvite.create({
    data: {
      pageId: guestPage.id,
      workspaceId: workspace.id,
      email: emailC,
      role: 'READER',
      tokenHash: sha256(guestToken),
      inviterId: userA.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })

  await c.goto(`/guest-invite/${guestToken}`)
  await expect(c.getByTestId('invite-state')).toHaveAttribute('data-state', 'READY', {
    timeout: 30_000,
  })
  await c.getByTestId('invite-accept').click()
  // Guest acceptance lands directly on the granted page — and it renders.
  await c.waitForURL(new RegExp(`/pages/${guestPage.id}`), { timeout: 60_000 })
  await expect(c.locator('.anynote-editor .ProseMirror')).toBeVisible({ timeout: 45_000 })

  // The guest sidebar is ONLY «Доступные мне» with the granted page…
  const guestSection = c.getByTestId('guest-pages-section')
  await expect(guestSection).toBeVisible({ timeout: 30_000 })
  await expect(
    guestSection.getByTestId('guest-page-row').filter({ hasText: GUEST_PAGE_TITLE }),
  ).toBeVisible()
  // …no member affordances (no page tree / creation)…
  await expect(c.getByRole('button', { name: 'Новая страница' })).toHaveCount(0)
  // …and the space menu offers no settings entry (guest chip marks the row).
  await c.locator('aside').getByText(WORKSPACE_NAME, { exact: true }).click()
  await expect(c.getByTestId('guest-chip')).toBeVisible({ timeout: 15_000 })
  await expect(c.getByRole('button', { name: 'Настройки' })).toHaveCount(0)
  await expect(c.getByRole('button', { name: 'Пригласить' })).toHaveCount(0)
  await c.keyboard.press('Escape')

  // ════ Flow 4: A blocks B → B loses the workspace entirely ═════════════════
  await memberRowB.getByTestId('people-block-button').click()
  const confirmDialog = a.getByRole('dialog').filter({ hasText: 'Заблокировать участника?' })
  await expect(confirmDialog).toBeVisible({ timeout: 15_000 })
  blockFix = { workspaceId: workspace.id, userId: userB.id } // register BEFORE mutating
  await confirmDialog.getByRole('button', { name: 'Заблокировать' }).click()
  await expect(memberRowB.getByText('Заблокирован', { exact: true })).toBeVisible({
    timeout: 30_000,
  })
  await expect(memberRowB.getByTestId('people-unblock-button')).toBeVisible()

  // Denial behavior (empirical): a blocked user's workspaces vanish from BOTH
  // resolver arms, so with no other workspace getActive() resolves null and
  // every protected entry redirects to the workspace-creation screen.
  await b.goto('/app')
  await b.waitForURL(/\/workspaces\/new/, { timeout: 60_000 })
  await expect(b.getByRole('heading', { name: 'Создайте рабочее пространство' })).toBeVisible({
    timeout: 30_000,
  })

  await ctxC.close()
  await ctxB.close()
  await ctxA.close()
})
