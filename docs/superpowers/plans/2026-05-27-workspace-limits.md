# Workspace Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-workspace limits for member count and file storage, sync'd from plan on subscription change, with `/workspaces/{id}/settings/usage` page.

**Architecture:** New `WorkspaceLimit` table (1:1 with `Workspace`) snapshots limits from the owner's plan. Sync helper runs at workspace creation and on every subscription transition. Upload route + `inviteMember` enforce against `WorkspaceLimit`. New RSC settings page renders two `LinearProgress` bars plus an over-limit alert.

**Tech Stack:** Prisma 7 / PostgreSQL, tRPC v11, Next.js 16 App Router (RSC), MUI v6 (`LinearProgress`), vitest, Playwright.

**Source spec:** [docs/superpowers/specs/2026-05-27-workspace-limits-design.md](../specs/2026-05-27-workspace-limits-design.md)

---

## File Structure

**Create:**
- `packages/db/prisma/migrations/20260527XXXXXX_workspace_limits/migration.sql`
- `packages/trpc/test/workspace-limits.test.ts`
- `packages/trpc/test/workspace-usage.test.ts`
- `apps/web/src/lib/format-bytes.ts`
- `apps/web/test/format-bytes.test.ts`
- `apps/web/src/components/workspace/settings/usage-section.tsx`
- `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/usage/page.tsx`
- `apps/e2e/workspace-usage.spec.ts`

**Modify:**
- `packages/db/prisma/schema.prisma` (lines ~283 Workspace, ~631 Plan, new model at end)
- `packages/db/prisma/seed.ts` (plans array + features bullets)
- `packages/trpc/src/helpers/plan.ts` (add `resolveActivePlanOrPersonal`, `syncWorkspaceLimits`)
- `packages/trpc/src/routers/workspace.ts` (`create`, `inviteMember`, `getUsage`)
- `packages/trpc/src/services/billing.ts` (`handlePaymentSucceeded`, `handleRefundSucceeded`)
- `apps/engines/src/apps/billing/services/subscription-renewal.service.ts` (`expireCanceled`, `renewOne`)
- `apps/web/src/app/api/files/upload/route.ts` (storage check before put)
- `apps/web/src/components/workspace/workspace-settings-nav.tsx` (add `usage` item)
- `apps/web/src/lib/legal-documents.ts` (bump `public-offer` version)
- `docs/terms/PublicOffer.md` (date + tariff table)

---

## Conventions

- Use `pnpm --filter @repo/trpc test` to run trpc tests; `pnpm --filter web test` for web tests; `pnpm exec playwright test apps/e2e/workspace-usage.spec.ts` for E2E.
- Run `pnpm --filter @repo/db exec prisma generate` after schema edits and before tests in dependent packages.
- Commit after each task (Conventional Commits with scope, e.g. `feat(trpc): add syncWorkspaceLimits`).
- `BigInt` is serialized as string at API boundaries (see existing `serializeFile` pattern in `packages/trpc/src/routers/file.ts:12`).

---

## Task 1: Add `Plan.maxFileBytes` and `WorkspaceLimit` to Prisma schema

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add `maxFileBytes` to `Plan` model**

In `packages/db/prisma/schema.prisma`, inside `model Plan { ... }`, just below `maxMembersPerWorkspace Int @default(1) @map("max_members_per_workspace")` (~line 642), add:

```prisma
  maxFileBytes           BigInt  @default(0) @map("max_file_bytes")
```

- [ ] **Step 2: Add `limits` back-relation to `Workspace` model**

In `model Workspace { ... }` (~line 283), inside the relations block (after `agentActionLogs AgentActionLog[]`, ~line 305), add:

```prisma
  limits                WorkspaceLimit?
```

- [ ] **Step 3: Append `WorkspaceLimit` model**

At the end of `schema.prisma`, append:

```prisma
model WorkspaceLimit {
  workspaceId    String   @id @map("workspace_id") @db.Uuid
  maxMembers     Int      @map("max_members")
  maxFileBytes   BigInt   @map("max_file_bytes")
  sourcePlanSlug String?  @map("source_plan_slug") @db.VarChar(50)
  syncedAt       DateTime @map("synced_at") @db.Timestamptz(6)
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  workspace      Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@map("workspace_limits")
}
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @repo/db exec prisma migrate dev --name workspace_limits --create-only`

Expected: a new directory `packages/db/prisma/migrations/20260527XXXXXX_workspace_limits/migration.sql` is created.

- [ ] **Step 5: Edit the generated migration to add backfill**

Open `packages/db/prisma/migrations/20260527XXXXXX_workspace_limits/migration.sql`. After the `CREATE TABLE workspace_limits ...` and `ALTER TABLE plans ADD COLUMN max_file_bytes BIGINT NOT NULL DEFAULT 0` statements, append:

```sql
-- Set plan storage limits
UPDATE plans SET max_file_bytes = 524288000 WHERE slug = 'personal';
UPDATE plans SET max_file_bytes = 5368709120 WHERE slug = 'pro';
UPDATE plans SET max_file_bytes = 21474836480 WHERE slug = 'max';

-- Cap MAX plan workspaces at 10 (was unlimited / null)
UPDATE plans SET max_workspaces = 10 WHERE slug = 'max' AND max_workspaces IS NULL;

-- Backfill workspace_limits from owner's active plan, falling back to personal
INSERT INTO workspace_limits (workspace_id, max_members, max_file_bytes, source_plan_slug, synced_at, created_at, updated_at)
SELECT
  w.id,
  COALESCE(p.max_members_per_workspace, fallback.max_members_per_workspace),
  COALESCE(p.max_file_bytes, fallback.max_file_bytes),
  COALESCE(p.slug, fallback.slug),
  NOW(),
  NOW(),
  NOW()
FROM workspaces w
LEFT JOIN subscriptions s ON s.user_id = w.created_by_id AND s.status = 'ACTIVE'
LEFT JOIN plans p ON p.id = s.plan_id
CROSS JOIN (SELECT max_members_per_workspace, max_file_bytes, slug FROM plans WHERE slug = 'personal') fallback
ON CONFLICT (workspace_id) DO NOTHING;
```

- [ ] **Step 6: Apply the migration**

Run: `pnpm --filter @repo/db exec prisma migrate dev`

Expected: migration applied, Prisma Client regenerated, no errors.

- [ ] **Step 7: Verify in DB**

Run: `pnpm --filter @repo/db exec prisma studio` (or `psql`):

```bash
psql "$DATABASE_URL" -c "SELECT slug, max_workspaces, max_members_per_workspace, max_file_bytes FROM plans ORDER BY sort_order;"
```

Expected output:

```
   slug   | max_workspaces | max_members_per_workspace | max_file_bytes
----------+----------------+---------------------------+----------------
 personal |              1 |                         1 |      524288000
 pro      |              3 |                         5 |     5368709120
 max      |             10 |                        20 |    21474836480
```

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add Plan.maxFileBytes + WorkspaceLimit table with backfill"
```

---

## Task 2: Update `seed.ts` with new plan values and feature bullets

**Files:**
- Modify: `packages/db/prisma/seed.ts:59-134`

- [ ] **Step 1: Add `maxFileBytes` and update bullets in plans array**

In `packages/db/prisma/seed.ts`, replace the `plans` array (lines 59-134) entirely with:

```ts
const plans = [
  {
    slug: 'personal',
    name: 'Персональный',
    description: 'Для личного пользования',
    priceMonthlyKopecks: 0,
    priceYearlyKopecks: 0,
    currency: 'RUB',
    maxWorkspaces: 1,
    maxMembersPerWorkspace: 1,
    maxFileBytes: BigInt(524_288_000),
    chatsEnabled: false,
    pageIndexingEnabled: false,
    membersSettingsEnabled: false,
    aiSettingsEnabled: false,
    customMcpEnabled: false,
    prioritySupport: false,
    developerSpaceEnabled: false,
    features: [
      '1 рабочее пространство',
      '1 участник',
      'До 500 МБ файлов',
      'Базовый редактор',
      'Без AI и индексации',
    ],
    sortOrder: 1,
    isActive: true,
  },
  {
    slug: 'pro',
    name: 'ПРО',
    description: 'Для продвинутых пользователей',
    priceMonthlyKopecks: 39_000,
    priceYearlyKopecks: 390_000,
    currency: 'RUB',
    maxWorkspaces: 3,
    maxMembersPerWorkspace: 5,
    maxFileBytes: BigInt(5_368_709_120),
    chatsEnabled: true,
    pageIndexingEnabled: true,
    membersSettingsEnabled: true,
    aiSettingsEnabled: true,
    customMcpEnabled: false,
    prioritySupport: false,
    developerSpaceEnabled: false,
    features: [
      '3 рабочих пространства',
      'До 5 участников в каждом',
      'До 5 ГБ файлов в каждом',
      'Чаты с AI',
      'Индексация страниц',
      'GigaChat-2 и GigaChat-2 Pro',
    ],
    sortOrder: 2,
    isActive: true,
  },
  {
    slug: 'max',
    name: 'МАКС',
    description: 'Для команд и больших задач',
    priceMonthlyKopecks: 590_000,
    priceYearlyKopecks: 5_900_000,
    currency: 'RUB',
    maxWorkspaces: 10,
    maxMembersPerWorkspace: 20,
    maxFileBytes: BigInt(21_474_836_480),
    chatsEnabled: true,
    pageIndexingEnabled: true,
    membersSettingsEnabled: true,
    aiSettingsEnabled: true,
    customMcpEnabled: true,
    prioritySupport: true,
    developerSpaceEnabled: true,
    features: [
      'До 10 рабочих пространств',
      'До 20 участников в каждом',
      'До 20 ГБ файлов в каждом',
      'Индексация страниц',
      'Собственные LLM-модели',
      'Кастомные MCP-серверы',
      'Приоритетная поддержка',
      'Доступ к пространству разработчиков',
    ],
    sortOrder: 3,
    isActive: true,
  },
] as const
```

- [ ] **Step 2: Run seed to verify**

Run: `pnpm --filter @repo/db exec prisma db seed`

Expected: `Seed complete: 5 providers, 3 active plans, ...`. No type errors.

- [ ] **Step 3: Sanity-check DB values**

Run:
```bash
psql "$DATABASE_URL" -c "SELECT slug, features FROM plans ORDER BY sort_order;"
```

Expected: each `features` JSON contains the new bullets (e.g., personal has `До 500 МБ файлов`, max has `До 10 рабочих пространств`).

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/seed.ts
git commit -m "feat(db): seed maxFileBytes + updated plan feature bullets"
```

---

## Task 3: Add `resolveActivePlanOrPersonal` and `syncWorkspaceLimits` helpers

**Files:**
- Modify: `packages/trpc/src/helpers/plan.ts`
- Create: `packages/trpc/test/workspace-limits.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/trpc/test/workspace-limits.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@repo/db'

import { syncWorkspaceLimits, resolveActivePlanOrPersonal } from '../src/helpers/plan'

const EMAIL_SUFFIX = '+wslimits-test@anynote.dev'

async function cleanFixtures() {
  await prisma.subscription.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.workspace.deleteMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.user.deleteMany({
    where: { email: { contains: EMAIL_SUFFIX } },
  })
}

async function makeOwner(label: string) {
  return prisma.user.create({
    data: {
      email: `${label}${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: label,
      firstName: label,
      lastName: 'Test',
    },
  })
}

async function makeWorkspace(ownerId: string, name = 'WS') {
  return prisma.workspace.create({
    data: { name, createdById: ownerId },
    select: { id: true },
  })
}

describe('resolveActivePlanOrPersonal', () => {
  beforeEach(cleanFixtures)

  it('returns personal plan when no active subscription', async () => {
    const owner = await makeOwner('a')
    const plan = await resolveActivePlanOrPersonal(prisma, owner.id)
    expect(plan.slug).toBe('personal')
  })

  it('returns the active subscription plan', async () => {
    const owner = await makeOwner('b')
    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    await prisma.subscription.create({
      data: { userId: owner.id, planId: pro.id, status: 'ACTIVE' },
    })
    const plan = await resolveActivePlanOrPersonal(prisma, owner.id)
    expect(plan.slug).toBe('pro')
  })
})

describe('syncWorkspaceLimits', () => {
  beforeEach(cleanFixtures)

  it('upserts limits from personal plan when owner has no subscription', async () => {
    const owner = await makeOwner('c')
    const ws = await makeWorkspace(owner.id)
    await syncWorkspaceLimits(prisma, owner.id)
    const limit = await prisma.workspaceLimit.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    expect(limit.sourcePlanSlug).toBe('personal')
    expect(limit.maxMembers).toBe(1)
    expect(limit.maxFileBytes).toBe(524_288_000n)
  })

  it('updates existing limits when plan changes', async () => {
    const owner = await makeOwner('d')
    const ws = await makeWorkspace(owner.id)
    await syncWorkspaceLimits(prisma, owner.id)

    const max = await prisma.plan.findUniqueOrThrow({ where: { slug: 'max' } })
    await prisma.subscription.create({
      data: { userId: owner.id, planId: max.id, status: 'ACTIVE' },
    })
    await syncWorkspaceLimits(prisma, owner.id)

    const limit = await prisma.workspaceLimit.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    expect(limit.sourcePlanSlug).toBe('max')
    expect(limit.maxMembers).toBe(20)
    expect(limit.maxFileBytes).toBe(21_474_836_480n)
  })

  it('applies the same plan to multiple workspaces of the owner', async () => {
    const owner = await makeOwner('e')
    const ws1 = await makeWorkspace(owner.id, 'WS1')
    const ws2 = await makeWorkspace(owner.id, 'WS2')
    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    await prisma.subscription.create({
      data: { userId: owner.id, planId: pro.id, status: 'ACTIVE' },
    })
    await syncWorkspaceLimits(prisma, owner.id)
    const rows = await prisma.workspaceLimit.findMany({
      where: { workspaceId: { in: [ws1.id, ws2.id] } },
    })
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.sourcePlanSlug).toBe('pro')
      expect(r.maxMembers).toBe(5)
      expect(r.maxFileBytes).toBe(5_368_709_120n)
    }
  })

  it('is idempotent — calling twice yields the same result', async () => {
    const owner = await makeOwner('f')
    const ws = await makeWorkspace(owner.id)
    await syncWorkspaceLimits(prisma, owner.id)
    const first = await prisma.workspaceLimit.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    await syncWorkspaceLimits(prisma, owner.id)
    const second = await prisma.workspaceLimit.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    expect(second.maxMembers).toBe(first.maxMembers)
    expect(second.maxFileBytes).toBe(first.maxFileBytes)
  })
})
```

- [ ] **Step 2: Run tests, see them fail**

Run: `pnpm --filter @repo/trpc test workspace-limits`

Expected: `resolveActivePlanOrPersonal is not a function` / `syncWorkspaceLimits is not a function` failures.

- [ ] **Step 3: Implement the helpers**

In `packages/trpc/src/helpers/plan.ts`, add imports at top:

```ts
import type { Prisma } from '@repo/db'
```

(if `Prisma` is not already imported; check existing imports first.)

At the bottom of the file, append:

```ts
type TxClient = PrismaClient | Prisma.TransactionClient

export async function resolveActivePlanOrPersonal(tx: TxClient, userId: string): Promise<Plan> {
  const sub = await tx.subscription.findFirst({
    where: { userId, status: 'ACTIVE' },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  })
  return sub?.plan ?? (await tx.plan.findUniqueOrThrow({ where: { slug: 'personal' } }))
}

export async function syncWorkspaceLimits(tx: TxClient, userId: string): Promise<void> {
  const plan = await resolveActivePlanOrPersonal(tx, userId)
  const workspaces = await tx.workspace.findMany({
    where: { createdById: userId },
    select: { id: true },
  })
  if (workspaces.length === 0) return
  const now = new Date()
  await Promise.all(
    workspaces.map((w) =>
      tx.workspaceLimit.upsert({
        where: { workspaceId: w.id },
        create: {
          workspaceId: w.id,
          maxMembers: plan.maxMembersPerWorkspace,
          maxFileBytes: plan.maxFileBytes,
          sourcePlanSlug: plan.slug,
          syncedAt: now,
        },
        update: {
          maxMembers: plan.maxMembersPerWorkspace,
          maxFileBytes: plan.maxFileBytes,
          sourcePlanSlug: plan.slug,
          syncedAt: now,
        },
      }),
    ),
  )
}
```

- [ ] **Step 4: Run tests, see them pass**

Run: `pnpm --filter @repo/trpc test workspace-limits`

Expected: all 5 tests pass.

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter @repo/trpc check-types`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/trpc/src/helpers/plan.ts packages/trpc/test/workspace-limits.test.ts
git commit -m "feat(trpc): add resolveActivePlanOrPersonal + syncWorkspaceLimits helpers"
```

---

## Task 4: Sync limits on `workspace.create`

**Files:**
- Modify: `packages/trpc/src/routers/workspace.ts:34-71`

- [ ] **Step 1: Update the import**

In `packages/trpc/src/routers/workspace.ts:7`, change:

```ts
import { getActivePlanForUser, getPlanDisplayName, requireWritableWorkspace } from '../helpers/plan'
```

to:

```ts
import {
  getActivePlanForUser,
  getPlanDisplayName,
  requireWritableWorkspace,
  syncWorkspaceLimits,
} from '../helpers/plan'
```

- [ ] **Step 2: Call `syncWorkspaceLimits` inside the create transaction**

In `workspace.ts:56-70` (the `create` mutation transaction body), after `seedStartPage(...)` and before `return { ...workspace, startPageId: pageId }`, add:

```ts
        await syncWorkspaceLimits(tx, ctx.user.id)
```

The block now looks like:

```ts
return ctx.prisma.$transaction(async (tx) => {
  const workspace = await tx.workspace.create({
    data: { name: input.name, icon: input.icon, createdById: ctx.user.id },
  })
  await tx.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: ctx.user.id, role: 'OWNER' },
  })
  await tx.userPreference.upsert({
    where: { userId: ctx.user.id },
    create: { userId: ctx.user.id, defaultWorkspaceId: workspace.id },
    update: { defaultWorkspaceId: workspace.id },
  })
  const { pageId } = await seedStartPage(tx, workspace.id, ctx.user.id)
  await syncWorkspaceLimits(tx, ctx.user.id)
  return { ...workspace, startPageId: pageId }
})
```

- [ ] **Step 3: Add a test for limit creation on workspace.create**

In `packages/trpc/test/workspace-limits.test.ts`, append a new `describe`:

```ts
import { workspaceRouter } from '../src/routers/workspace'
import { createCallerFactory } from '../src/trpc'

describe('workspace.create wires limits', () => {
  beforeEach(cleanFixtures)

  it('creates a WorkspaceLimit row from the owner plan', async () => {
    const owner = await makeOwner('g')
    const caller = createCallerFactory(workspaceRouter)({
      prisma,
      user: { id: owner.id, email: owner.email },
      headers: new Headers(),
      resHeaders: new Headers(),
      yookassa: {} as never,
      returnUrlBase: 'http://localhost:3000',
    })
    const ws = await caller.create({ name: 'TestWS' })
    const limit = await prisma.workspaceLimit.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    expect(limit.sourcePlanSlug).toBe('personal')
    expect(limit.maxMembers).toBe(1)
  })
})
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @repo/trpc test workspace-limits`

Expected: all tests including the new `workspace.create wires limits` pass.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/workspace.ts packages/trpc/test/workspace-limits.test.ts
git commit -m "feat(trpc): sync workspace limits on workspace.create"
```

---

## Task 5: Sync limits on billing transitions (`handlePaymentSucceeded`, `handleRefundSucceeded`)

**Files:**
- Modify: `packages/trpc/src/services/billing.ts`

- [ ] **Step 1: Import the helper**

At the top of `packages/trpc/src/services/billing.ts`, add:

```ts
import { syncWorkspaceLimits } from '../helpers/plan'
```

- [ ] **Step 2: Call sync inside `handlePaymentSucceeded` transaction**

In `billing.ts`, inside `handlePaymentSucceeded` transaction (after `tx.order.update(...)` ~line 66), add:

```ts
    await syncWorkspaceLimits(tx, order.userId)
```

The transaction block now ends as:

```ts
await tx.order.update({
  where: { id: order.id },
  data: {
    status: 'PAID',
    paidAt: now,
    subscriptionId: subscription.id,
    savedPaymentMethod: verified.payment_method?.saved ?? false,
  },
})
await syncWorkspaceLimits(tx, order.userId)
```

- [ ] **Step 3: Call sync inside `handleRefundSucceeded` transaction**

In `handleRefundSucceeded`, after `tx.subscription.update(...)` (~line 96), add:

```ts
      await syncWorkspaceLimits(tx, order.userId)
```

Wrap it inside the `if (order.subscriptionId)` block:

```ts
if (order.subscriptionId) {
  await tx.subscription.update({
    where: { id: order.subscriptionId },
    data: { status: 'EXPIRED', expiredAt: new Date(), currentPeriodEnd: new Date() },
  })
  await syncWorkspaceLimits(tx, order.userId)
}
```

- [ ] **Step 4: Add a test**

Append to `packages/trpc/test/workspace-limits.test.ts`:

```ts
import { handlePaymentSucceeded, handleRefundSucceeded } from '../src/services/billing'

describe('billing transitions sync limits', () => {
  beforeEach(cleanFixtures)

  async function setupOrderAndPayment(ownerId: string, planSlug: 'pro' | 'max') {
    const plan = await prisma.plan.findUniqueOrThrow({ where: { slug: planSlug } })
    const order = await prisma.order.create({
      data: {
        userId: ownerId,
        planId: plan.id,
        billingPeriod: 'MONTHLY',
        amountKopecks: plan.priceMonthlyKopecks,
        currency: 'RUB',
        status: 'PENDING',
        isInitial: true,
        yookassaIdempotencyKey: `idem-${ownerId}-${Date.now()}`,
        yookassaPaymentId: `pay-${ownerId}-${Date.now()}`,
      },
    })
    return { order, plan }
  }

  it('handlePaymentSucceeded upgrades limits on owned workspaces', async () => {
    const owner = await makeOwner('h')
    const ws = await makeWorkspace(owner.id)
    await syncWorkspaceLimits(prisma, owner.id) // start at personal

    const { order } = await setupOrderAndPayment(owner.id, 'max')
    const fakeYookassa = {
      getPayment: async () => ({
        id: order.yookassaPaymentId!,
        status: 'succeeded' as const,
        payment_method: undefined,
      }),
    }
    await handlePaymentSucceeded(
      { yookassa: fakeYookassa, prisma },
      { id: order.yookassaPaymentId!, status: 'succeeded' } as never,
    )

    const limit = await prisma.workspaceLimit.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    expect(limit.sourcePlanSlug).toBe('max')
    expect(limit.maxFileBytes).toBe(21_474_836_480n)
  })

  it('handleRefundSucceeded downgrades limits to personal', async () => {
    const owner = await makeOwner('i')
    const ws = await makeWorkspace(owner.id)
    const max = await prisma.plan.findUniqueOrThrow({ where: { slug: 'max' } })
    const sub = await prisma.subscription.create({
      data: { userId: owner.id, planId: max.id, status: 'ACTIVE' },
    })
    await syncWorkspaceLimits(prisma, owner.id) // start at max
    const order = await prisma.order.create({
      data: {
        userId: owner.id,
        planId: max.id,
        subscriptionId: sub.id,
        billingPeriod: 'MONTHLY',
        amountKopecks: max.priceMonthlyKopecks,
        currency: 'RUB',
        status: 'PAID',
        yookassaIdempotencyKey: `idem-r-${owner.id}-${Date.now()}`,
        yookassaPaymentId: `pay-r-${owner.id}-${Date.now()}`,
      },
    })
    await handleRefundSucceeded(
      { yookassa: { getPayment: async () => ({}) as never }, prisma },
      { id: `refund-${owner.id}`, payment_id: order.yookassaPaymentId!, status: 'succeeded' } as never,
    )
    const limit = await prisma.workspaceLimit.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    expect(limit.sourcePlanSlug).toBe('personal')
    expect(limit.maxFileBytes).toBe(524_288_000n)
  })
})
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @repo/trpc test workspace-limits`

Expected: new billing tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/trpc/src/services/billing.ts packages/trpc/test/workspace-limits.test.ts
git commit -m "feat(trpc): sync workspace limits in handlePaymentSucceeded and handleRefundSucceeded"
```

---

## Task 6: Sync limits in engines subscription-renewal flow

**Files:**
- Modify: `apps/engines/src/apps/billing/services/subscription-renewal.service.ts`

- [ ] **Step 1: Open the file and locate `expireCanceled`**

The method (around line ~31) calls `prisma.subscription.updateMany` with `status: 'EXPIRED'`. We need to sync limits for each affected user.

- [ ] **Step 2: Modify `expireCanceled` to find affected users first and then sync**

Replace the body of `expireCanceled` with:

```ts
async expireCanceled(): Promise<void> {
  const now = new Date()
  const affected = await prisma.subscription.findMany({
    where: {
      status: 'ACTIVE',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: { not: null, lte: now },
    },
    select: { id: true, userId: true },
  })
  if (affected.length === 0) return

  await prisma.subscription.updateMany({
    where: { id: { in: affected.map((s) => s.id) } },
    data: { status: 'EXPIRED', expiredAt: now },
  })

  const { syncWorkspaceLimits } = await import('@repo/trpc/helpers/plan')
  const uniqueUserIds = Array.from(new Set(affected.map((s) => s.userId)))
  await Promise.all(uniqueUserIds.map((userId) => syncWorkspaceLimits(prisma, userId)))
}
```

> **Note:** dynamic import is used to avoid a circular workspace dep at compile time if `@repo/trpc/helpers/plan` is not in `dependencies` of the engines package. If TypeScript resolves it cleanly with a static import, prefer that; revert to static `import { syncWorkspaceLimits } from '@repo/trpc/helpers/plan'` at top.

- [ ] **Step 3: Update package exports if needed**

Run:

```bash
node -e "const p = require('./packages/trpc/package.json'); console.log(JSON.stringify(p.exports, null, 2));"
```

If `./helpers/plan` is not exported, edit `packages/trpc/package.json` and add to `exports`:

```json
    "./helpers/plan": {
      "types": "./src/helpers/plan.ts",
      "default": "./src/helpers/plan.ts"
    }
```

Run `pnpm install` if package.json was modified.

- [ ] **Step 4: Run engines typecheck**

Run: `pnpm --filter engines check-types`

Expected: no errors.

- [ ] **Step 5: Run engines tests**

Run: `pnpm --filter engines test`

Expected: existing `subscription-renewal.service.spec.ts` still passes (no behavioral change for tests that pass empty `affected`).

- [ ] **Step 6: Commit**

```bash
git add apps/engines/src/apps/billing/services/subscription-renewal.service.ts packages/trpc/package.json
git commit -m "feat(engines): sync workspace limits when subscriptions expire on cancel"
```

---

## Task 7: Enforce member limit in `inviteMember`

**Files:**
- Modify: `packages/trpc/src/routers/workspace.ts:145-191`

- [ ] **Step 1: Add the check before creating the member**

In `inviteMember` mutation, after `await assertPaidPlan(ctx)` (line ~156) and before `const user = await ctx.prisma.user.findUnique(...)`, insert:

```ts
      const [memberCount, limits] = await Promise.all([
        ctx.prisma.workspaceMember.count({ where: { workspaceId: input.workspaceId } }),
        ctx.prisma.workspaceLimit.findUnique({ where: { workspaceId: input.workspaceId } }),
      ])
      if (limits && memberCount >= limits.maxMembers) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `Достигнут лимит участников (${limits.maxMembers}). Повысьте тариф или удалите участников.`,
        })
      }
```

- [ ] **Step 2: Write a regression test**

In `packages/trpc/test/workspace-limits.test.ts`, append:

```ts
describe('inviteMember enforces member limit', () => {
  beforeEach(cleanFixtures)

  it('rejects invite when memberCount >= maxMembers', async () => {
    const owner = await makeOwner('j')
    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    await prisma.subscription.create({
      data: { userId: owner.id, planId: pro.id, status: 'ACTIVE' },
    })
    const caller = createCallerFactory(workspaceRouter)({
      prisma,
      user: { id: owner.id, email: owner.email },
      headers: new Headers(),
      resHeaders: new Headers(),
      yookassa: {} as never,
      returnUrlBase: 'http://localhost:3000',
    })
    const ws = await caller.create({ name: 'WS' }) // OWNER counts as 1
    // Fill up to maxMembers (5) — add 4 more
    for (let i = 0; i < 4; i++) {
      const u = await prisma.user.create({
        data: {
          email: `inv${i}${EMAIL_SUFFIX}`,
          emailVerified: true,
          name: `Inv${i}`,
          firstName: `Inv${i}`,
          lastName: 'T',
        },
      })
      await prisma.workspaceMember.create({
        data: { workspaceId: ws.id, userId: u.id, role: 'EDITOR' },
      })
    }
    const extra = await prisma.user.create({
      data: {
        email: `extra${EMAIL_SUFFIX}`,
        emailVerified: true,
        name: 'Extra',
        firstName: 'Extra',
        lastName: 'T',
      },
    })
    await expect(
      caller.inviteMember({ workspaceId: ws.id, email: extra.email, role: 'EDITOR' }),
    ).rejects.toThrow(/Достигнут лимит участников/)
  })
})
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @repo/trpc test workspace-limits`

Expected: new test passes; existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add packages/trpc/src/routers/workspace.ts packages/trpc/test/workspace-limits.test.ts
git commit -m "feat(trpc): enforce member limit in workspace.inviteMember"
```

---

## Task 8: Enforce storage limit in upload route

**Files:**
- Modify: `apps/web/src/app/api/files/upload/route.ts`

- [ ] **Step 1: Add the storage check between validateUpload and hash computation**

In `apps/web/src/app/api/files/upload/route.ts`, locate the block (around line 67) right after `if (validationError) { return ... }` and before `const hash = createHash('sha256').update(bytes).digest('hex')`. Insert this new block:

```ts
  if (kind === 'attachment') {
    const [usage, limits] = await Promise.all([
      prisma.file.aggregate({
        where: { workspaceId: workspaceIdParam!, status: FileStatus.ACTIVE },
        _sum: { fileSize: true },
      }),
      prisma.workspaceLimit.findUnique({ where: { workspaceId: workspaceIdParam! } }),
    ])
    if (!limits) {
      return Response.json({ error: 'WORKSPACE_LIMIT_MISSING' }, { status: 500 })
    }
    const used = usage._sum.fileSize ?? 0n
    if (used + BigInt(bytes.length) > limits.maxFileBytes) {
      return Response.json(
        { error: 'WORKSPACE_STORAGE_LIMIT', maxBytes: limits.maxFileBytes.toString() },
        { status: 413 },
      )
    }
  }
```

Leave the rest of the file untouched (membership check above stays exactly as it is; hash/storage put below stays exactly as it is).

- [ ] **Step 2: Verify by re-reading the file**

Open `apps/web/src/app/api/files/upload/route.ts` and ensure the new block sits between `if (validationError)` and `const hash = createHash(...)`. Membership check stays on top; only one `formData` extraction; only one `validateUpload` call.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web check-types`

Expected: no errors.

- [ ] **Step 4: Smoke check via curl (optional, requires running dev)**

If `pnpm dev` is running locally:

```bash
# Upload a small file (should succeed)
curl -X POST "http://localhost:3000/api/files/upload?kind=attachment&workspaceId=<some-ws-id>" \
  -H "Cookie: ..." -F "file=@/path/to/small.txt"
# Expected: 200 with file JSON
```

Skip if no convenient dev session.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/files/upload/route.ts
git commit -m "feat(web): enforce workspace storage limit on file upload"
```

---

## Task 9: Add `workspace.getUsage` tRPC procedure

**Files:**
- Modify: `packages/trpc/src/routers/workspace.ts`
- Create: `packages/trpc/test/workspace-usage.test.ts`

- [ ] **Step 1: Add the procedure**

In `packages/trpc/src/routers/workspace.ts`, import `FileStatus`:

At top of file, with existing imports, add:

```ts
import { FileStatus } from '@repo/db'
```

Also extend the import from `../helpers/plan`:

```ts
import {
  getActivePlanForUser,
  getPlanDisplayName,
  requireWritableWorkspace,
  resolveActivePlanOrPersonal,
  syncWorkspaceLimits,
} from '../helpers/plan'
```

Inside `workspaceRouter`, add a new procedure (place it after `listMembers`):

```ts
  getUsage: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertRole(ctx, input.workspaceId, [
        'OWNER',
        'ADMIN',
        'EDITOR',
        'COMMENTER',
        'VIEWER',
        'GUEST',
      ])
      const [limits, memberCount, agg, workspace] = await Promise.all([
        ctx.prisma.workspaceLimit.findUnique({ where: { workspaceId: input.workspaceId } }),
        ctx.prisma.workspaceMember.count({ where: { workspaceId: input.workspaceId } }),
        ctx.prisma.file.aggregate({
          where: { workspaceId: input.workspaceId, status: FileStatus.ACTIVE },
          _sum: { fileSize: true },
        }),
        ctx.prisma.workspace.findUniqueOrThrow({
          where: { id: input.workspaceId },
          select: { createdById: true },
        }),
      ])
      if (!limits) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'WORKSPACE_LIMIT_MISSING',
        })
      }
      const ownerPlan = workspace.createdById
        ? await resolveActivePlanOrPersonal(ctx.prisma, workspace.createdById)
        : await ctx.prisma.plan.findUniqueOrThrow({ where: { slug: 'personal' } })
      return {
        limits: {
          maxMembers: limits.maxMembers,
          maxFileBytes: limits.maxFileBytes.toString(),
          sourcePlanSlug: limits.sourcePlanSlug,
        },
        usage: {
          memberCount,
          fileBytesUsed: (agg._sum.fileSize ?? 0n).toString(),
        },
        ownerPlanSlug: ownerPlan.slug,
      }
    }),
```

- [ ] **Step 2: Write a test**

Create `packages/trpc/test/workspace-usage.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@repo/db'

import { workspaceRouter } from '../src/routers/workspace'
import { createCallerFactory } from '../src/trpc'
import { syncWorkspaceLimits } from '../src/helpers/plan'

const EMAIL_SUFFIX = '+wsusage-test@anynote.dev'

async function cleanFixtures() {
  await prisma.file.deleteMany({ where: { user: { email: { contains: EMAIL_SUFFIX } } } })
  await prisma.subscription.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.workspace.deleteMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

function makeCaller(userId: string, email: string) {
  return createCallerFactory(workspaceRouter)({
    prisma,
    user: { id: userId, email },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost:3000',
  })
}

describe('workspace.getUsage', () => {
  beforeEach(cleanFixtures)

  it('returns limits, usage, and ownerPlanSlug for personal owner', async () => {
    const owner = await prisma.user.create({
      data: {
        email: `o${EMAIL_SUFFIX}`,
        emailVerified: true,
        name: 'O',
        firstName: 'O',
        lastName: 'T',
      },
    })
    const caller = makeCaller(owner.id, owner.email)
    const ws = await caller.create({ name: 'WS' })

    const result = await caller.getUsage({ workspaceId: ws.id })
    expect(result.limits.maxMembers).toBe(1)
    expect(result.limits.maxFileBytes).toBe('524288000')
    expect(result.usage.memberCount).toBe(1)
    expect(result.usage.fileBytesUsed).toBe('0')
    expect(result.ownerPlanSlug).toBe('personal')
  })

  it('reflects file usage from ACTIVE files only', async () => {
    const owner = await prisma.user.create({
      data: {
        email: `f${EMAIL_SUFFIX}`,
        emailVerified: true,
        name: 'F',
        firstName: 'F',
        lastName: 'T',
      },
    })
    const caller = makeCaller(owner.id, owner.email)
    const ws = await caller.create({ name: 'WS' })

    await prisma.file.create({
      data: {
        userId: owner.id,
        workspaceId: ws.id,
        name: 'a.txt',
        ext: 'txt',
        fileSize: 1000n,
        mimeType: 'text/plain',
        hash: 'h1',
        path: 'p1',
        status: 'ACTIVE',
      },
    })
    await prisma.file.create({
      data: {
        userId: owner.id,
        workspaceId: ws.id,
        name: 'b.txt',
        ext: 'txt',
        fileSize: 999n,
        mimeType: 'text/plain',
        hash: 'h2',
        path: 'p2',
        status: 'DELETED',
      },
    })

    const result = await caller.getUsage({ workspaceId: ws.id })
    expect(result.usage.fileBytesUsed).toBe('1000')
  })
})
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @repo/trpc test workspace-usage`

Expected: both tests pass.

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter @repo/trpc check-types`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/workspace.ts packages/trpc/test/workspace-usage.test.ts
git commit -m "feat(trpc): add workspace.getUsage procedure"
```

---

## Task 10: Add `formatBytes` utility

**Files:**
- Create: `apps/web/src/lib/format-bytes.ts`
- Create: `apps/web/test/format-bytes.test.ts`

- [ ] **Step 1: Write the test**

Create `apps/web/test/format-bytes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

import { formatBytes } from '@/lib/format-bytes'

describe('formatBytes', () => {
  it('formats bytes under 1KB as Б', () => {
    expect(formatBytes(0)).toBe('0 Б')
    expect(formatBytes(1023)).toBe('1023 Б')
  })

  it('formats KB', () => {
    expect(formatBytes(1024)).toBe('1.0 КБ')
    expect(formatBytes(2048)).toBe('2.0 КБ')
  })

  it('formats MB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 МБ')
    expect(formatBytes(524_288_000)).toBe('500.0 МБ')
  })

  it('formats GB', () => {
    expect(formatBytes(1024 ** 3)).toBe('1.0 ГБ')
    expect(formatBytes(5_368_709_120)).toBe('5.0 ГБ')
  })

  it('accepts BigInt', () => {
    expect(formatBytes(21_474_836_480n)).toBe('20.0 ГБ')
  })

  it('honors fractionDigits', () => {
    expect(formatBytes(1536, 2)).toBe('1.50 КБ')
  })
})
```

- [ ] **Step 2: Run test, see it fail**

Run: `pnpm --filter web test format-bytes`

Expected: `Cannot find module '@/lib/format-bytes'`.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/format-bytes.ts`:

```ts
export function formatBytes(bytes: bigint | number, fractionDigits = 1): string {
  const n = typeof bytes === 'bigint' ? Number(bytes) : bytes
  if (n < 1024) return `${n} Б`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(fractionDigits)} КБ`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(fractionDigits)} МБ`
  return `${(n / 1024 ** 3).toFixed(fractionDigits)} ГБ`
}
```

- [ ] **Step 4: Run test, see it pass**

Run: `pnpm --filter web test format-bytes`

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/format-bytes.ts apps/web/test/format-bytes.test.ts
git commit -m "feat(web): add formatBytes utility"
```

---

## Task 11: Build `UsageSection` client component

**Files:**
- Create: `apps/web/src/components/workspace/settings/usage-section.tsx`

- [ ] **Step 1: Create the file**

Create `apps/web/src/components/workspace/settings/usage-section.tsx`:

```tsx
'use client'

import { Alert, Button, LinearProgress, Paper, Stack, Typography } from '@repo/ui/components'

import { formatBytes } from '@/lib/format-bytes'

type Props = {
  limits: {
    maxMembers: number
    maxFileBytes: string
    sourcePlanSlug: string | null
  }
  usage: {
    memberCount: number
    fileBytesUsed: string
  }
  ownerPlanSlug: string
}

function clampPercent(used: number, max: number): number {
  if (max <= 0) return 100
  return Math.min(100, Math.max(0, (used / max) * 100))
}

function progressColor(percent: number): 'primary' | 'warning' | 'error' {
  if (percent >= 100) return 'error'
  if (percent >= 80) return 'warning'
  return 'primary'
}

export function UsageSection({ limits, usage, ownerPlanSlug }: Props) {
  const maxBytes = BigInt(limits.maxFileBytes)
  const usedBytes = BigInt(usage.fileBytesUsed)
  const bytesPercent = clampPercent(Number(usedBytes), Number(maxBytes))
  const memberPercent = clampPercent(usage.memberCount, limits.maxMembers)
  const remainingMembers = Math.max(0, limits.maxMembers - usage.memberCount)
  const overMembers = usage.memberCount >= limits.maxMembers
  const overBytes = usedBytes >= maxBytes
  const showOverLimit = overMembers || overBytes
  const canUpgrade = ownerPlanSlug !== 'max'

  return (
    <Stack spacing={2.5}>
      <Typography variant="h6">Использование</Typography>

      {showOverLimit ? (
        <Alert
          severity="error"
          action={
            canUpgrade ? (
              <Button color="inherit" size="small" href="/pricing">
                Повысить тариф
              </Button>
            ) : (
              <Button color="inherit" size="small" href="mailto:anynote@yandex.ru">
                Связаться
              </Button>
            )
          }
        >
          Достигнут лимит. Удалите ненужные файлы или участников
          {canUpgrade ? ' либо перейдите на старший тариф.' : ' либо свяжитесь с администрацией.'}
        </Alert>
      ) : null}

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={1.5}>
          <Stack direction="row" justifyContent="space-between" alignItems="baseline">
            <Typography variant="subtitle1" fontWeight={600}>
              Участники
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {usage.memberCount} из {limits.maxMembers}
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={memberPercent}
            color={progressColor(memberPercent)}
            sx={{ height: 8, borderRadius: 4 }}
          />
          <Typography variant="caption" color="text.secondary">
            {overMembers
              ? 'Лимит исчерпан. Новые приглашения заблокированы.'
              : `Доступно ещё ${remainingMembers} ${
                  remainingMembers === 1 ? 'приглашение' : 'приглашений'
                }.`}
          </Typography>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={1.5}>
          <Stack direction="row" justifyContent="space-between" alignItems="baseline">
            <Typography variant="subtitle1" fontWeight={600}>
              Хранилище файлов
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {formatBytes(usedBytes)} из {formatBytes(maxBytes)}
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={bytesPercent}
            color={progressColor(bytesPercent)}
            sx={{ height: 8, borderRadius: 4 }}
          />
          <Typography variant="caption" color="text.secondary">
            {overBytes
              ? 'Лимит хранилища исчерпан. Новые загрузки заблокированы.'
              : `Использовано ${bytesPercent.toFixed(0)}% доступного объёма.`}
          </Typography>
        </Stack>
      </Paper>
    </Stack>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web check-types`

Expected: no errors.

- [ ] **Step 3: Verify LinearProgress is exported from `@repo/ui/components`**

Run:

```bash
grep -n "LinearProgress" packages/ui/src/components/index.ts
```

If not exported, add to `packages/ui/src/components/index.ts`:

```ts
export { default as LinearProgress } from '@mui/material/LinearProgress'
```

Then run `pnpm --filter web check-types` again.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/workspace/settings/usage-section.tsx packages/ui/src/components/index.ts
git commit -m "feat(web): add UsageSection component for workspace settings"
```

---

## Task 12: Add usage RSC page + settings nav item

**Files:**
- Create: `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/usage/page.tsx`
- Modify: `apps/web/src/components/workspace/workspace-settings-nav.tsx`

- [ ] **Step 1: Create the RSC page**

Create `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/usage/page.tsx`:

```tsx
import { notFound } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'
import { UsageSection } from '@/components/workspace/settings/usage-section'

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceUsagePage({ params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()
  const usage = await trpc.workspace.getUsage({ workspaceId })
  return <UsageSection {...usage} />
}
```

- [ ] **Step 2: Add nav item**

In `apps/web/src/components/workspace/workspace-settings-nav.tsx:14-20`, change the `items` array to include `usage`:

```ts
  const items = [
    { label: 'Общее', slug: 'general', show: true },
    { label: 'Участники', slug: 'members', show: true },
    { label: 'AI агент', slug: 'ai', show: true },
    { label: 'Файлы', slug: 'files', show: true },
    { label: 'Использование', slug: 'usage', show: true },
    { label: 'Опасная зона', slug: 'danger', show: true },
  ].filter((item) => item.show)
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web check-types`

Expected: no errors.

- [ ] **Step 4: Smoke-test in browser**

Run: `pnpm dev` (if not running already). Navigate to `http://localhost:3000/workspaces/{any-ws-id}/settings/usage`.

Expected: page renders with two `LinearProgress` bars, "Использование" link active in left nav.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(protected\)/workspaces/\[workspaceId\]/settings/usage/page.tsx \
        apps/web/src/components/workspace/workspace-settings-nav.tsx
git commit -m "feat(web): add /settings/usage page with limits + nav entry"
```

---

## Task 13: Update PublicOffer.md and bump consent version

**Files:**
- Modify: `docs/terms/PublicOffer.md`
- Modify: `apps/web/src/lib/legal-documents.ts`

- [ ] **Step 1: Update redaction date**

In `docs/terms/PublicOffer.md` line 5, change:

```
Редакция от 04 мая 2026 г.
```

to:

```
Редакция от 27 мая 2026 г.
```

- [ ] **Step 2: Update tariff table (lines 337-339)**

Replace lines 337-339 with:

```markdown
| Персональный                             | Бесплатно     | 1 рабочее пространство; 1 участник; до 500 МБ файлов в пространстве; базовый редактор; стартовое использование без банковской карты; ограничения по функциям и лимитам могут указываться в интерфейсе.                   |
| PRO                                      | от 390 ₽/мес  | 3 рабочих пространства; до 5 участников в каждом; до 5 ГБ файлов в каждом пространстве; чаты с ИИ; индексация материалов; дополнительные лимиты определяются интерфейсом/счетом.                                         |
| MAX                                      | от 5900 ₽/мес | до 10 рабочих пространств; до 20 участников в каждом; до 20 ГБ файлов в каждом пространстве; индексация страниц; собственные LLM-модели; MCP-серверы и расширенные возможности.                                          |
```

- [ ] **Step 3: Bump public-offer version**

In `apps/web/src/lib/legal-documents.ts`, locate the `public-offer` entry (~line 77) and change `version: '2026-05-04'` to:

```ts
    version: '2026-05-27',
```

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm --filter web check-types`

Expected: no errors.

```bash
git add docs/terms/PublicOffer.md apps/web/src/lib/legal-documents.ts
git commit -m "docs(terms): update PublicOffer tariff limits; bump public-offer to 2026-05-27"
```

---

## Task 14: E2E test for usage page

**Files:**
- Create: `apps/e2e/workspace-usage.spec.ts`

- [ ] **Step 1: Write the test**

Create `apps/e2e/workspace-usage.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

test('workspace usage page renders limits for personal user', async ({ page }) => {
  const { workspaceId } = await signUpAndAuthAs(page, {
    emailSuffix: '+usage-e2e',
  })

  await page.goto(`/workspaces/${workspaceId}/settings/usage`)
  await expect(page.getByText('Использование', { exact: true }).first()).toBeVisible()

  // Member card
  await expect(page.getByText('Участники')).toBeVisible()
  await expect(page.getByText(/1 из 1/)).toBeVisible()

  // Storage card
  await expect(page.getByText('Хранилище файлов')).toBeVisible()
  await expect(page.getByText(/0 .* из 500\.0 МБ/)).toBeVisible()

  // LinearProgress bars
  const progressBars = page.locator('[role="progressbar"]')
  await expect(progressBars).toHaveCount(2)
})

test('settings nav contains usage link', async ({ page }) => {
  const { workspaceId } = await signUpAndAuthAs(page, {
    emailSuffix: '+usage-nav-e2e',
  })
  await page.goto(`/workspaces/${workspaceId}/settings/general`)
  await page.getByRole('link', { name: 'Использование' }).click()
  await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/settings/usage$`))
})
```

- [ ] **Step 2: Verify `signUpAndAuthAs` returns workspaceId**

Run:

```bash
grep -A20 "export async function signUpAndAuthAs" apps/e2e/helpers/auth.ts | head -40
```

If the helper does not currently return `{ workspaceId }`, add it: after sign-up, query the user's default workspace via Prisma or tRPC and return it. The exact shape will determine how to adjust the test.

If the helper returns just the user, adapt the test:

```ts
const { user } = await signUpAndAuthAs(page, { emailSuffix: '+usage-e2e' })
const wsRow = await prisma.workspace.findFirstOrThrow({
  where: { createdById: user.id },
  select: { id: true },
})
const workspaceId = wsRow.id
```

(Import `prisma` from `@repo/db` in the spec.)

- [ ] **Step 3: Run the test**

Run: `pnpm exec playwright test apps/e2e/workspace-usage.spec.ts`

Expected: both tests pass on first run (allow retries — see `feedback_e2e_cold_compile_retries`).

- [ ] **Step 4: Commit**

```bash
git add apps/e2e/workspace-usage.spec.ts
git commit -m "test(e2e): workspace usage page renders limits + nav link works"
```

---

## Task 15: Final gates

- [ ] **Step 1: Run the full merge gate**

Run: `pnpm gates`

Expected: lint clean, typecheck clean, build green, all tests pass.

If anything fails:

- Re-run with `--filter <failing-package>` to narrow down.
- Address fixture cleanup conflicts (different `EMAIL_SUFFIX` per test file).
- Address any flaky E2E — re-run with `pnpm exec playwright test --retries=2`.

- [ ] **Step 2: Manual smoke**

In a running dev session:

1. Open `/workspaces/{id}/settings/usage` — verify both progress bars.
2. Try `POST /api/files/upload?kind=attachment&workspaceId=<wsId>` with a file > current quota (manipulate `workspace_limits.max_file_bytes` via psql to a small number temporarily) — expect HTTP 413 `WORKSPACE_STORAGE_LIMIT`.
3. Try inviting a member when at the cap — expect tRPC error `Достигнут лимит участников`.

- [ ] **Step 3: Confirm no lingering changes**

Run: `git status`

Expected: clean working tree (except `MEMORY.md` if running auto-memory).

---

## Out-of-scope

- Notifications at 80% threshold (deliberately deferred — current spec covers visual warning only).
- Workspace ownership transfer + limit re-sync on transfer.
- Per-user dashboard showing aggregate usage across all owned workspaces.
- Backfill stale `WorkspaceLimit` rows for workspaces whose owner's plan changed but who never triggered a sync (the migration backfill handles initial state; ongoing drift only occurs via subscription transitions, all of which call `syncWorkspaceLimits`).
