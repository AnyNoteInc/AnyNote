import { expect, test, type Page } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

/**
 * Regression for the "Pro + 3 workspaces, no active workspace → /workspaces/new
 * dead-ends with a plan-limit error" bug.
 *
 * Setup repoints the owner's ACTIVE subscription at the seeded 'pro' plan
 * (maxWorkspaces = 3), gives them 3 owned workspaces, and clears
 * activeWorkspaceId — the exact corrupted state from the report. The fix: the
 * create page must NOT offer a form the create mutation would reject; it
 * redirects a plan-maxed user back into one of their workspaces (/app).
 *
 * Shared dev Postgres → every fixture is captured/deleted in afterAll inside a
 * try/finally so $disconnect can never skip cleanup.
 */

test.setTimeout(420_000)

let prisma: typeof import('../../packages/db/src/index').prisma

const subscriptionFixes: { id: string; originalPlanId: string }[] = []
const createdWorkspaceIds: string[] = []
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
    for (const fix of subscriptionFixes) {
      await prisma.subscription
        .update({ where: { id: fix.id }, data: { planId: fix.originalPlanId } })
        .catch(() => {})
    }
    for (const workspaceId of createdWorkspaceIds) {
      await prisma.workspaceLimit.deleteMany({ where: { workspaceId } }).catch(() => {})
      await prisma.workspaceMember.deleteMany({ where: { workspaceId } }).catch(() => {})
      await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => {})
    }
    for (const userId of fixtureUserIds) {
      await prisma.userPreference.deleteMany({ where: { userId } }).catch(() => {})
    }
  } finally {
    await prisma.$disconnect()
  }
})

async function makeProWorkspace(userId: string, name: string): Promise<string> {
  const ws = await prisma.workspace.create({
    data: { name, createdById: userId },
    select: { id: true },
  })
  createdWorkspaceIds.push(ws.id)
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId, role: 'OWNER' },
  })
  return ws.id
}

test('plan-maxed user is routed into a workspace instead of the broken create form', async ({
  page,
}: {
  page: Page
}) => {
  const run = uniqueRun()
  const email = `wscap-${run}@example.com`
  await signUpAndAuthAs(page, { email, password })

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })
  fixtureUserIds.push(user.id)

  // Repoint the default (personal) subscription at 'pro' (maxWorkspaces = 3).
  const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
  const sub = await prisma.subscription.findFirstOrThrow({
    where: { userId: user.id },
    select: { id: true, planId: true },
  })
  subscriptionFixes.push({ id: sub.id, originalPlanId: sub.planId })
  await prisma.subscription.update({ where: { id: sub.id }, data: { planId: pro.id } })

  // Own exactly maxWorkspaces (3) — the limit is reached.
  await makeProWorkspace(user.id, `Cap A ${run}`)
  await makeProWorkspace(user.id, `Cap B ${run}`)
  await makeProWorkspace(user.id, `Cap C ${run}`)

  // The bug trigger: no active workspace selected.
  await prisma.userPreference.upsert({
    where: { userId: user.id },
    create: { userId: user.id, activeWorkspaceId: null },
    update: { activeWorkspaceId: null, defaultWorkspaceId: null },
  })

  // Visit the create page directly — the previously dead-ending route.
  await page.goto('/workspaces/new')

  // FIX: the maxed user is redirected into a real workspace, never shown the
  // form (which would 403). They land somewhere under /app, /pages, or /chats.
  await page.waitForURL(/\/(app|pages|chats)/, { timeout: 30_000 })
  expect(page.url()).not.toContain('/workspaces/new')

  // And the plan-limit error is never surfaced as a dead-end.
  await expect(
    page.getByText(/можно создать не больше 3 пространств/i),
  ).toHaveCount(0)

  // Sanity: the active workspace self-healed to one of the owned workspaces.
  const pref = await prisma.userPreference.findUniqueOrThrow({
    where: { userId: user.id },
    select: { activeWorkspaceId: true },
  })
  expect(createdWorkspaceIds).toContain(pref.activeWorkspaceId)
  expect(pref.activeWorkspaceId).toBeTruthy()
})
