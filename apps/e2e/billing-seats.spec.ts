import { expect, test, type Page } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'
const WORKSPACE_NAME = 'Места WS'

/**
 * Per-seat billing E2E (8D spec §8): one serial journey — the at-capacity
 * members CTA, a real seat purchase through the MOCK YooKassa redirect flow
 * (under YOOKASSA_MOCK_ENABLED the confirmation_url IS the return_url and
 * createPayment settles the order synchronously, so the browser lands on
 * /billing/return with the order already PAID), capacity growth, a scheduled
 * reduction + cancel, and the юрлицо invoice request (validation + the row).
 *
 * Paid fixture: the people/security technique — repoint the owner's ACTIVE
 * subscription at the seeded 'pro' plan (which sells seats) and pin THIS
 * workspace's WorkspaceLimit to maxMembers=1 so the owner alone fills the
 * included capacity. The subscription also needs a RUNNING paid period
 * (currentPeriodStart/End) or beginSeatPurchase refuses with PERIOD_ENDED.
 *
 * The shared dev Postgres means every fixture is captured/restored in afterAll
 * (kept in a try/finally so $disconnect can never skip it). Registries are
 * ARRAYS: with --retries each attempt creates fresh rows and all of them must
 * be cleaned, not just the last attempt's.
 */

test.setTimeout(420_000)

let prisma: typeof import('../../packages/db/src/index').prisma

// ── fixture registries (restored/deleted in afterAll, even on failure) ───────
const subscriptionFixes: {
  id: string
  originalPlanId: string
  originalBillingPeriod: 'MONTHLY' | 'YEARLY'
  originalPeriodStart: Date | null
  originalPeriodEnd: Date | null
}[] = []
const createdSubscriptionIds: string[] = []
const limitFixes: {
  workspaceId: string
  existed: boolean
  maxMembers: number
  maxFileBytes: bigint
  sourcePlanSlug: string | null
}[] = []
// One id per attempt: the seat addon, ledger rows, snapshots, the invoice
// request, and this run's billing audit rows are all scoped to the throwaway
// workspace and dropped wholesale.
const billingWorkspaceIds: string[] = []
// Run-unique throwaway users — their orders are fixture-scoped by userId.
const fixtureUserIds: string[] = []

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
    for (const workspaceId of billingWorkspaceIds) {
      // Append-only product data, but the workspace is a run-unique fixture —
      // drop this run's seat state wholesale. Catch-swallowed: cleanup must
      // never fail the suite (rows may not exist when an attempt died early).
      await prisma.seatBillingEvent.deleteMany({ where: { workspaceId } }).catch(() => {})
      await prisma.workspaceSeatSnapshot.deleteMany({ where: { workspaceId } }).catch(() => {})
      await prisma.workspaceSeatAddon.deleteMany({ where: { workspaceId } }).catch(() => {})
      await prisma.invoiceRequest.deleteMany({ where: { workspaceId } }).catch(() => {})
      await prisma.workspaceAuditLog
        .deleteMany({
          where: {
            workspaceId,
            OR: [{ action: { startsWith: 'seats.' } }, { action: { startsWith: 'invoice.' } }],
          },
        })
        .catch(() => {})
    }
    if (fixtureUserIds.length > 0) {
      // The fixture users never buy a tier through the UI — every order of
      // theirs is this suite's seat purchase.
      await prisma.order.deleteMany({ where: { userId: { in: fixtureUserIds } } }).catch(() => {})
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
        data: {
          planId: subscriptionFix.originalPlanId,
          billingPeriod: subscriptionFix.originalBillingPeriod,
          currentPeriodStart: subscriptionFix.originalPeriodStart,
          currentPeriodEnd: subscriptionFix.originalPeriodEnd,
        },
      })
    }
    if (createdSubscriptionIds.length > 0) {
      await prisma.subscription.deleteMany({ where: { id: { in: createdSubscriptionIds } } })
    }
    // Finally the throwaway fixture workspaces themselves (children cascade).
    // AFTER the restores above — deleting first would make the workspaceLimit
    // restore throw and skip the rest. Catch-swallowed like the row cleanup:
    // cleanup must never fail the suite.
    for (const workspaceId of billingWorkspaceIds) {
      await prisma.workspaceMember.deleteMany({ where: { workspaceId } }).catch(() => {})
      await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {})
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

/** Settings live in a full-screen dialog opened from the space menu (security.spec pattern). */
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

test('seat billing: at-capacity CTA, mock purchase, reduction, invoice request', async ({
  page,
}) => {
  const run = uniqueRun()

  // ════ Fixture: owner on pro with a running period, included capacity 1 ═════
  const email = `billing-seats-${run}@example.com`
  await signUpAndCreateWorkspace(page, email, { firstName: 'Вера', lastName: 'Владелец' })

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })
  fixtureUserIds.push(user.id)
  const workspace = await prisma.workspace.findFirstOrThrow({
    where: { createdById: user.id },
    select: { id: true },
  })
  billingWorkspaceIds.push(workspace.id)

  const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
  expect(pro.pricePerExtraSeatMonthlyKopecks).toBeGreaterThan(0) // the seed/migration applied

  const now = new Date()
  const periodStart = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000)
  const periodEnd = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000)
  const activeSub = await prisma.subscription.findFirst({
    where: { userId: user.id, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
  })
  if (activeSub) {
    subscriptionFixes.push({
      id: activeSub.id,
      originalPlanId: activeSub.planId,
      originalBillingPeriod: activeSub.billingPeriod,
      originalPeriodStart: activeSub.currentPeriodStart,
      originalPeriodEnd: activeSub.currentPeriodEnd,
    })
    await prisma.subscription.update({
      where: { id: activeSub.id },
      data: {
        planId: pro.id,
        billingPeriod: 'MONTHLY',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
    })
  } else {
    const created = await prisma.subscription.create({
      data: {
        userId: user.id,
        planId: pro.id,
        status: 'ACTIVE',
        billingPeriod: 'MONTHLY',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
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
  // maxMembers=1: the owner alone fills the included capacity — at-capacity
  // without paying for a second fixture user.
  await prisma.workspaceLimit.upsert({
    where: { workspaceId: workspace.id },
    create: {
      workspaceId: workspace.id,
      maxMembers: 1,
      maxFileBytes: pro.maxFileBytes,
      sourcePlanSlug: pro.slug,
      syncedAt: new Date(),
    },
    update: { maxMembers: 1, maxFileBytes: pro.maxFileBytes, sourcePlanSlug: pro.slug },
  })
  // Plan features are resolved server-side in the (active) layout — reload so
  // the members section renders unlocked.
  await page.reload()
  await page.waitForURL(/\/(pages|chats)/, { timeout: 30_000 })

  // ════ Members: invite preview at capacity + the buy-seat CTA ═══════════════
  const dialog = await openSettingsSection(page, 'Участники')
  await expect(page.getByText(/Занято 1 из 1 мест тарифа/)).toBeVisible({ timeout: 30_000 })
  // seatPriceKopecks is non-null (pro sells seats) so the CTA renders for the owner.
  await expect(page.getByText('Все места заняты')).toBeVisible()
  const buyCta = page.getByTestId('members-buy-seat-cta')
  await expect(buyCta).toBeVisible()

  // ════ «Биллинг мест»: usage 1/1, buy one seat through the mock ═════════════
  await buyCta.click()
  await expect(dialog.getByRole('button', { name: 'Биллинг мест', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )
  const usageCard = page.getByTestId('billing-seat-usage')
  await expect(usageCard).toContainText('Занято 1 из 1 мест: 1 по тарифу', { timeout: 30_000 })

  // The stepper defaults to 1 — «Купить» buys exactly one seat. Under the mock,
  // purchaseSeats returns confirmationUrl === the return_url
  // (/billing/return?orderId=…) and the order is already settled server-side.
  await expect(page.getByTestId('billing-buy-seats-count')).toHaveValue('1')
  await page.getByTestId('billing-buy-seats').click()
  await page.waitForURL(/\/billing\/return\?orderId=/, { timeout: 60_000 })
  const orderId = new URL(page.url()).searchParams.get('orderId')
  expect(orderId).toBeTruthy()
  await expect(page.getByText('Оплата прошла успешно')).toBeVisible({ timeout: 20_000 })

  // ── DB truth: the PAID seat_purchase order, the addon, the ledger, the audit ─
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId! } })
  expect(order.status).toBe('PAID')
  expect(order.isInitial).toBe(false)
  const orderMeta = order.metadata as { kind?: string; workspaceId?: string; seats?: number }
  expect(orderMeta.kind).toBe('seat_purchase')
  expect(orderMeta.workspaceId).toBe(workspace.id)
  expect(orderMeta.seats).toBe(1)
  // Prorated mid-period: more than zero, never more than the full-period price.
  expect(order.amountKopecks).toBeGreaterThan(0)
  expect(order.amountKopecks).toBeLessThanOrEqual(pro.pricePerExtraSeatMonthlyKopecks)

  const addon = await prisma.workspaceSeatAddon.findUniqueOrThrow({
    where: { workspaceId: workspace.id },
  })
  expect(addon.paidSeats).toBe(1)
  expect(addon.scheduledSeats).toBeNull()

  const purchasedEvent = await prisma.seatBillingEvent.findFirst({
    where: { workspaceId: workspace.id, type: 'SEATS_PURCHASED' },
    orderBy: { createdAt: 'desc' },
  })
  expect(purchasedEvent).not.toBeNull()
  expect(purchasedEvent!.orderId).toBe(orderId)
  expect(purchasedEvent!.seatsDelta).toBe(1)
  expect(purchasedEvent!.seatsAfter).toBe(1)
  expect(purchasedEvent!.amountKopecks).toBe(order.amountKopecks)
  expect(purchasedEvent!.actorId).toBe(user.id)

  const purchaseAudit = await prisma.workspaceAuditLog.findFirst({
    where: { workspaceId: workspace.id, action: 'seats.purchased' },
    orderBy: { createdAt: 'desc' },
    select: { actorId: true, metadata: true },
  })
  expect(purchaseAudit).not.toBeNull()
  expect(purchaseAudit!.actorId).toBe(user.id)
  expect((purchaseAudit!.metadata as { orderId?: string }).orderId).toBe(orderId)

  // ════ Usage grew: «из 2 … + 1 докупленных», the ledger row renders ═════════
  await page.goto('/app')
  await page.waitForURL(/\/(pages|chats)/, { timeout: 30_000 })
  const dialog2 = await openSettingsSection(page, 'Биллинг мест')
  await expect(usageCard).toContainText('Занято 1 из 2 мест: 1 по тарифу + 1 докупленных', {
    timeout: 30_000,
  })
  await expect(
    page
      .getByTestId('billing-seat-events')
      .getByTestId('billing-seat-event-row')
      .filter({ hasText: 'Места докуплены' }),
  ).toBeVisible({ timeout: 30_000 })

  // ════ Members preview no longer at capacity ════════════════════════════════
  await dialog2.getByRole('button', { name: 'Участники', exact: true }).click()
  await expect(page.getByText(/Занято 1 из 2 мест тарифа/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Все места заняты')).toHaveCount(0)
  await expect(page.getByTestId('members-buy-seat-cta')).toHaveCount(0)

  // ════ Reduction: schedule target 0 → notice → cancel → gone ════════════════
  await dialog2.getByRole('button', { name: 'Биллинг мест', exact: true }).click()
  // memberCount=1 fits in the included 1 seat, so target 0 is the only option.
  await expect(page.getByTestId('billing-reduce-seats-target')).toHaveValue('0', {
    timeout: 30_000,
  })
  await page.getByTestId('billing-reduce-seats').click()
  await expect(
    page.getByText('Уменьшение запланировано: 0 докупленных мест со следующего списания.'),
  ).toBeVisible({ timeout: 30_000 })
  // The usage-card notice: included 1 + scheduled 0 — money never refunds mid-cycle.
  const reductionNotice = page.getByText(/Со следующего списания: 1 мест \(0 докупленных\)/)
  await expect(reductionNotice).toBeVisible({ timeout: 30_000 })

  const addonScheduled = await prisma.workspaceSeatAddon.findUniqueOrThrow({
    where: { workspaceId: workspace.id },
  })
  expect(addonScheduled.paidSeats).toBe(1) // untouched until the next renewal
  expect(addonScheduled.scheduledSeats).toBe(0)

  await page.getByTestId('billing-cancel-reduction').click()
  await expect(page.getByText(/Со следующего списания/)).toHaveCount(0, { timeout: 30_000 })
  const addonCanceled = await prisma.workspaceSeatAddon.findUniqueOrThrow({
    where: { workspaceId: workspace.id },
  })
  expect(addonCanceled.scheduledSeats).toBeNull()

  // ════ Invoice request: validation surface first, then the real submit ══════
  const form = page.getByTestId('billing-invoice-form')
  await expect(form).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('billing-invoice-legal-name').fill('ООО Ромашка')
  await page.getByTestId('billing-invoice-inn').fill('123') // not 10/12 digits
  await page.getByTestId('billing-invoice-address').fill('г. Москва, ул. Ленина, д. 1')
  await page.getByTestId('billing-invoice-email').fill(`invoice-${run}@example.com`)
  await page.getByTestId('billing-invoice-seats').fill('2')
  await page.getByTestId('billing-invoice-submit').click()
  await expect(page.getByText('ИНН должен содержать ровно 10 или 12 цифр')).toBeVisible({
    timeout: 15_000,
  })
  // Nothing was submitted — the client refuses what the domain would refuse.
  expect(await prisma.invoiceRequest.count({ where: { workspaceId: workspace.id } })).toBe(0)

  await page.getByTestId('billing-invoice-inn').fill('7707083893')
  await page.getByTestId('billing-invoice-kpp').fill('770701001')
  await page.getByTestId('billing-invoice-submit').click()
  await expect(page.getByText('Заявка отправлена')).toBeVisible({ timeout: 30_000 })
  const invoiceRow = page.getByTestId('billing-invoice-row')
  await expect(invoiceRow).toBeVisible({ timeout: 30_000 })
  await expect(invoiceRow).toContainText('ООО Ромашка')
  await expect(invoiceRow).toContainText('Новая')

  // ── DB truth: the request row + the audit ───────────────────────────────────
  const invoice = await prisma.invoiceRequest.findFirstOrThrow({
    where: { workspaceId: workspace.id },
  })
  expect(invoice.status).toBe('NEW')
  expect(invoice.inn).toBe('7707083893')
  expect(invoice.kpp).toBe('770701001')
  expect(invoice.seats).toBe(2)
  expect(invoice.periodMonths).toBe(12)
  expect(invoice.userId).toBe(user.id)

  const invoiceAudit = await prisma.workspaceAuditLog.findFirst({
    where: { workspaceId: workspace.id, action: 'invoice.requested' },
    orderBy: { createdAt: 'desc' },
    select: { actorId: true, metadata: true },
  })
  expect(invoiceAudit).not.toBeNull()
  expect(invoiceAudit!.actorId).toBe(user.id)
  expect((invoiceAudit!.metadata as { invoiceRequestId?: string }).invoiceRequestId).toBe(
    invoice.id,
  )
})
