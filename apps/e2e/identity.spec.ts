import { expect, test, type Page } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'
const WORKSPACE_NAME = 'Домены WS'
const WORKSPACE_B_NAME = 'Личное Б'

/**
 * Identity-governance E2E (identity spec §8): three flows in one serial
 * journey — domain management honesty (public-domain rejection, DNS
 * verification that REALLY fails against real DNS), the provider
 * verified-domain gate + the honest enterprise pre-sales card, and the
 * explicit domain auto-join (billable EDITOR seat, never a guest).
 *
 * The corp domain is run-unique under the RFC-2606-reserved `.example` TLD:
 * never delegated, so the on-demand TXT check gets a deterministic NXDOMAIN
 * from real DNS — the honest-failure state (`lastCheckError`), not a mock.
 *
 * Plan gating: the «Домены и вход» settings section requires the OWNER role
 * AND a paid workspace (`membersSettingsEnabled` + `isPaid`), so the fixture
 * reuses people.spec.ts's technique — repoint the owner's ACTIVE subscription
 * at the seeded 'pro' plan and bump THIS workspace's WorkspaceLimit row
 * (domain join has no paid gate of its own, but the seat check reads the
 * limit row, synced at creation from the personal plan: maxMembers=1).
 * The shared dev Postgres means every fixture is captured/restored in
 * afterAll (kept in a try/finally so $disconnect can never skip it). Fixture
 * registries are ARRAYS: with --retries each attempt creates fresh rows and
 * all of them must be cleaned, not just the last attempt's.
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
const domainFixes: { workspaceId: string; domain: string }[] = []
const providerFixes: { workspaceId: string; name: string }[] = []
const memberFixes: { workspaceId: string; userId: string }[] = []
const auditWorkspaceIds: string[] = []

function uniqueRun(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

test.beforeAll(async () => {
  loadEnvFromRoot()
  const db = await import('../../packages/db/src/index')
  prisma = db.prisma
})

test.afterAll(async () => {
  if (!prisma) return
  try {
    for (const member of memberFixes) {
      await prisma.workspaceMember.deleteMany({ where: member })
      // joinViaDomain also ensured a personal collection for the joiner —
      // drop it so the shared dev DB doesn't accumulate orphans. Catch-
      // swallowed: cleanup must never fail the suite.
      await prisma.collection
        .deleteMany({
          where: { workspaceId: member.workspaceId, kind: 'PERSONAL', ownerId: member.userId },
        })
        .catch(() => {})
    }
    for (const provider of providerFixes) {
      await prisma.workspaceAuthProvider.deleteMany({ where: provider })
    }
    for (const domain of domainFixes) {
      await prisma.verifiedEmailDomain.deleteMany({ where: domain })
      await prisma.allowedEmailDomain.deleteMany({ where: domain })
    }
    for (const workspaceId of auditWorkspaceIds) {
      // Identity audit rows are append-only product data, but the workspace
      // is a throwaway test fixture — drop this run's identity actions.
      await prisma.workspaceAuditLog
        .deleteMany({
          where: {
            workspaceId,
            OR: [
              { action: { startsWith: 'domain.' } },
              { action: { startsWith: 'provider.' } },
              { action: { startsWith: 'sso.' } },
            ],
          },
        })
        .catch(() => {})
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
  workspaceName: string,
  names: { firstName: string; lastName: string },
): Promise<void> {
  await signUpAndAuthAs(page, { email, password, ...names })

  // After sign-up the user lands on the workspace-creation form. On a cold dev
  // server hydration can lag behind the first fill() — re-fill until React
  // registers the value (webhooks.spec.ts pattern).
  const nameInput = page.getByRole('textbox', { name: 'Название' })
  const createButton = page.getByRole('button', { name: 'Создать пространство' })
  await expect(async () => {
    await nameInput.fill(workspaceName)
    await expect(createButton).toBeEnabled({ timeout: 2_000 })
  }).toPass({ timeout: 60_000 })
  await createButton.click()
  await page.waitForURL(/\/(pages|chats)\//, { timeout: 30_000 })
}

test('identity governance: domain honesty, provider gate, enterprise, domain join', async ({
  browser,
}) => {
  const run = uniqueRun()
  const corpDomain = `corp-${run}.example`
  const providerName = `IdP E2E ${run}`

  // ════ Owner (A): sign up, create workspace, become paid ════════════════════
  const ctxA = await browser.newContext()
  const a = await ctxA.newPage()
  const emailA = `identity-owner-${run}@example.com`
  await signUpAndCreateWorkspace(a, emailA, WORKSPACE_NAME, {
    firstName: 'Ольга',
    lastName: 'Владелец',
  })

  const userA = await prisma.user.findUniqueOrThrow({
    where: { email: emailA },
    select: { id: true },
  })
  const workspace = await prisma.workspace.findFirstOrThrow({
    where: { createdById: userA.id },
    select: { id: true },
  })
  auditWorkspaceIds.push(workspace.id)
  domainFixes.push({ workspaceId: workspace.id, domain: corpDomain })
  providerFixes.push({ workspaceId: workspace.id, name: providerName })

  // Paid-workspace fixture (people.spec.ts technique): repoint A's ACTIVE
  // subscription at the seeded 'pro' plan and sync this workspace's seat-limit
  // row to pro's seats — the «Домены и вход» section is paid-gated and the
  // domain join needs a free seat (B will take the second of pro's 5).
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
  // the identity section renders visible and unlocked.
  await a.reload()
  await a.waitForURL(/\/(pages|chats)/, { timeout: 30_000 })

  // ════ Flow 1: «Домены и вход» — allowed domains + DNS verification ════════
  await a.locator('aside').getByText(WORKSPACE_NAME, { exact: true }).click()
  await a.getByRole('button', { name: 'Настройки' }).click()
  const dialog = a.getByRole('dialog')
  // The nav entry only exists for an OWNER on a paid plan — its presence
  // proves the fixture took effect.
  const identityNav = dialog.getByRole('button', { name: 'Домены и вход' })
  await expect(identityNav).toBeVisible({ timeout: 30_000 })
  await identityNav.click()
  await expect(identityNav).toHaveAttribute('aria-current', 'page')

  // Public e-mail domains are rejected server-side; the message surfaces as-is.
  await a.getByTestId('identity-allowed-domain-input').fill('gmail.com')
  await a.getByTestId('identity-allowed-add').click()
  await expect(dialog.getByText(/Публичные почтовые домены нельзя использовать/)).toBeVisible({
    timeout: 30_000,
  })

  // A run-unique corp domain is accepted and listed.
  await a.getByTestId('identity-allowed-domain-input').fill(corpDomain)
  await a.getByTestId('identity-allowed-add').click()
  await expect(
    a.getByTestId('identity-allowed-row').filter({ hasText: corpDomain }),
  ).toBeVisible({ timeout: 30_000 })

  // Verification: starting it shows the TXT instructions (token + the
  // mandatory case-sensitivity wording) on a PENDING row.
  await a.getByTestId('identity-verified-domain-input').fill(corpDomain)
  await a.getByTestId('identity-verified-add').click()
  const verifiedRow = a.getByTestId('identity-verified-row').filter({ hasText: corpDomain })
  await expect(verifiedRow).toBeVisible({ timeout: 30_000 })
  await expect(verifiedRow.getByText('Ожидает', { exact: true })).toBeVisible()
  await expect(verifiedRow.getByTestId('identity-verified-txt-value')).toContainText(
    'anynote-verification=',
  )
  await expect(verifiedRow.getByText(/точно как показано/)).toBeVisible()

  // «Проверить» runs the REAL node:dns TXT resolver. The reserved `.example`
  // TLD is never delegated ⇒ NXDOMAIN ⇒ the honest failure state: the row
  // stays PENDING and surfaces `lastCheckError` (generous timeout — real DNS).
  await a.getByTestId('identity-verify-check').click()
  await expect(verifiedRow.getByText(/Последняя проверка/)).toBeVisible({ timeout: 60_000 })
  await expect(verifiedRow.getByText('Ожидает', { exact: true })).toBeVisible()
  await expect(verifiedRow.getByText('Подтверждён', { exact: true })).toHaveCount(0)

  // ════ Flow 2: provider create → activate blocked honestly → enterprise ═════
  await a.getByTestId('identity-provider-create').click()
  await a.getByTestId('identity-provider-name').fill(providerName)
  await a.getByTestId('identity-provider-issuer').fill(`https://idp-${run}.example`)
  await a.getByTestId('identity-provider-client-id').fill('e2e-client-id')
  await a.getByTestId('identity-provider-secret').fill('e2e-client-secret')
  await a.getByTestId('identity-provider-save').click()
  const providerRow = a.getByTestId('identity-provider-row').filter({ hasText: providerName })
  await expect(providerRow).toBeVisible({ timeout: 30_000 })
  await expect(providerRow.getByText('Отключен', { exact: true })).toBeVisible()

  // No VERIFIED domain exists (the check above honestly failed), so the
  // activate dialog blocks: warning + disabled confirm.
  await providerRow.getByTestId('identity-provider-activate').click()
  await expect(a.getByTestId('identity-activate-no-domain')).toBeVisible({ timeout: 15_000 })
  await expect(a.getByTestId('identity-activate-no-domain')).toContainText(
    'Сначала подтвердите домен',
  )
  await expect(a.getByTestId('identity-provider-activate-confirm')).toBeDisabled()
  // Scope by the warning testid — the fullscreen settings dialog is ALSO a
  // [role=dialog] portal whose text contains «Активировать» (the row button).
  const activateDialog = a
    .getByRole('dialog')
    .filter({ has: a.getByTestId('identity-activate-no-domain') })
  await activateDialog.getByRole('button', { name: 'Отмена' }).click()

  // Enterprise pre-sales: the SAML request only records the application.
  await a.getByTestId('identity-enterprise-request').click()
  await expect(dialog.getByText(/Заявка записана/)).toBeVisible({ timeout: 30_000 })
  await expect(a.getByTestId('identity-enterprise-request')).toContainText('Заявка отправлена')

  await dialog.getByRole('button', { name: 'Закрыть' }).click()

  // ════ Flow 3: user B joins via the allowed domain (billable EDITOR seat) ═══
  const ctxB = await browser.newContext()
  const b = await ctxB.newPage()
  // B's e-mail lives ON the allowed corp domain — the exact surface the
  // banner keys off. B needs an own workspace to reach the (active) layout
  // where the banner renders.
  const emailB = `userb-${run}@${corpDomain}`
  await signUpAndCreateWorkspace(b, emailB, WORKSPACE_B_NAME, {
    firstName: 'Борис',
    lastName: 'Доменный',
  })
  const userB = await prisma.user.findUniqueOrThrow({
    where: { email: emailB },
    select: { id: true },
  })

  const banner = b.getByTestId('domain-join-banner')
  await expect(banner).toBeVisible({ timeout: 30_000 })
  await expect(banner).toContainText(WORKSPACE_NAME)

  memberFixes.push({ workspaceId: workspace.id, userId: userB.id }) // register BEFORE mutating
  await banner.getByTestId('domain-join-button').click()
  const joinDialog = b.getByRole('dialog').filter({ hasText: 'Присоединиться к' })
  await expect(joinDialog).toBeVisible({ timeout: 15_000 })
  // The confirm is explicit about the billing consequence (no silent joins).
  await expect(joinDialog).toContainText('платное место')
  await b.getByTestId('domain-join-confirm').click()

  // join → setActive → /app lands B inside A's workspace. B's pre-join URL
  // already matches the pages/chats shape, so the sidebar header flip (B's
  // own workspace name → A's) is the real navigation signal — the web-first
  // assertion retries through the redirect chain.
  await expect(b.locator('aside').getByText(WORKSPACE_NAME, { exact: true })).toBeVisible({
    timeout: 60_000,
  })

  // DB truth: B holds a real member seat with the domain-join role — EDITOR,
  // never GUEST (cl8 hard rule: domain joins are billable member seats).
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: userB.id } },
    select: { role: true },
  })
  expect(membership?.role).toBe('EDITOR')

  await ctxB.close()
  await ctxA.close()
})
