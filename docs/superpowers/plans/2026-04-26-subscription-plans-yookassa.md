# Subscription Plans (Personal/Pro/Max) + YooKassa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Personal/Pro/Max subscription tiers with feature-gating, YooKassa payments (initial + recurring via saved method), cron auto-renewal in apps/engines, CLI refund command, and updated /pricing + landing pages.

**Architecture:** Plan/Subscription/Order tables in Prisma drive feature gating resolved per-workspace via `getWorkspaceFeatures(workspaceId)`. Server-side enforcement at layout level (`notFound()` for hidden routes), Sidebar shows green Chip for paid tiers. New `packages/yookassa` HTTP wrapper used by both apps/web (initial purchase, webhook) and apps/engines (renewal cron, refund CLI). Cron at 00:00 МСК expires canceled subscriptions and auto-charges saved-method recurring. CLI built on `nest-commander` with `refund <orderId>` command.

**Tech Stack:** Prisma 7, Next.js 16 App Router, tRPC v11, NestJS (engines), nest-commander, MUI v6, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-26-subscription-plans-yookassa-design.md`

---

## File Structure

**New files:**

```
packages/yookassa/
  package.json
  tsconfig.json
  src/
    index.ts                     # public exports
    client.ts                    # YookassaClient
    types.ts                     # Payment, Refund, PaymentMethod, ConfirmationRedirect, WebhookEvent
    webhook.ts                   # parseWebhookEvent + verifyTrustedIp
    errors.ts                    # YookassaError, YookassaApiError

packages/db/prisma/migrations/<timestamp>_subscription_plans/migration.sql

apps/web/src/components/billing/checkout-modal.tsx          # client modal
apps/web/src/components/billing/pricing-tiers.tsx           # client carousel
apps/web/src/components/billing/order-progress.tsx          # /billing/return polling
apps/web/src/components/billing/cancel-subscription-dialog.tsx
apps/web/src/components/billing/order-history-table.tsx
apps/web/src/components/billing/payment-method-card.tsx

apps/web/src/app/api/webhooks/yookassa/route.ts             # webhook receiver
apps/web/src/app/(protected)/billing/return/page.tsx        # post-payment landing
apps/web/src/app/(about)/oferta/page.tsx                    # legal placeholder
apps/web/src/app/(protected)/workspaces/[workspaceId]/chats/layout.tsx  # gate

apps/engines/src/apps/billing/billing.module.ts
apps/engines/src/apps/billing/cron/subscription-renewal-cron.service.ts
apps/engines/src/apps/billing/services/subscription-renewal.service.ts
apps/engines/src/apps/billing/services/refund.service.ts
apps/engines/src/apps/billing/services/yookassa-client.factory.ts
apps/engines/src/apps/indexer/services/plan-features.service.ts
apps/engines/src/apps/billing/commands/refund.command.ts
apps/engines/src/apps/billing/commands/force-renew.command.ts
apps/engines/src/apps/billing/commands/cancel-subscription.command.ts
apps/engines/src/cli.ts
apps/engines/src/cli.module.ts

apps/e2e/billing.spec.ts                                    # Playwright E2E
```

**Modified files:**

```
packages/db/prisma/schema.prisma          # Plan, Subscription, Order
packages/db/prisma/seed.ts                # plan rows + AiModel.minPlanSlug
packages/auth/src/auth.ts                 # default plan slug "personal"
packages/trpc/src/helpers/plan.ts         # add getWorkspaceFeatures, getAvailableAiModels, requireWritableWorkspace
packages/trpc/src/routers/subscription.ts # add cancel, resume, getOrder, listOrders, startCheckout

apps/web/src/app/(about)/pricing/page.tsx                                 # full rewrite
apps/web/src/app/(about)/page.tsx                                         # update landing pricing section
apps/web/src/components/public/content.ts                                 # landingPricingCards refresh
apps/web/src/app/(protected)/settings/billing/page.tsx                    # full rewrite
apps/web/src/components/settings/current-plan-card.tsx                    # priceMonthly → priceMonthlyKopecks
apps/web/src/app/(protected)/workspaces/[workspaceId]/layout.tsx          # pass PlanFeatures
apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/members/page.tsx  # gate
apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/ai/page.tsx       # gate + model filter
apps/web/src/components/workspace/workspace-sidebar.tsx                   # Chip + CTA + nav filtering

apps/engines/src/app.module.ts                            # register BillingModule
apps/engines/src/apps/indexer/cron/vectorization-cron.service.ts  # plan-features gate
apps/engines/package.json                                 # nest-commander dep + cli script

turbo.json                                                # globalEnv additions
.env.example                                              # YOOKASSA_* + BILLING_*
```

---

## Phase 1 — Schema, seed, default plan

### Task 1: Prisma schema — extend Plan, Subscription, add Order

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (Plan, Subscription, add Order, BillingPeriod, OrderStatus)

- [ ] **Step 1: Update Plan model**

Locate `model Plan` (~line 393) and replace with:

```prisma
model Plan {
  id                       String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  slug                     String   @unique @db.VarChar(50)
  name                     String   @db.VarChar(100)
  description              String?  @db.Text

  priceMonthlyKopecks      Int      @default(0) @map("price_monthly_kopecks")
  priceYearlyKopecks       Int      @default(0) @map("price_yearly_kopecks")
  currency                 String   @default("RUB") @db.VarChar(3)

  maxWorkspaces            Int?     @map("max_workspaces")
  maxMembersPerWorkspace   Int      @default(1) @map("max_members_per_workspace")

  chatsEnabled             Boolean  @default(false) @map("chats_enabled")
  pageIndexingEnabled      Boolean  @default(false) @map("page_indexing_enabled")
  membersSettingsEnabled   Boolean  @default(false) @map("members_settings_enabled")
  aiSettingsEnabled        Boolean  @default(false) @map("ai_settings_enabled")
  customMcpEnabled         Boolean  @default(false) @map("custom_mcp_enabled")
  prioritySupport          Boolean  @default(false) @map("priority_support")
  developerSpaceEnabled    Boolean  @default(false) @map("developer_space_enabled")

  features                 Json     @default("[]")
  isActive                 Boolean  @default(true) @map("is_active")
  sortOrder                Int      @default(0) @map("sort_order")

  createdAt                DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt                DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  subscriptions            Subscription[]
  orders                   Order[]

  @@map("plans")
}
```

- [ ] **Step 2: Update Subscription model**

Locate `model Subscription` and replace with:

```prisma
model Subscription {
  id                       String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId                   String   @map("user_id") @db.Uuid
  planId                   String   @map("plan_id") @db.Uuid

  status                   SubscriptionStatus  @default(ACTIVE)
  billingPeriod            BillingPeriod       @default(MONTHLY) @map("billing_period")

  currentPeriodStart       DateTime? @map("current_period_start") @db.Timestamptz(6)
  currentPeriodEnd         DateTime? @map("current_period_end") @db.Timestamptz(6)

  cancelAtPeriodEnd        Boolean   @default(false) @map("cancel_at_period_end")
  cancelledAt              DateTime? @map("cancelled_at") @db.Timestamptz(6)

  paymentMethodId          String?   @map("payment_method_id") @db.VarChar(64)
  paymentMethodLast4       String?   @map("payment_method_last4") @db.VarChar(4)
  paymentMethodBrand       String?   @map("payment_method_brand") @db.VarChar(32)

  paymentProvider          String?   @map("payment_provider") @db.VarChar(32)
  providerSubscriptionId   String?   @map("provider_subscription_id") @db.VarChar(64)
  amountPaid               Int?      @map("amount_paid")
  currency                 String    @default("RUB") @db.VarChar(3)
  metadata                 Json?

  expiredAt                DateTime? @map("expired_at") @db.Timestamptz(6)
  createdAt                DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt                DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  user                     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  plan                     Plan     @relation(fields: [planId], references: [id])
  orders                   Order[]

  @@index([userId])
  @@index([currentPeriodEnd, status, cancelAtPeriodEnd])
  @@map("subscriptions")
}

enum BillingPeriod {
  MONTHLY
  YEARLY
}
```

Make sure existing `enum SubscriptionStatus` has `ACTIVE`, `CANCELED`, `EXPIRED` values.

- [ ] **Step 3: Add Order model**

Add at end of file:

```prisma
model Order {
  id                       String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId                   String   @map("user_id") @db.Uuid
  planId                   String   @map("plan_id") @db.Uuid
  subscriptionId           String?  @map("subscription_id") @db.Uuid

  billingPeriod            BillingPeriod @map("billing_period")
  amountKopecks            Int      @map("amount_kopecks")
  currency                 String   @default("RUB") @db.VarChar(3)
  status                   OrderStatus @default(PENDING)

  yookassaPaymentId        String?  @unique @map("yookassa_payment_id") @db.VarChar(64)
  yookassaIdempotencyKey   String   @unique @map("yookassa_idempotency_key") @db.VarChar(64)
  yookassaRefundId         String?  @map("yookassa_refund_id") @db.VarChar(64)

  isInitial                Boolean  @default(false) @map("is_initial")
  savedPaymentMethod       Boolean  @default(false) @map("saved_payment_method")

  refundedAt               DateTime? @map("refunded_at") @db.Timestamptz(6)
  paidAt                   DateTime? @map("paid_at") @db.Timestamptz(6)

  metadata                 Json?
  createdAt                DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt                DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  user                     User          @relation(fields: [userId], references: [id])
  plan                     Plan          @relation(fields: [planId], references: [id])
  subscription             Subscription? @relation(fields: [subscriptionId], references: [id])

  @@index([userId])
  @@index([status])
  @@index([subscriptionId])
  @@map("orders")
}

enum OrderStatus {
  PENDING
  PAID
  FAILED
  REFUNDED
  CANCELED
}
```

Add `orders Order[]` to `User` model (locate `model User`, append in relations section).

- [ ] **Step 4: Generate Prisma client**

Run: `pnpm --filter @repo/db prisma:generate`
Expected: PASS, types regenerated.

- [ ] **Step 5: Push schema to dev DB**

Run: `pnpm --filter @repo/db prisma:db-push`
Expected: PASS, schema applied (existing `priceMonthly` column dropped, new columns added — no data preserved for that column).

- [ ] **Step 6: Type-check workspace**

Run: `pnpm check-types`
Expected: FAIL — current code references `priceMonthly` (which is gone) in `apps/web/src/components/settings/current-plan-card.tsx` and `packages/db/prisma/seed.ts`. Note errors; they are fixed in tasks 2 and Phase 5.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): extend Plan/Subscription, add Order model for billing"
```

---

### Task 2: Update seed.ts with new plan rows

**Files:**

- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 1: Replace plans array**

Locate the existing `const plans = [...]` block (~line 59) and replace with:

```ts
const plans = [
  {
    slug: 'personal',
    name: 'Personal',
    description: 'Для личного пользования',
    priceMonthlyKopecks: 0,
    priceYearlyKopecks: 0,
    currency: 'RUB',
    maxWorkspaces: 1,
    maxMembersPerWorkspace: 1,
    chatsEnabled: false,
    pageIndexingEnabled: false,
    membersSettingsEnabled: false,
    aiSettingsEnabled: false,
    customMcpEnabled: false,
    prioritySupport: false,
    developerSpaceEnabled: false,
    features: ['1 рабочее пространство', 'Базовый редактор', 'Без AI и индексации'],
    sortOrder: 1,
    isActive: true,
  },
  {
    slug: 'pro',
    name: 'Pro',
    description: 'Для продвинутых пользователей',
    priceMonthlyKopecks: 15_000,
    priceYearlyKopecks: 100_000,
    currency: 'RUB',
    maxWorkspaces: 3,
    maxMembersPerWorkspace: 5,
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
      'Чаты с AI',
      'Индексация страниц',
      'GigaChat-2 и GigaChat-2 Pro',
    ],
    sortOrder: 2,
    isActive: true,
  },
  {
    slug: 'max',
    name: 'Max',
    description: 'Для команд и больших задач',
    priceMonthlyKopecks: 150_000,
    priceYearlyKopecks: 1_200_000,
    currency: 'RUB',
    maxWorkspaces: null,
    maxMembersPerWorkspace: 100,
    chatsEnabled: true,
    pageIndexingEnabled: true,
    membersSettingsEnabled: true,
    aiSettingsEnabled: true,
    customMcpEnabled: true,
    prioritySupport: true,
    developerSpaceEnabled: true,
    features: [
      'Неограниченное число пространств',
      'До 100 участников',
      'GigaChat-2, Pro, Max',
      'Кастомные MCP-серверы',
      'Приоритетная поддержка',
      'Доступ к пространству разработчиков',
    ],
    sortOrder: 3,
    isActive: true,
  },
] as const
```

- [ ] **Step 2: Update upsert call**

Locate the upsert loop (`for (const p of plans)`) and replace the body so all new fields propagate:

```ts
for (const p of plans) {
  await prisma.plan.upsert({
    where: { slug: p.slug },
    create: { ...p, features: p.features as unknown as Prisma.InputJsonValue },
    update: { ...p, features: p.features as unknown as Prisma.InputJsonValue },
  })
}
```

Add `import { Prisma } from "@prisma/client"` at the top if not present.

- [ ] **Step 3: Run seed**

Run: `pnpm --filter @repo/db prisma:db-seed`
Expected: PASS (idempotent upsert).

- [ ] **Step 4: Verify rows**

Run: `pnpm --filter @repo/db exec prisma studio` (or use psql) — confirm 3 rows in `plans` with new slugs and prices.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/seed.ts
git commit -m "feat(db): seed Personal/Pro/Max plans with capability flags"
```

---

### Task 3: Update default-plan slug in better-auth signup hook

**Files:**

- Modify: `packages/auth/src/auth.ts`

- [ ] **Step 1: Find the signup hook**

Locate `databaseHooks.user.create.after` (~line 50–75). It currently does:

```ts
const freePlan = await prisma.plan.findUnique({ where: { slug: 'free' } })
if (freePlan) {
  await prisma.subscription.create({
    data: { userId: user.id, planId: freePlan.id, status: 'ACTIVE' /* ... */ },
  })
}
```

- [ ] **Step 2: Change slug + period defaults**

Replace with:

```ts
const personalPlan = await prisma.plan.findUnique({ where: { slug: 'personal' } })
if (personalPlan) {
  await prisma.subscription.create({
    data: {
      userId: user.id,
      planId: personalPlan.id,
      status: 'ACTIVE',
      billingPeriod: 'MONTHLY',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    },
  })
}
```

If the file uses an enum import (`import { SubscriptionStatus } from "@prisma/client"`), keep that style consistent.

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @repo/auth check-types`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/auth/src/auth.ts
git commit -m "feat(auth): assign Personal plan to new users by default"
```

---

### Task 4: Update AiModel seed with `minPlanSlug`

**Files:**

- Modify: `packages/db/prisma/seed.ts` (AI model section)

- [ ] **Step 1: Locate AiModel seed block**

Search for `aiModel.upsert` or the array of AI models in seed.ts. If no models seeded yet, add a new block right after plans:

```ts
const aiProvider = await prisma.aiProvider.upsert({
  where: { slug: 'gigachat' },
  create: { slug: 'gigachat', displayName: 'GigaChat', isActive: true },
  update: {},
})

const aiModels = [
  {
    slug: 'gigachat-2',
    displayName: 'GigaChat-2',
    contextTokens: 32_000,
    minPlanSlug: 'pro',
  },
  {
    slug: 'gigachat-2-pro',
    displayName: 'GigaChat-2 Pro',
    contextTokens: 32_000,
    minPlanSlug: 'pro',
  },
  {
    slug: 'gigachat-2-max',
    displayName: 'GigaChat-2 Max',
    contextTokens: 64_000,
    minPlanSlug: 'max',
  },
] as const

for (const m of aiModels) {
  await prisma.aiModel.upsert({
    where: { providerId_slug: { providerId: aiProvider.id, slug: m.slug } },
    create: { ...m, providerId: aiProvider.id, isActive: true },
    update: { ...m, isActive: true },
  })
}
```

If models already exist, just update each row's `minPlanSlug` value via the upsert.

- [ ] **Step 2: Re-run seed**

Run: `pnpm --filter @repo/db prisma:db-seed`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/db/prisma/seed.ts
git commit -m "feat(db): seed AI models with minPlanSlug for plan-based filtering"
```

---

## Phase 2 — Helpers and tRPC router foundation

### Task 5: PlanFeatures type + getWorkspaceFeatures helper

**Files:**

- Modify: `packages/trpc/src/helpers/plan.ts`
- Test: `packages/trpc/src/helpers/__tests__/plan.spec.ts`

- [ ] **Step 1: Write failing test**

Create or extend `packages/trpc/src/helpers/__tests__/plan.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@repo/db'
import { getWorkspaceFeatures } from '../plan'

describe('getWorkspaceFeatures', () => {
  let workspaceId: string

  beforeEach(async () => {
    // assume a fixture user/workspace seeded by global setup
    const ws = await prisma.workspace.create({
      data: {
        name: 'Test WS',
        owner: { create: { email: 'test+plan@anynote.dev', emailVerified: true } },
      },
      select: { id: true },
    })
    workspaceId = ws.id
  })

  it('returns Personal features when owner has no active subscription', async () => {
    const features = await getWorkspaceFeatures(workspaceId)
    expect(features.slug).toBe('personal')
    expect(features.chatsEnabled).toBe(false)
    expect(features.isPaid).toBe(false)
  })

  it('returns Pro features when owner has ACTIVE Pro subscription', async () => {
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })
    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    await prisma.subscription.create({
      data: {
        userId: ws.ownerId,
        planId: pro.id,
        status: 'ACTIVE',
        billingPeriod: 'MONTHLY',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
      },
    })
    const features = await getWorkspaceFeatures(workspaceId)
    expect(features.slug).toBe('pro')
    expect(features.chatsEnabled).toBe(true)
    expect(features.isPaid).toBe(true)
    expect(features.maxMembersPerWorkspace).toBe(5)
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @repo/trpc test plan.spec`
Expected: FAIL — `getWorkspaceFeatures` not exported.

- [ ] **Step 3: Implement helper**

In `packages/trpc/src/helpers/plan.ts`, add:

```ts
import { prisma } from '@repo/db'
import type { Plan } from '@prisma/client'

export type PlanFeatures = {
  slug: 'personal' | 'pro' | 'max'
  name: string
  sortOrder: number
  isPaid: boolean
  maxWorkspaces: number | null
  maxMembersPerWorkspace: number
  chatsEnabled: boolean
  pageIndexingEnabled: boolean
  membersSettingsEnabled: boolean
  aiSettingsEnabled: boolean
  customMcpEnabled: boolean
  prioritySupport: boolean
  developerSpaceEnabled: boolean
}

function planToFeatures(plan: Plan): PlanFeatures {
  return {
    slug: plan.slug as PlanFeatures['slug'],
    name: plan.name,
    sortOrder: plan.sortOrder,
    isPaid: plan.slug !== 'personal',
    maxWorkspaces: plan.maxWorkspaces,
    maxMembersPerWorkspace: plan.maxMembersPerWorkspace,
    chatsEnabled: plan.chatsEnabled,
    pageIndexingEnabled: plan.pageIndexingEnabled,
    membersSettingsEnabled: plan.membersSettingsEnabled,
    aiSettingsEnabled: plan.aiSettingsEnabled,
    customMcpEnabled: plan.customMcpEnabled,
    prioritySupport: plan.prioritySupport,
    developerSpaceEnabled: plan.developerSpaceEnabled,
  }
}

export async function getWorkspaceFeatures(workspaceId: string): Promise<PlanFeatures> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true },
  })
  if (!workspace) {
    const personal = await prisma.plan.findUniqueOrThrow({ where: { slug: 'personal' } })
    return planToFeatures(personal)
  }

  const sub = await prisma.subscription.findFirst({
    where: { userId: workspace.ownerId, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
    include: { plan: true },
  })

  if (!sub) {
    const personal = await prisma.plan.findUniqueOrThrow({ where: { slug: 'personal' } })
    return planToFeatures(personal)
  }
  return planToFeatures(sub.plan)
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @repo/trpc test plan.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/helpers/plan.ts packages/trpc/src/helpers/__tests__/plan.spec.ts
git commit -m "feat(trpc): add getWorkspaceFeatures helper resolving plan by workspace owner"
```

---

### Task 6: getAvailableAiModels helper

**Files:**

- Modify: `packages/trpc/src/helpers/plan.ts`
- Test: `packages/trpc/src/helpers/__tests__/plan.spec.ts`

- [ ] **Step 1: Add failing test**

Append to `plan.spec.ts`:

```ts
describe('getAvailableAiModels', () => {
  it('returns only Pro-eligible models for Pro workspace', async () => {
    // seed assumed: gigachat-2 (pro), gigachat-2-pro (pro), gigachat-2-max (max)
    // ... setup workspace owned by Pro user (similar to above)
    const models = await getAvailableAiModels(workspaceId)
    expect(models.map((m) => m.slug).sort()).toEqual(['gigachat-2', 'gigachat-2-pro'])
  })
})
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter @repo/trpc test plan.spec`
Expected: FAIL — function not exported.

- [ ] **Step 3: Implement helper**

In `packages/trpc/src/helpers/plan.ts`:

```ts
import type { AiModel, AiProvider } from '@prisma/client'

export async function getAvailableAiModels(
  workspaceId: string,
): Promise<(AiModel & { provider: AiProvider })[]> {
  const features = await getWorkspaceFeatures(workspaceId)
  const allowed = await prisma.plan.findMany({
    where: { sortOrder: { lte: features.sortOrder } },
    select: { slug: true },
  })
  const allowedSlugs = allowed.map((r) => r.slug)
  return prisma.aiModel.findMany({
    where: {
      isActive: true,
      OR: [{ minPlanSlug: null }, { minPlanSlug: { in: allowedSlugs } }],
    },
    include: { provider: true },
    orderBy: { displayName: 'asc' },
  })
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @repo/trpc test plan.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/helpers/plan.ts packages/trpc/src/helpers/__tests__/plan.spec.ts
git commit -m "feat(trpc): add getAvailableAiModels filtering by AiModel.minPlanSlug"
```

---

### Task 7: requireWritableWorkspace guard

**Files:**

- Modify: `packages/trpc/src/helpers/plan.ts`
- Test: `packages/trpc/src/helpers/__tests__/plan.spec.ts`

- [ ] **Step 1: Add failing test**

```ts
describe('requireWritableWorkspace', () => {
  it('allows writes for first workspace on Personal', async () => {
    // Personal user with 1 workspace
    await expect(requireWritableWorkspace(workspaceId, ownerId)).resolves.toBeUndefined()
  })

  it('blocks writes for second workspace on Personal (over limit)', async () => {
    // Create 2nd workspace owned by same user
    const second = await prisma.workspace.create({
      data: { name: 'WS2', ownerId },
      select: { id: true },
    })
    await expect(requireWritableWorkspace(second.id, ownerId)).rejects.toThrow(
      /WORKSPACE_OVER_PLAN_LIMIT/,
    )
  })
})
```

- [ ] **Step 2: Run test, verify failure**

- [ ] **Step 3: Implement helper**

```ts
import { TRPCError } from '@trpc/server'

export async function requireWritableWorkspace(workspaceId: string, userId: string): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true, createdAt: true },
  })
  if (!workspace) throw new TRPCError({ code: 'NOT_FOUND' })

  const features = await getWorkspaceFeatures(workspaceId)
  if (features.maxWorkspaces === null) return

  const olderCount = await prisma.workspace.count({
    where: { ownerId: workspace.ownerId, createdAt: { lt: workspace.createdAt } },
  })
  if (olderCount >= features.maxWorkspaces) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'WORKSPACE_OVER_PLAN_LIMIT' })
  }
}
```

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/helpers/plan.ts packages/trpc/src/helpers/__tests__/plan.spec.ts
git commit -m "feat(trpc): add requireWritableWorkspace guard for soft-downgrade enforcement"
```

---

### Task 8: tRPC subscription router — cancel, resume, getOrder, listOrders

**Files:**

- Modify: `packages/trpc/src/routers/subscription.ts`

- [ ] **Step 1: Add procedures**

Open `packages/trpc/src/routers/subscription.ts` and add:

```ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../trpc'

// existing: getCurrent, listHistory

export const subscriptionRouter = router({
  // ... existing procedures preserved

  cancel: protectedProcedure.mutation(async ({ ctx }) => {
    const sub = await ctx.prisma.subscription.findFirst({
      where: { userId: ctx.user.id, status: 'ACTIVE' },
      include: { plan: true },
    })
    if (!sub) throw new TRPCError({ code: 'NOT_FOUND', message: 'NO_ACTIVE_SUBSCRIPTION' })
    if (sub.plan.slug === 'personal') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'CANNOT_CANCEL_FREE_PLAN' })
    }
    return ctx.prisma.subscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: true, cancelledAt: new Date() },
    })
  }),

  resume: protectedProcedure.mutation(async ({ ctx }) => {
    const sub = await ctx.prisma.subscription.findFirst({
      where: { userId: ctx.user.id, status: 'ACTIVE', cancelAtPeriodEnd: true },
    })
    if (!sub) throw new TRPCError({ code: 'NOT_FOUND', message: 'NO_CANCELED_SUBSCRIPTION' })
    return ctx.prisma.subscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: false, cancelledAt: null },
    })
  }),

  getOrder: protectedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const order = await ctx.prisma.order.findUnique({
        where: { id: input.orderId },
        include: { plan: { select: { name: true, slug: true } } },
      })
      if (!order || order.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }
      return order
    }),

  listOrders: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.order.findMany({
      where: { userId: ctx.user.id },
      include: { plan: { select: { name: true, slug: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  }),
})
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @repo/trpc check-types`
Expected: PASS.

- [ ] **Step 3: Add unit test for cancel/resume**

Create `packages/trpc/src/routers/__tests__/subscription.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createCaller } from '../../index'
// build test context with seeded user + Pro subscription, call cancel
// then call resume, assert flags toggled
```

(Detailed test setup follows existing patterns in the repo — replicate fixture style from any sibling spec.)

- [ ] **Step 4: Run all trpc tests**

Run: `pnpm --filter @repo/trpc test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/subscription.ts packages/trpc/src/routers/__tests__/subscription.spec.ts
git commit -m "feat(trpc): add subscription cancel/resume/getOrder/listOrders procedures"
```

---

## Phase 3 — `packages/yookassa` HTTP wrapper

### Task 9: Scaffold packages/yookassa with types

**Files:**

- Create: `packages/yookassa/package.json`
- Create: `packages/yookassa/tsconfig.json`
- Create: `packages/yookassa/src/index.ts`
- Create: `packages/yookassa/src/types.ts`
- Create: `packages/yookassa/src/errors.ts`

- [ ] **Step 1: Package manifest**

`packages/yookassa/package.json`:

```json
{
  "name": "@repo/yookassa",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "check-types": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {},
  "devDependencies": {
    "@repo/typescript-config": "workspace:*",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 2: tsconfig**

`packages/yookassa/tsconfig.json`:

```json
{
  "extends": "@repo/typescript-config/base.json",
  "compilerOptions": { "outDir": "dist" },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Types module**

`packages/yookassa/src/types.ts`:

```ts
export type Money = { value: string; currency: 'RUB' }

export type ConfirmationRedirect = {
  type: 'redirect'
  return_url: string
  confirmation_url?: string
}

export type PaymentMethod = {
  id: string
  type: string
  saved: boolean
  title?: string
  card?: { last4: string; card_type: string }
}

export type Payment = {
  id: string
  status: 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled'
  amount: Money
  description?: string
  payment_method?: PaymentMethod
  confirmation?: ConfirmationRedirect
  created_at: string
  metadata?: Record<string, string>
  test?: boolean
}

export type Refund = {
  id: string
  payment_id: string
  status: 'pending' | 'succeeded' | 'canceled'
  amount: Money
  created_at: string
  description?: string
}

export type CreatePaymentInput = {
  amount: Money
  capture: boolean
  save_payment_method?: boolean
  payment_method_id?: string
  confirmation?: { type: 'redirect'; return_url: string }
  description?: string
  metadata?: Record<string, string>
}

export type CreateRefundInput = {
  payment_id: string
  amount: Money
  description?: string
}

export type WebhookEvent =
  | { type: 'notification'; event: 'payment.succeeded'; object: Payment }
  | { type: 'notification'; event: 'payment.canceled'; object: Payment }
  | { type: 'notification'; event: 'payment.waiting_for_capture'; object: Payment }
  | { type: 'notification'; event: 'refund.succeeded'; object: Refund }
```

- [ ] **Step 4: Errors module**

`packages/yookassa/src/errors.ts`:

```ts
export class YookassaError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'YookassaError'
  }
}

export class YookassaApiError extends YookassaError {
  constructor(
    public readonly statusCode: number,
    public readonly body: unknown,
    public readonly code?: string,
  ) {
    super(`YooKassa API ${statusCode}: ${code ?? 'unknown'}`)
    this.name = 'YookassaApiError'
  }
}
```

- [ ] **Step 5: index.ts placeholder**

`packages/yookassa/src/index.ts`:

```ts
export * from './types'
export * from './errors'
export { YookassaClient } from './client'
export { parseWebhookEvent, verifyTrustedIp } from './webhook'
```

(Stubs for `./client` and `./webhook` come in next tasks; this re-export will fail type-check until they exist — that's expected.)

- [ ] **Step 6: Install workspace**

Run: `pnpm install`
Expected: PASS, package recognized.

- [ ] **Step 7: Commit**

```bash
git add packages/yookassa/
git commit -m "feat(yookassa): scaffold @repo/yookassa package with types and errors"
```

---

### Task 10: YookassaClient — base HTTP + createPayment

**Files:**

- Create: `packages/yookassa/src/client.ts`
- Test: `packages/yookassa/src/__tests__/client.spec.ts`

- [ ] **Step 1: Failing test**

```ts
// packages/yookassa/src/__tests__/client.spec.ts
import { describe, it, expect, vi } from 'vitest'
import { YookassaClient } from '../client'

describe('YookassaClient.createPayment', () => {
  it('posts to /payments with Basic auth and Idempotence-Key', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'pmt_1',
            status: 'pending',
            amount: { value: '150.00', currency: 'RUB' },
            confirmation: { type: 'redirect', confirmation_url: 'https://yk/conf' },
            created_at: '2026-04-26T00:00:00Z',
          }),
          { status: 200 },
        ),
    )
    const client = new YookassaClient({
      shopId: 'shop',
      secretKey: 'secret',
      fetch: fetchMock as unknown as typeof fetch,
    })
    const payment = await client.createPayment(
      {
        amount: { value: '150.00', currency: 'RUB' },
        capture: true,
        save_payment_method: true,
        confirmation: { type: 'redirect', return_url: 'https://app/billing/return' },
        description: 'Подписка Pro',
      },
      'key-1',
    )
    expect(payment.id).toBe('pmt_1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.yookassa.ru/v3/payments')
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('Authorization')).toBe(
      `Basic ${Buffer.from('shop:secret').toString('base64')}`,
    )
    expect(headers.get('Idempotence-Key')).toBe('key-1')
    expect(headers.get('Content-Type')).toBe('application/json')
  })
})
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter @repo/yookassa test`
Expected: FAIL — client.ts not implemented.

- [ ] **Step 3: Implement client base + createPayment**

`packages/yookassa/src/client.ts`:

```ts
import { YookassaApiError } from './errors'
import type { CreatePaymentInput, CreateRefundInput, Payment, Refund } from './types'

export type YookassaClientOpts = {
  shopId: string
  secretKey: string
  baseUrl?: string
  fetch?: typeof fetch
}

export class YookassaClient {
  private readonly baseUrl: string
  private readonly auth: string
  private readonly fetchImpl: typeof fetch

  constructor(opts: YookassaClientOpts) {
    this.baseUrl = opts.baseUrl ?? 'https://api.yookassa.ru/v3'
    this.auth = 'Basic ' + Buffer.from(`${opts.shopId}:${opts.secretKey}`).toString('base64')
    this.fetchImpl = opts.fetch ?? fetch
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const headers = new Headers({
      Authorization: this.auth,
      'Content-Type': 'application/json',
    })
    if (idempotencyKey) headers.set('Idempotence-Key', idempotencyKey)

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let parsed: unknown
    try {
      parsed = text ? JSON.parse(text) : undefined
    } catch {
      parsed = text
    }
    if (!res.ok) {
      const code =
        typeof parsed === 'object' && parsed && 'code' in parsed
          ? String((parsed as Record<string, unknown>).code)
          : undefined
      throw new YookassaApiError(res.status, parsed, code)
    }
    return parsed as T
  }

  createPayment(input: CreatePaymentInput, idempotencyKey: string): Promise<Payment> {
    return this.request<Payment>('POST', '/payments', input, idempotencyKey)
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @repo/yookassa test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/yookassa/src/client.ts packages/yookassa/src/__tests__/
git commit -m "feat(yookassa): implement YookassaClient.createPayment with Basic auth + idempotency"
```

---

### Task 11: YookassaClient — chargeWithSavedMethod + getPayment

**Files:**

- Modify: `packages/yookassa/src/client.ts`
- Modify: `packages/yookassa/src/__tests__/client.spec.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe('YookassaClient.chargeWithSavedMethod', () => {
  it('posts payment with payment_method_id and no confirmation', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'pmt_2',
            status: 'succeeded',
            amount: { value: '150.00', currency: 'RUB' },
            payment_method: { id: 'pm_x', type: 'bank_card', saved: true },
            created_at: '2026-04-26T00:00:00Z',
          }),
          { status: 200 },
        ),
    )
    const client = new YookassaClient({
      shopId: 'shop',
      secretKey: 'secret',
      fetch: fetchMock as any,
    })
    const payment = await client.chargeWithSavedMethod(
      {
        amount: { value: '150.00', currency: 'RUB' },
        payment_method_id: 'pm_x',
        capture: true,
        description: 'Renewal',
      },
      'key-2',
    )
    expect(payment.status).toBe('succeeded')
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.payment_method_id).toBe('pm_x')
    expect(body.confirmation).toBeUndefined()
  })
})

describe('YookassaClient.getPayment', () => {
  it('fetches by id', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'pmt_3',
            status: 'succeeded',
            amount: { value: '150.00', currency: 'RUB' },
            created_at: '2026-04-26T00:00:00Z',
          }),
          { status: 200 },
        ),
    )
    const client = new YookassaClient({
      shopId: 'shop',
      secretKey: 'secret',
      fetch: fetchMock as any,
    })
    const p = await client.getPayment('pmt_3')
    expect(p.id).toBe('pmt_3')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.yookassa.ru/v3/payments/pmt_3')
  })
})
```

- [ ] **Step 2: Run tests, verify failure**

- [ ] **Step 3: Implement methods**

Add to `client.ts`:

```ts
export type ChargeSavedInput = Omit<CreatePaymentInput, "save_payment_method" | "confirmation"> & {
  payment_method_id: string
}

// inside class:
chargeWithSavedMethod(input: ChargeSavedInput, idempotencyKey: string): Promise<Payment> {
  return this.request<Payment>("POST", "/payments", input, idempotencyKey)
}

getPayment(id: string): Promise<Payment> {
  return this.request<Payment>("GET", `/payments/${id}`)
}
```

Also export `ChargeSavedInput` from `index.ts`.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(yookassa): add chargeWithSavedMethod and getPayment"
```

---

### Task 12: YookassaClient — createRefund + getRefund

**Files:**

- Modify: `packages/yookassa/src/client.ts`
- Modify: `packages/yookassa/src/__tests__/client.spec.ts`

- [ ] **Step 1: Failing tests**

```ts
describe('YookassaClient.createRefund', () => {
  it('posts to /refunds with idempotency', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'rf_1',
            payment_id: 'pmt_1',
            status: 'succeeded',
            amount: { value: '150.00', currency: 'RUB' },
            created_at: '2026-04-26T00:00:00Z',
          }),
          { status: 200 },
        ),
    )
    const client = new YookassaClient({
      shopId: 'shop',
      secretKey: 'secret',
      fetch: fetchMock as any,
    })
    const r = await client.createRefund(
      { payment_id: 'pmt_1', amount: { value: '150.00', currency: 'RUB' } },
      'rf-key',
    )
    expect(r.id).toBe('rf_1')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.yookassa.ru/v3/refunds')
  })
})
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

```ts
createRefund(input: CreateRefundInput, idempotencyKey: string): Promise<Refund> {
  return this.request<Refund>("POST", "/refunds", input, idempotencyKey)
}

getRefund(id: string): Promise<Refund> {
  return this.request<Refund>("GET", `/refunds/${id}`)
}
```

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(yookassa): add createRefund and getRefund"
```

---

### Task 13: webhook.ts — parseWebhookEvent + verifyTrustedIp

**Files:**

- Create: `packages/yookassa/src/webhook.ts`
- Create: `packages/yookassa/src/__tests__/webhook.spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest'
import { parseWebhookEvent, verifyTrustedIp } from '../webhook'

describe('parseWebhookEvent', () => {
  it('parses payment.succeeded', () => {
    const event = parseWebhookEvent({
      type: 'notification',
      event: 'payment.succeeded',
      object: {
        id: 'pmt_1',
        status: 'succeeded',
        amount: { value: '150.00', currency: 'RUB' },
        created_at: '2026-04-26T00:00:00Z',
      },
    })
    expect(event.event).toBe('payment.succeeded')
    expect(event.object.id).toBe('pmt_1')
  })

  it('throws on unknown event', () => {
    expect(() => parseWebhookEvent({ event: 'weird' })).toThrow()
  })
})

describe('verifyTrustedIp', () => {
  it('returns true when ip is in allowlist', () => {
    expect(verifyTrustedIp('185.71.76.5', '185.71.76.0/27,77.75.156.0/27')).toBe(true)
  })
  it('returns false when ip is outside', () => {
    expect(verifyTrustedIp('8.8.8.8', '185.71.76.0/27')).toBe(false)
  })
})
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

`packages/yookassa/src/webhook.ts`:

```ts
import type { WebhookEvent } from './types'
import { YookassaError } from './errors'

const KNOWN_EVENTS = new Set([
  'payment.succeeded',
  'payment.canceled',
  'payment.waiting_for_capture',
  'refund.succeeded',
])

export function parseWebhookEvent(body: unknown): WebhookEvent {
  if (!body || typeof body !== 'object') throw new YookassaError('invalid webhook body')
  const obj = body as Record<string, unknown>
  if (!obj.event || !KNOWN_EVENTS.has(String(obj.event))) {
    throw new YookassaError(`unknown event: ${obj.event}`)
  }
  if (!obj.object || typeof obj.object !== 'object') {
    throw new YookassaError('missing object')
  }
  return obj as unknown as WebhookEvent
}

export function verifyTrustedIp(ip: string, allowlistCsv: string | undefined): boolean {
  if (!allowlistCsv) return true
  const cidrs = allowlistCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return cidrs.some((cidr) => ipInCidr(ip, cidr))
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/')
  if (!range) return false
  const bits = bitsStr ? parseInt(bitsStr, 10) : 32
  const ipInt = ipv4ToInt(ip)
  const rangeInt = ipv4ToInt(range)
  if (ipInt === null || rangeInt === null) return false
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (ipInt & mask) === (rangeInt & mask)
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @repo/yookassa test`
Expected: PASS — all webhook + client tests green.

- [ ] **Step 5: Type-check + commit**

Run: `pnpm --filter @repo/yookassa check-types`

```bash
git add packages/yookassa/src/webhook.ts packages/yookassa/src/__tests__/webhook.spec.ts
git commit -m "feat(yookassa): add webhook event parser and IPv4 CIDR allowlist check"
```

---

## Phase 4 — startCheckout + webhook handler

### Task 14: Implement subscription.startCheckout

**Files:**

- Modify: `packages/trpc/src/routers/subscription.ts`
- Modify: `apps/web/src/server/yookassa.ts` (new) — singleton client factory
- Modify: `turbo.json`, `.env.example`

- [ ] **Step 1: Add YooKassa env vars**

Append to `.env.example`:

```
# YooKassa
YOOKASSA_SHOP_ID=
YOOKASSA_SECRET_KEY=
YOOKASSA_RETURN_URL_BASE=
YOOKASSA_TRUSTED_IPS=
```

In `turbo.json`, add to `globalEnv`:

```json
"YOOKASSA_SHOP_ID", "YOOKASSA_SECRET_KEY", "YOOKASSA_RETURN_URL_BASE", "YOOKASSA_TRUSTED_IPS"
```

- [ ] **Step 2: Create web YooKassa singleton**

Create `apps/web/src/server/yookassa.ts`:

```ts
import 'server-only'
import { YookassaClient } from '@repo/yookassa'

let client: YookassaClient | null = null

export function getYookassaClient(): YookassaClient {
  if (client) return client
  const shopId = process.env.YOOKASSA_SHOP_ID
  const secretKey = process.env.YOOKASSA_SECRET_KEY
  if (!shopId || !secretKey) throw new Error('YOOKASSA_SHOP_ID/SECRET_KEY not set')
  client = new YookassaClient({ shopId, secretKey })
  return client
}

export function getReturnUrlBase(): string {
  return (
    process.env.YOOKASSA_RETURN_URL_BASE ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    'http://localhost:3000'
  )
}
```

Add `@repo/yookassa` to `apps/web/package.json` dependencies (workspace:\*) and re-run `pnpm install`.

- [ ] **Step 3: Implement startCheckout procedure**

In `packages/trpc/src/routers/subscription.ts`, add:

```ts
import { randomUUID } from 'node:crypto'
import { getYookassaClient, getReturnUrlBase } from '../../../apps/web/src/server/yookassa' // see note below

// Note: do NOT import from apps/web in the trpc package. Instead, the trpc context
// receives an injected `yookassa` client in createServerContext. Update context type:
//   ctx.yookassa: YookassaClient
//   ctx.returnUrlBase: string
// The web app's `app/api/trpc/[trpc]/route.ts` injects them when building context.
```

Update `packages/trpc/src/index.ts` Context to include `yookassa: YookassaClient` and `returnUrlBase: string`. Update `apps/web/src/app/api/trpc/[trpc]/route.ts` and `apps/web/src/trpc/server.ts` to inject these from `getYookassaClient()` / `getReturnUrlBase()`.

Then add to `subscriptionRouter`:

```ts
import { z } from "zod"
import { TRPCError } from "@trpc/server"

startCheckout: protectedProcedure
  .input(
    z.object({
      planSlug: z.enum(["pro", "max"]),
      period: z.enum(["MONTHLY", "YEARLY"]),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const plan = await ctx.prisma.plan.findUnique({ where: { slug: input.planSlug } })
    if (!plan) throw new TRPCError({ code: "NOT_FOUND", message: "PLAN_NOT_FOUND" })

    const existing = await ctx.prisma.subscription.findFirst({
      where: { userId: ctx.user.id, status: "ACTIVE", planId: plan.id },
    })
    if (existing) throw new TRPCError({ code: "CONFLICT", message: "ALREADY_SUBSCRIBED" })

    const amountKopecks =
      input.period === "MONTHLY" ? plan.priceMonthlyKopecks : plan.priceYearlyKopecks
    const idempotencyKey = randomUUID()

    const order = await ctx.prisma.order.create({
      data: {
        userId: ctx.user.id,
        planId: plan.id,
        billingPeriod: input.period,
        amountKopecks,
        currency: "RUB",
        status: "PENDING",
        isInitial: true,
        savedPaymentMethod: true,
        yookassaIdempotencyKey: idempotencyKey,
      },
    })

    const rub = (amountKopecks / 100).toFixed(2)
    const periodLabel = input.period === "MONTHLY" ? "Месяц" : "Год"

    const payment = await ctx.yookassa.createPayment(
      {
        amount: { value: rub, currency: "RUB" },
        capture: true,
        save_payment_method: true,
        confirmation: {
          type: "redirect",
          return_url: `${ctx.returnUrlBase}/billing/return?orderId=${order.id}`,
        },
        description: `Подписка ${plan.name} (${periodLabel})`,
        metadata: {
          orderId: order.id,
          userId: ctx.user.id,
          planSlug: plan.slug,
          period: input.period,
        },
      },
      idempotencyKey,
    )

    await ctx.prisma.order.update({
      where: { id: order.id },
      data: { yookassaPaymentId: payment.id },
    })

    if (!payment.confirmation?.confirmation_url) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "NO_CONFIRMATION_URL" })
    }
    return { orderId: order.id, confirmationUrl: payment.confirmation.confirmation_url }
  }),
```

- [ ] **Step 4: Type-check + commit**

Run: `pnpm check-types`
Expected: PASS.

```bash
git add .env.example turbo.json apps/web/src/server/yookassa.ts apps/web/src/app/api/trpc/[trpc]/route.ts apps/web/src/trpc/server.ts packages/trpc/src/index.ts packages/trpc/src/routers/subscription.ts apps/web/package.json
git commit -m "feat(billing): implement subscription.startCheckout creating YooKassa payment"
```

---

### Task 15: Webhook route — payment.succeeded handler

**Files:**

- Create: `apps/web/src/app/api/webhooks/yookassa/route.ts`
- Create: `apps/web/src/server/billing/webhook-handlers.ts`

- [ ] **Step 1: Failing integration test**

Create `apps/web/src/server/billing/__tests__/webhook-handlers.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@repo/db'
import type { Payment } from '@repo/yookassa'
import { handlePaymentSucceeded } from '../webhook-handlers'

describe('handlePaymentSucceeded', () => {
  let userId: string
  let planId: string
  let orderId: string

  beforeEach(async () => {
    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    planId = pro.id
    const user = await prisma.user.create({
      data: { email: 'billing+wh@anynote.dev', emailVerified: true },
    })
    userId = user.id
    const order = await prisma.order.create({
      data: {
        userId,
        planId,
        billingPeriod: 'MONTHLY',
        amountKopecks: 15000,
        currency: 'RUB',
        status: 'PENDING',
        isInitial: true,
        savedPaymentMethod: true,
        yookassaPaymentId: 'pmt_test_1',
        yookassaIdempotencyKey: 'key-test-1',
      },
    })
    orderId = order.id
  })

  it('transitions Order to PAID and creates ACTIVE Subscription', async () => {
    const yk = {
      getPayment: vi.fn(
        async (id: string) =>
          ({
            id,
            status: 'succeeded',
            amount: { value: '150.00', currency: 'RUB' },
            payment_method: {
              id: 'pm_x',
              type: 'bank_card',
              saved: true,
              card: { last4: '0000', card_type: 'MIR' },
            },
            created_at: '2026-04-26T00:00:00Z',
          }) as Payment,
      ),
    }
    await handlePaymentSucceeded({ yookassa: yk as any, prisma }, { id: 'pmt_test_1' } as Payment)
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } })
    expect(order.status).toBe('PAID')
    const sub = await prisma.subscription.findFirst({ where: { userId, planId } })
    expect(sub?.status).toBe('ACTIVE')
    expect(sub?.paymentMethodId).toBe('pm_x')
  })

  it('is idempotent on second invocation', async () => {
    const yk = {
      getPayment: vi.fn(
        async () =>
          ({
            id: 'pmt_test_1',
            status: 'succeeded',
            amount: { value: '150.00', currency: 'RUB' },
            created_at: '2026-04-26T00:00:00Z',
          }) as Payment,
      ),
    }
    await handlePaymentSucceeded({ yookassa: yk as any, prisma }, { id: 'pmt_test_1' } as Payment)
    await handlePaymentSucceeded({ yookassa: yk as any, prisma }, { id: 'pmt_test_1' } as Payment)
    const subs = await prisma.subscription.findMany({ where: { userId, planId } })
    expect(subs).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test, verify failure**

- [ ] **Step 3: Implement handler**

Create `apps/web/src/server/billing/webhook-handlers.ts`:

```ts
import 'server-only'
import type { PrismaClient } from '@prisma/client'
import type { Payment, Refund, YookassaClient } from '@repo/yookassa'

type Ctx = { yookassa: YookassaClient; prisma: PrismaClient }

function addPeriod(start: Date, period: 'MONTHLY' | 'YEARLY'): Date {
  const end = new Date(start)
  if (period === 'MONTHLY') end.setMonth(end.getMonth() + 1)
  else end.setFullYear(end.getFullYear() + 1)
  return end
}

export async function handlePaymentSucceeded(ctx: Ctx, eventPayment: Payment): Promise<void> {
  const order = await ctx.prisma.order.findUnique({
    where: { yookassaPaymentId: eventPayment.id },
    include: { plan: true },
  })
  if (!order || order.status !== 'PENDING') return

  // defense-in-depth: re-query YooKassa
  const verified = await ctx.yookassa.getPayment(eventPayment.id)
  if (verified.status !== 'succeeded') return

  const now = new Date()
  const periodEnd = addPeriod(now, order.billingPeriod)

  await ctx.prisma.$transaction(async (tx) => {
    // 1. Expire other active subs of this user
    await tx.subscription.updateMany({
      where: { userId: order.userId, status: 'ACTIVE', planId: { not: order.planId } },
      data: { status: 'EXPIRED', expiredAt: now },
    })

    // 2. Find or create subscription for this plan
    const existing = await tx.subscription.findFirst({
      where: { userId: order.userId, planId: order.planId },
    })

    const subData = {
      status: 'ACTIVE' as const,
      billingPeriod: order.billingPeriod,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      paymentMethodId: verified.payment_method?.id ?? null,
      paymentMethodLast4: verified.payment_method?.card?.last4 ?? null,
      paymentMethodBrand: verified.payment_method?.type ?? null,
    }

    const subscription = existing
      ? await tx.subscription.update({ where: { id: existing.id }, data: subData })
      : await tx.subscription.create({
          data: { userId: order.userId, planId: order.planId, ...subData },
        })

    // 3. Mark order PAID and link to subscription
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'PAID',
        paidAt: now,
        subscriptionId: subscription.id,
        savedPaymentMethod: verified.payment_method?.saved ?? false,
      },
    })
  })
}

export async function handlePaymentCanceled(ctx: Ctx, eventPayment: Payment): Promise<void> {
  const order = await ctx.prisma.order.findUnique({
    where: { yookassaPaymentId: eventPayment.id },
  })
  if (!order || order.status !== 'PENDING') return
  await ctx.prisma.order.update({
    where: { id: order.id },
    data: { status: 'FAILED' },
  })
}

export async function handleRefundSucceeded(ctx: Ctx, refund: Refund): Promise<void> {
  const order = await ctx.prisma.order.findUnique({
    where: { yookassaPaymentId: refund.payment_id },
  })
  if (!order || order.status === 'REFUNDED') return
  await ctx.prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: { status: 'REFUNDED', refundedAt: new Date(), yookassaRefundId: refund.id },
    })
    if (order.subscriptionId) {
      await tx.subscription.update({
        where: { id: order.subscriptionId },
        data: { status: 'EXPIRED', expiredAt: new Date(), currentPeriodEnd: new Date() },
      })
    }
  })
}
```

- [ ] **Step 4: Create route handler**

`apps/web/src/app/api/webhooks/yookassa/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { parseWebhookEvent, verifyTrustedIp } from '@repo/yookassa'
import { prisma } from '@repo/db'
import { getYookassaClient } from '@/server/yookassa'
import {
  handlePaymentSucceeded,
  handlePaymentCanceled,
  handleRefundSucceeded,
} from '@/server/billing/webhook-handlers'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? '?'
  if (!verifyTrustedIp(ip, process.env.YOOKASSA_TRUSTED_IPS)) {
    return NextResponse.json({ error: 'untrusted ip' }, { status: 403 })
  }

  let event
  try {
    event = parseWebhookEvent(await req.json())
  } catch (err) {
    return NextResponse.json({ error: 'bad event' }, { status: 400 })
  }

  const ctx = { yookassa: getYookassaClient(), prisma }
  switch (event.event) {
    case 'payment.succeeded':
      await handlePaymentSucceeded(ctx, event.object)
      break
    case 'payment.canceled':
      await handlePaymentCanceled(ctx, event.object)
      break
    case 'refund.succeeded':
      await handleRefundSucceeded(ctx, event.object)
      break
    case 'payment.waiting_for_capture':
      break
  }
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter web test webhook-handlers`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/webhooks/yookassa/ apps/web/src/server/billing/
git commit -m "feat(billing): add YooKassa webhook handler with idempotent payment.succeeded/canceled/refund"
```

---

### Task 16: /billing/return page with order polling

**Files:**

- Create: `apps/web/src/app/(protected)/billing/return/page.tsx`
- Create: `apps/web/src/components/billing/order-progress.tsx`

- [ ] **Step 1: Server-side page**

```tsx
// apps/web/src/app/(protected)/billing/return/page.tsx
import { notFound } from 'next/navigation'
import { prisma } from '@repo/db'
import { requireSession } from '@/lib/get-session'
import { OrderProgress } from '@/components/billing/order-progress'

type Props = { searchParams: Promise<{ orderId?: string }> }

export default async function BillingReturnPage({ searchParams }: Props) {
  const session = await requireSession()
  const { orderId } = await searchParams
  if (!orderId) notFound()
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, userId: true },
  })
  if (!order || order.userId !== session.user.id) notFound()
  return <OrderProgress orderId={order.id} />
}
```

- [ ] **Step 2: Client polling component**

```tsx
// apps/web/src/components/billing/order-progress.tsx
'use client'
import { Box, Stack, CircularProgress, Typography, Button } from '@repo/ui/components'
import Link from 'next/link'
import { trpc } from '@/trpc/client'
import { useEffect, useState } from 'react'

export function OrderProgress({ orderId }: { orderId: string }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const query = trpc.subscription.getOrder.useQuery(
    { orderId },
    { refetchInterval: (q) => (q.state.data?.status === 'PENDING' ? 2000 : false) },
  )

  const order = query.data
  if (!order) {
    return (
      <Centered>
        <CircularProgress />
      </Centered>
    )
  }

  if (order.status === 'PAID') {
    return (
      <Centered>
        <Typography variant="h5">Оплата прошла успешно</Typography>
        <Button component={Link} href="/app" variant="contained">
          В рабочее пространство
        </Button>
      </Centered>
    )
  }

  if (order.status === 'FAILED') {
    return (
      <Centered>
        <Typography variant="h5" color="error">
          Не удалось провести оплату
        </Typography>
        <Button component={Link} href="/pricing" variant="outlined">
          Попробовать ещё раз
        </Button>
      </Centered>
    )
  }

  // PENDING
  if (elapsed > 30) {
    return (
      <Centered>
        <Typography variant="h6">Платёж в обработке</Typography>
        <Typography color="text.secondary">
          Уведомим, когда подтвердится. Можно вернуться в кабинет.
        </Typography>
        <Button component={Link} href="/settings/billing" variant="text">
          В настройки подписки
        </Button>
      </Centered>
    )
  }
  return (
    <Centered>
      <CircularProgress />
      <Typography>Обрабатываем оплату…</Typography>
    </Centered>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <Stack spacing={2} alignItems="center">
        {children}
      </Stack>
    </Box>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm check-types`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(protected)/billing/ apps/web/src/components/billing/order-progress.tsx
git commit -m "feat(billing): add /billing/return page with order status polling"
```

---

## Phase 5 — UI gating

### Task 17: Workspace layout passes PlanFeatures

**Files:**

- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/layout.tsx`
- Create: `apps/web/src/components/workspace/plan-features-context.tsx`

- [ ] **Step 1: Plan features context**

```tsx
// apps/web/src/components/workspace/plan-features-context.tsx
'use client'
import { createContext, useContext } from 'react'
import type { PlanFeatures } from '@repo/trpc/helpers/plan'

const Ctx = createContext<PlanFeatures | null>(null)

export function PlanFeaturesProvider({
  features,
  children,
}: {
  features: PlanFeatures
  children: React.ReactNode
}) {
  return <Ctx.Provider value={features}>{children}</Ctx.Provider>
}

export function usePlanFeatures(): PlanFeatures {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePlanFeatures must be used inside PlanFeaturesProvider')
  return v
}
```

Export `PlanFeatures` from `packages/trpc/src/helpers/plan.ts` (re-export through `packages/trpc/src/index.ts` if needed).

- [ ] **Step 2: Update workspace layout**

In `apps/web/src/app/(protected)/workspaces/[workspaceId]/layout.tsx`, after resolving `workspaceId`:

```tsx
import { getWorkspaceFeatures } from '@repo/trpc/helpers/plan'
import { PlanFeaturesProvider } from '@/components/workspace/plan-features-context'

// inside default export:
const features = await getWorkspaceFeatures(workspaceId)
// existing layout fetches `planName` — replace with `features.name`
return (
  <PlanFeaturesProvider features={features}>
    <WorkspaceLayoutShell features={features}>{children}</WorkspaceLayoutShell>
  </PlanFeaturesProvider>
)
```

If `WorkspaceLayoutShell` (or equivalent) currently expects `planName: string`, change to accept `features: PlanFeatures`.

- [ ] **Step 3: Type-check**

Run: `pnpm check-types`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(protected)/workspaces/[workspaceId]/layout.tsx apps/web/src/components/workspace/
git commit -m "feat(workspace): resolve PlanFeatures at layout level and provide via context"
```

---

### Task 18: /chats layout 404 gate

**Files:**

- Create: `apps/web/src/app/(protected)/workspaces/[workspaceId]/chats/layout.tsx`

- [ ] **Step 1: Create layout**

```tsx
import { notFound } from 'next/navigation'
import { getWorkspaceFeatures } from '@repo/trpc/helpers/plan'

export default async function ChatsLayout({
  params,
  children,
}: {
  params: Promise<{ workspaceId: string }>
  children: React.ReactNode
}) {
  const { workspaceId } = await params
  const features = await getWorkspaceFeatures(workspaceId)
  if (!features.chatsEnabled) notFound()
  return <>{children}</>
}
```

- [ ] **Step 2: Type-check + dev-server smoke test**

Run dev server: `pnpm --filter web dev` (separate terminal).
Open `/workspaces/<id>/chats` as Personal user → expect 404.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/(protected)/workspaces/[workspaceId]/chats/layout.tsx
git commit -m "feat(workspace): gate /chats route by features.chatsEnabled"
```

---

### Task 19: /settings/members + /settings/ai gate + AI model filter

**Files:**

- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/members/page.tsx`
- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/ai/page.tsx`

- [ ] **Step 1: Members page gate**

Add at top of page (Server Component):

```tsx
import { notFound } from 'next/navigation'
import { getWorkspaceFeatures } from '@repo/trpc/helpers/plan'

export default async function MembersPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const features = await getWorkspaceFeatures(workspaceId)
  if (!features.membersSettingsEnabled) notFound()
  // ... rest of existing implementation
}
```

- [ ] **Step 2: AI page gate + model filter**

```tsx
import { notFound } from 'next/navigation'
import { getWorkspaceFeatures, getAvailableAiModels } from '@repo/trpc/helpers/plan'

export default async function AiSettingsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const features = await getWorkspaceFeatures(workspaceId)
  if (!features.aiSettingsEnabled) notFound()
  const models = await getAvailableAiModels(workspaceId)
  return <AiSettingsClient workspaceId={workspaceId} models={models} />
}
```

If `<AiSettingsClient>` does not exist, refactor existing JSX into a client component receiving `models` prop.

- [ ] **Step 3: Type-check + dev smoke test**

Personal user → /settings/members and /settings/ai → 404.
Pro user → /settings/ai → only Pro models in dropdown.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/
git commit -m "feat(workspace): gate /settings/members and /settings/ai by plan features"
```

---

### Task 20: Sidebar Chip + CTA + nav filtering

**Files:**

- Modify: `apps/web/src/components/workspace/workspace-sidebar.tsx`

- [ ] **Step 1: Replace plan badge**

Locate the existing `{planName} plan` rendering (~line 78) and replace with:

```tsx
import { Chip } from '@repo/ui/components'
import { Box, Stack } from '@repo/ui/components'
import Link from 'next/link'
import type { PlanFeatures } from '@repo/trpc'

// Component signature changes from { planName } to { features }:
type Props = { features: PlanFeatures /* + existing props */ }

// In render:
;<Stack direction="row" alignItems="center" gap={1}>
  <Chip
    label={features.name}
    size="small"
    color={features.isPaid ? 'success' : 'default'}
    variant={features.isPaid ? 'filled' : 'outlined'}
  />
  {!features.isPaid && (
    <Box
      component={Link}
      href="/pricing"
      sx={{ fontSize: 12, color: 'primary.main', textDecoration: 'none' }}
    >
      Перейти на Pro
    </Box>
  )}
</Stack>
```

- [ ] **Step 2: Filter nav items**

Find the array of nav items in this sidebar (links to /chats, /pages, /settings/members, /settings/ai). Wrap them with feature checks:

```tsx
const navItems = [
  { label: 'Страницы', href: `/workspaces/${workspaceId}`, show: true },
  { label: 'Чаты', href: `/workspaces/${workspaceId}/chats`, show: features.chatsEnabled },
  // settings sub-nav similarly filtered
].filter((it) => it.show)
```

For settings sub-tabs (Members, AI), filter by `features.membersSettingsEnabled` / `features.aiSettingsEnabled` in their respective rendering location.

- [ ] **Step 3: Update consumers**

Wherever sidebar is rendered with `planName` prop — pass `features` instead. The workspace layout already resolves `features`.

- [ ] **Step 4: Type-check + dev smoke test**

Personal user → green Chip absent, "Перейти на Pro" link visible, /chats nav item missing.
Pro user → green filled Chip, no CTA link, /chats nav present.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/workspace/workspace-sidebar.tsx
git commit -m "feat(sidebar): plan Chip with green for paid tiers, hide gated nav items"
```

---

### Task 21: Engines indexer page-indexing gate

**Files:**

- Modify: `apps/engines/src/apps/indexer/cron/vectorization-cron.service.ts`
- Create: `apps/engines/src/apps/indexer/services/plan-features.service.ts`

- [ ] **Step 1: Engines plan-features service**

```ts
// apps/engines/src/apps/indexer/services/plan-features.service.ts
import { Injectable } from '@nestjs/common'
import { prisma } from '@repo/db'

@Injectable()
export class PlanFeaturesService {
  async isPageIndexingEnabled(workspaceId: string): Promise<boolean> {
    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerId: true },
    })
    if (!ws) return false
    const sub = await prisma.subscription.findFirst({
      where: { userId: ws.ownerId, status: 'ACTIVE' },
      include: { plan: { select: { pageIndexingEnabled: true } } },
    })
    return Boolean(sub?.plan.pageIndexingEnabled)
  }
}
```

Register in `IndexerModule` providers.

- [ ] **Step 2: Apply gate in cron**

In `vectorization-cron.service.ts`, locate `processRow(row)`. Before the call to `agentsClient.vectorize(...)`, add:

```ts
const allowed = await this.planFeatures.isPageIndexingEnabled(row.workspaceId)
if (!allowed) {
  await this.markDoneWithoutVectorization(row.id)
  return
}
```

Inject `PlanFeaturesService` into the cron service constructor.

`markDoneWithoutVectorization` performs the same DB update as success path but without the HTTP call:

```ts
private async markDoneWithoutVectorization(rowId: string): Promise<void> {
  await prisma.outboxEvent.update({
    where: { id: rowId },
    data: { status: "DONE", processedAt: new Date() },
  })
}
```

- [ ] **Step 3: Update existing test**

Add test case in `vectorization-cron.service.spec.ts`: workspace owner on Personal → row marked DONE without HTTP call. Mock `PlanFeaturesService` returning `false`.

- [ ] **Step 4: Run engines tests**

Run: `pnpm --filter @repo/engines test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/indexer/
git commit -m "feat(engines): gate page indexing by owner's pageIndexingEnabled flag"
```

---

## Phase 6 — Pages and components

### Task 22: /pricing page redesign

**Files:**

- Modify: `apps/web/src/app/(about)/pricing/page.tsx`
- Create: `apps/web/src/components/billing/pricing-tiers.tsx`

- [ ] **Step 1: Server page**

```tsx
// apps/web/src/app/(about)/pricing/page.tsx
import { prisma } from '@repo/db'
import { getSession } from '@/lib/get-session'
import { getActivePlanForUser } from '@repo/trpc/helpers/plan'
import { PricingTiers } from '@/components/billing/pricing-tiers'

export default async function PricingPage() {
  const plans = await prisma.plan.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  })
  const session = await getSession()
  const currentPlan = session ? await getActivePlanForUser(session.user.id) : null
  return (
    <PricingTiers
      plans={plans}
      currentPlanSlug={currentPlan?.slug ?? null}
      isAuthenticated={Boolean(session)}
    />
  )
}
```

- [ ] **Step 2: PricingTiers client component**

```tsx
// apps/web/src/components/billing/pricing-tiers.tsx
'use client'
import { useState, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  Box,
  Container,
  Stack,
  Typography,
  Card,
  CardContent,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  Chip,
} from '@repo/ui/components'
import type { Plan } from '@prisma/client'
import { CheckoutModal } from './checkout-modal'

type Props = {
  plans: Plan[]
  currentPlanSlug: string | null
  isAuthenticated: boolean
}

const CUSTOM_TIER = {
  slug: 'custom',
  name: 'Собственная инфраструктура',
  description: 'Для крупных команд и собственных серверов',
  features: ['Self-hosted', 'SLA', 'Индивидуальные интеграции'],
}

export function PricingTiers({ plans, currentPlanSlug, isAuthenticated }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [period, setPeriod] = useState<'MONTHLY' | 'YEARLY'>(
    (searchParams.get('period') as 'MONTHLY' | 'YEARLY') ?? 'MONTHLY',
  )
  const [checkout, setCheckout] = useState<{ planSlug: 'pro' | 'max' } | null>(null)

  // auto-open modal if returning from sign-in with intent=purchase
  useMemo(() => {
    if (searchParams.get('intent') !== 'purchase') return
    const slug = searchParams.get('plan')
    const p = (searchParams.get('period') as 'MONTHLY' | 'YEARLY') ?? 'MONTHLY'
    if (slug === 'pro' || slug === 'max') {
      setPeriod(p)
      setCheckout({ planSlug: slug })
    }
  }, [searchParams])

  function ctaFor(plan: Plan) {
    if (plan.slug === currentPlanSlug) return { label: 'Текущий тариф', disabled: true }
    if (!isAuthenticated) {
      if (plan.slug === 'personal') {
        return { label: 'Регистрация', onClick: () => router.push('/sign-up') }
      }
      return {
        label: 'Купить',
        onClick: () =>
          router.push(
            `/sign-in?redirect=/pricing&intent=purchase&plan=${plan.slug}&period=${period}`,
          ),
      }
    }
    if (plan.slug === 'personal') {
      return { label: 'Перейти', onClick: () => router.push('/settings/billing') }
    }
    return {
      label: currentPlanSlug === 'personal' ? 'Купить' : `Перейти на ${plan.name}`,
      onClick: () => setCheckout({ planSlug: plan.slug as 'pro' | 'max' }),
    }
  }

  function priceLabel(plan: Plan) {
    if (plan.slug === 'personal') return 'Бесплатно'
    const kopecks = period === 'MONTHLY' ? plan.priceMonthlyKopecks : plan.priceYearlyKopecks
    const rub = (kopecks / 100).toLocaleString('ru-RU')
    if (period === 'YEARLY') {
      const monthly = (kopecks / 100 / 12).toLocaleString('ru-RU', { maximumFractionDigits: 0 })
      return `${rub} ₽ / год · ~${monthly} ₽/мес`
    }
    return `${rub} ₽ / месяц`
  }

  return (
    <Container maxWidth="lg" sx={{ py: 6 }}>
      <Stack spacing={4} alignItems="center">
        <Typography variant="h3">Тарифы</Typography>
        <ToggleButtonGroup value={period} exclusive onChange={(_, v) => v && setPeriod(v)}>
          <ToggleButton value="MONTHLY">Месяц</ToggleButton>
          <ToggleButton value="YEARLY">Год</ToggleButton>
        </ToggleButtonGroup>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' },
            gap: 3,
            width: '100%',
          }}
        >
          {plans.map((plan) => {
            const cta = ctaFor(plan)
            return (
              <Card key={plan.id} variant="outlined">
                <CardContent>
                  <Stack spacing={2}>
                    <Typography variant="h5">{plan.name}</Typography>
                    <Typography variant="h6" color="primary">
                      {priceLabel(plan)}
                    </Typography>
                    <Typography color="text.secondary">{plan.description}</Typography>
                    <Stack component="ul" sx={{ pl: 2, m: 0 }}>
                      {(plan.features as string[]).map((f) => (
                        <li key={f}>
                          <Typography variant="body2">{f}</Typography>
                        </li>
                      ))}
                    </Stack>
                    <Button
                      variant="contained"
                      disabled={Boolean(cta.disabled)}
                      onClick={cta.onClick}
                    >
                      {cta.label}
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            )
          })}
          <Card variant="outlined">
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h5">{CUSTOM_TIER.name}</Typography>
                <Typography variant="h6" color="primary">
                  Связаться
                </Typography>
                <Typography color="text.secondary">{CUSTOM_TIER.description}</Typography>
                <Stack component="ul" sx={{ pl: 2, m: 0 }}>
                  {CUSTOM_TIER.features.map((f) => (
                    <li key={f}>
                      <Typography variant="body2">{f}</Typography>
                    </li>
                  ))}
                </Stack>
                <Button variant="outlined" href="/contact">
                  Связаться
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Box>
      </Stack>

      {checkout && (
        <CheckoutModal
          planSlug={checkout.planSlug}
          defaultPeriod={period}
          onClose={() => setCheckout(null)}
        />
      )}
    </Container>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm check-types`
Expected: PASS (CheckoutModal stub allows compilation if added in Task 23, otherwise add a temporary stub `<></>`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(about)/pricing/page.tsx apps/web/src/components/billing/pricing-tiers.tsx
git commit -m "feat(pricing): redesign /pricing with monthly/yearly toggle and 4 tier cards"
```

---

### Task 23: CheckoutModal client component

**Files:**

- Create: `apps/web/src/components/billing/checkout-modal.tsx`

- [ ] **Step 1: Component**

```tsx
'use client'
import { useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
  Typography,
  FormControlLabel,
  Checkbox,
  ToggleButton,
  ToggleButtonGroup,
  Alert,
} from '@repo/ui/components'
import Link from 'next/link'
import { trpc } from '@/trpc/client'

type Props = {
  planSlug: 'pro' | 'max'
  defaultPeriod: 'MONTHLY' | 'YEARLY'
  onClose: () => void
}

const PRICES = {
  pro: { MONTHLY: 150, YEARLY: 1000 },
  max: { MONTHLY: 1500, YEARLY: 12000 },
}

const NAMES = { pro: 'Pro', max: 'Max' }

export function CheckoutModal({ planSlug, defaultPeriod, onClose }: Props) {
  const [period, setPeriod] = useState(defaultPeriod)
  const [agreed, setAgreed] = useState(false)
  const start = trpc.subscription.startCheckout.useMutation({
    onSuccess: ({ confirmationUrl }) => {
      window.location.href = confirmationUrl
    },
  })

  const amount = PRICES[planSlug][period]
  const periodLabel = period === 'MONTHLY' ? 'Месяц' : 'Год'

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Подписка {NAMES[planSlug]}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 1 }}>
          <ToggleButtonGroup
            value={period}
            exclusive
            onChange={(_, v) => v && setPeriod(v)}
            fullWidth
          >
            <ToggleButton value="MONTHLY">Месяц · {PRICES[planSlug].MONTHLY} ₽</ToggleButton>
            <ToggleButton value="YEARLY">Год · {PRICES[planSlug].YEARLY} ₽</ToggleButton>
          </ToggleButtonGroup>
          <Typography variant="h5">К оплате: {amount} ₽</Typography>
          <Typography color="text.secondary">
            Подписка автоматически продлится через {periodLabel.toLowerCase()}. Можно отменить в
            любой момент.
          </Typography>
          <FormControlLabel
            control={<Checkbox checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />}
            label={
              <Typography variant="body2">
                Принимаю условия <Link href="/oferta">оферты</Link>
              </Typography>
            }
          />
          {start.error && <Alert severity="error">{start.error.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button
          variant="contained"
          disabled={!agreed || start.isPending}
          onClick={() => start.mutate({ planSlug, period })}
        >
          {start.isPending ? 'Создаём платёж…' : `Оплатить ${amount} ₽`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
```

- [ ] **Step 2: Dev-server smoke test**

Click "Купить Pro" on /pricing → modal opens → toggle Month/Year → check oferta → click "Оплатить" → either YooKassa redirect (with valid creds) or visible error in dev.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/billing/checkout-modal.tsx
git commit -m "feat(pricing): add CheckoutModal triggering subscription.startCheckout"
```

---

### Task 24: /settings/billing redesign

**Files:**

- Modify: `apps/web/src/app/(protected)/settings/billing/page.tsx`
- Create: `apps/web/src/components/billing/cancel-subscription-dialog.tsx`
- Create: `apps/web/src/components/billing/order-history-table.tsx`
- Create: `apps/web/src/components/billing/payment-method-card.tsx`
- Modify: `apps/web/src/components/settings/current-plan-card.tsx` (priceMonthly → priceMonthlyKopecks)

- [ ] **Step 1: Fix existing CurrentPlanCard**

In `current-plan-card.tsx`, change `plan.priceMonthly` to `plan.priceMonthlyKopecks` and update `formatPrice` callsite to divide by 100 if it doesn't already.

- [ ] **Step 2: Server billing page**

```tsx
// apps/web/src/app/(protected)/settings/billing/page.tsx
import { Suspense } from 'react'
import { Stack, Typography, Container } from '@repo/ui/components'
import { requireSession } from '@/lib/get-session'
import { prisma } from '@repo/db'
import { CurrentPlanCard } from '@/components/settings/current-plan-card'
import { PaymentMethodCard } from '@/components/billing/payment-method-card'
import { OrderHistoryTable } from '@/components/billing/order-history-table'

export default async function BillingPage() {
  const session = await requireSession()
  const sub = await prisma.subscription.findFirst({
    where: { userId: session.user.id, status: 'ACTIVE' },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  })
  const orders = await prisma.order.findMany({
    where: { userId: session.user.id },
    include: { plan: { select: { name: true, slug: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack spacing={4}>
        <Typography variant="h4">Подписка и оплата</Typography>
        <CurrentPlanCard subscription={sub} />
        {sub?.paymentMethodId && <PaymentMethodCard subscription={sub} />}
        <OrderHistoryTable orders={orders} />
      </Stack>
    </Container>
  )
}
```

- [ ] **Step 3: CurrentPlanCard upgrade**

`current-plan-card.tsx` now needs to accept `subscription` and render:

- Personal → "Бесплатный тариф" + button "Перейти на Pro" → /pricing
- Pro/Max ACTIVE !cancelAtPeriodEnd → "Активна, продление DD.MM.YYYY" + button "Отменить" (opens CancelDialog)
- Pro/Max ACTIVE cancelAtPeriodEnd → "Отменена, доступ до DD.MM.YYYY" + button "Возобновить" (calls trpc resume)

Provide minimal code:

```tsx
'use client'
import Link from 'next/link'
import { useState } from 'react'
import { Card, CardContent, Stack, Chip, Typography, Button } from '@repo/ui/components'
import type { Subscription, Plan } from '@prisma/client'
import { trpc } from '@/trpc/client'
import { CancelSubscriptionDialog } from '@/components/billing/cancel-subscription-dialog'

type Props = { subscription: (Subscription & { plan: Plan }) | null }

export function CurrentPlanCard({ subscription }: Props) {
  const [showCancel, setShowCancel] = useState(false)
  const resume = trpc.subscription.resume.useMutation()

  const slug = subscription?.plan.slug ?? 'personal'
  const name = subscription?.plan.name ?? 'Personal'
  const isPaid = slug !== 'personal'

  let statusLabel = 'Бесплатный тариф'
  if (isPaid && subscription?.currentPeriodEnd) {
    const date = subscription.currentPeriodEnd.toLocaleDateString('ru-RU')
    statusLabel = subscription.cancelAtPeriodEnd
      ? `Отменена, доступ до ${date}`
      : `Активна, продление ${date}`
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" gap={2}>
            <Chip
              label={name}
              color={isPaid ? 'success' : 'default'}
              variant={isPaid ? 'filled' : 'outlined'}
            />
            <Typography>{statusLabel}</Typography>
          </Stack>
          <Stack direction="row" gap={2}>
            {!isPaid && (
              <Button component={Link} href="/pricing" variant="contained">
                Перейти на Pro
              </Button>
            )}
            {isPaid && !subscription?.cancelAtPeriodEnd && (
              <Button color="error" variant="outlined" onClick={() => setShowCancel(true)}>
                Отменить подписку
              </Button>
            )}
            {isPaid && subscription?.cancelAtPeriodEnd && (
              <Button
                variant="contained"
                onClick={() => resume.mutate()}
                disabled={resume.isPending}
              >
                Возобновить
              </Button>
            )}
            {isPaid && (
              <Button component={Link} href="/pricing" variant="text">
                Сменить тариф
              </Button>
            )}
          </Stack>
        </Stack>
      </CardContent>
      <CancelSubscriptionDialog
        open={showCancel}
        periodEnd={subscription?.currentPeriodEnd ?? null}
        onClose={() => setShowCancel(false)}
      />
    </Card>
  )
}
```

- [ ] **Step 4: CancelSubscriptionDialog**

```tsx
// apps/web/src/components/billing/cancel-subscription-dialog.tsx
'use client'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
} from '@repo/ui/components'
import { trpc } from '@/trpc/client'

type Props = { open: boolean; periodEnd: Date | null; onClose: () => void }

export function CancelSubscriptionDialog({ open, periodEnd, onClose }: Props) {
  const cancel = trpc.subscription.cancel.useMutation({ onSuccess: onClose })
  const dateStr = periodEnd?.toLocaleDateString('ru-RU') ?? ''
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Отменить подписку?</DialogTitle>
      <DialogContent>
        <Typography>
          Подписка остаётся активной до {dateStr}, затем перейдёте на Personal без потери данных.
          Лишние пространства останутся доступны для чтения.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Не отменять</Button>
        <Button color="error" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
          Отменить подписку
        </Button>
      </DialogActions>
    </Dialog>
  )
}
```

- [ ] **Step 5: PaymentMethodCard + OrderHistoryTable**

`payment-method-card.tsx` (server-component):

```tsx
import { Card, CardContent, Stack, Typography } from '@repo/ui/components'
import type { Subscription } from '@prisma/client'

export function PaymentMethodCard({ subscription }: { subscription: Subscription }) {
  if (!subscription.paymentMethodId) return null
  const last4 = subscription.paymentMethodLast4 ?? '•••'
  const brand = subscription.paymentMethodBrand ?? 'card'
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack>
          <Typography variant="overline">Способ оплаты</Typography>
          <Typography>
            {brand.toUpperCase()} •••• {last4}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  )
}
```

`order-history-table.tsx`:

```tsx
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Card,
  CardContent,
  Typography,
} from '@repo/ui/components'
import type { Order, Plan } from '@prisma/client'

type Row = Order & { plan: Pick<Plan, 'name' | 'slug'> }

export function OrderHistoryTable({ orders }: { orders: Row[] }) {
  if (orders.length === 0) return null
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" sx={{ mb: 2 }}>
          История платежей
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Дата</TableCell>
              <TableCell>Тариф</TableCell>
              <TableCell>Период</TableCell>
              <TableCell align="right">Сумма</TableCell>
              <TableCell>Статус</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {orders.map((o) => (
              <TableRow key={o.id}>
                <TableCell>{o.createdAt.toLocaleDateString('ru-RU')}</TableCell>
                <TableCell>{o.plan.name}</TableCell>
                <TableCell>{o.billingPeriod === 'MONTHLY' ? 'Месяц' : 'Год'}</TableCell>
                <TableCell align="right">
                  {(o.amountKopecks / 100).toLocaleString('ru-RU')} ₽
                </TableCell>
                <TableCell>{o.status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 6: Type-check + dev smoke test**

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/(protected)/settings/billing/ apps/web/src/components/billing/ apps/web/src/components/settings/current-plan-card.tsx
git commit -m "feat(billing): redesign /settings/billing with current plan, payment method, and order history"
```

---

### Task 25: Landing page tariff section sync + /oferta placeholder

**Files:**

- Modify: `apps/web/src/components/public/content.ts`
- Modify: `apps/web/src/app/(about)/page.tsx`
- Create: `apps/web/src/app/(about)/oferta/page.tsx`

- [ ] **Step 1: Update landingPricingCards**

In `content.ts`, replace `landingPricingCards` with:

```ts
export const landingPricingCards = [
  {
    slug: 'personal',
    name: 'Personal',
    price: 'Бесплатно',
    features: ['1 рабочее пространство', 'Базовый редактор'],
  },
  {
    slug: 'pro',
    name: 'Pro',
    price: 'от 150 ₽/мес',
    features: ['3 пространства', 'До 5 участников', 'Чаты с AI', 'Индексация'],
  },
  {
    slug: 'max',
    name: 'Max',
    price: 'от 1500 ₽/мес',
    features: ['∞ пространств', 'До 100 участников', 'Все модели GigaChat', 'MCP-серверы'],
  },
  {
    slug: 'custom',
    name: 'Собственная инфраструктура',
    price: 'Связаться',
    features: ['Self-hosted', 'SLA', 'Индивидуальные интеграции'],
  },
] as const
```

- [ ] **Step 2: Verify landing renders**

The landing already imports `landingPricingCards` from this file — only the data shape may differ. Update the rendering JSX in `apps/web/src/app/(about)/page.tsx` (~line 147-190) to the new shape (use `name`, `price`, `features` arrays). Each card links to `/pricing`.

- [ ] **Step 3: Create /oferta placeholder**

```tsx
// apps/web/src/app/(about)/oferta/page.tsx
import { Container, Stack, Typography, Alert } from '@repo/ui/components'

export default function OfertaPage() {
  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Stack spacing={3}>
        <Typography variant="h3">Договор-оферта</Typography>
        <Alert severity="info">Документ в подготовке. TODO: legal review.</Alert>
        <Typography variant="body1">
          Настоящий документ содержит условия предоставления услуг сервиса anynote…
        </Typography>
      </Stack>
    </Container>
  )
}
```

- [ ] **Step 4: Type-check + commit**

```bash
git add apps/web/src/components/public/content.ts apps/web/src/app/(about)/page.tsx apps/web/src/app/(about)/oferta/
git commit -m "feat(landing): sync pricing cards with Personal/Pro/Max tiers and add /oferta placeholder"
```

---

## Phase 7 — Engines BillingModule + cron

### Task 26: BillingModule scaffold + YookassaClient factory

**Files:**

- Create: `apps/engines/src/apps/billing/billing.module.ts`
- Create: `apps/engines/src/apps/billing/services/yookassa-client.factory.ts`
- Modify: `apps/engines/src/app.module.ts`
- Modify: `apps/engines/package.json`

(The indexer-side `PlanFeaturesService` for the page-indexing gate is created separately in Task 21 — billing module does not need its own copy.)

- [ ] **Step 1: Add @repo/yookassa dep**

In `apps/engines/package.json`, add:

```json
"dependencies": {
  "@repo/yookassa": "workspace:*",
  ...
}
```

Run: `pnpm install`

- [ ] **Step 2: YookassaClient factory**

```ts
// apps/engines/src/apps/billing/services/yookassa-client.factory.ts
import { Injectable } from '@nestjs/common'
import { YookassaClient } from '@repo/yookassa'

@Injectable()
export class YookassaClientFactory {
  private client: YookassaClient | null = null

  get(): YookassaClient {
    if (this.client) return this.client
    const shopId = process.env.YOOKASSA_SHOP_ID
    const secretKey = process.env.YOOKASSA_SECRET_KEY
    if (!shopId || !secretKey) throw new Error('YOOKASSA_SHOP_ID/SECRET_KEY missing')
    this.client = new YookassaClient({ shopId, secretKey })
    return this.client
  }
}
```

- [ ] **Step 3: BillingModule**

```ts
// apps/engines/src/apps/billing/billing.module.ts
import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { SubscriptionRenewalCronService } from './cron/subscription-renewal-cron.service'
import { SubscriptionRenewalService } from './services/subscription-renewal.service'
import { RefundService } from './services/refund.service'
import { YookassaClientFactory } from './services/yookassa-client.factory'

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    YookassaClientFactory,
    SubscriptionRenewalService,
    RefundService,
    SubscriptionRenewalCronService,
  ],
  exports: [SubscriptionRenewalService, RefundService, YookassaClientFactory],
})
export class BillingModule {}
```

- [ ] **Step 4: Register in AppModule**

In `apps/engines/src/app.module.ts`, add `BillingModule` to imports.

- [ ] **Step 5: Stub services to allow compile**

Create empty service files first:

```ts
// services/subscription-renewal.service.ts
import { Injectable } from '@nestjs/common'
@Injectable()
export class SubscriptionRenewalService {
  async expireCanceled(): Promise<void> {}
  async renewActive(): Promise<void> {}
  async renewOne(_subscriptionId: string): Promise<void> {}
}

// services/refund.service.ts
import { Injectable } from '@nestjs/common'
@Injectable()
export class RefundService {
  async fullRefund(
    _orderId: string,
  ): Promise<{ yookassaRefundId: string; subscriptionId: string }> {
    throw new Error('not implemented')
  }
}

// cron/subscription-renewal-cron.service.ts
import { Injectable } from '@nestjs/common'
@Injectable()
export class SubscriptionRenewalCronService {}
```

- [ ] **Step 6: Type-check engines**

Run: `pnpm --filter @repo/engines check-types`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/engines/src/apps/billing/ apps/engines/src/app.module.ts apps/engines/package.json
git commit -m "feat(engines): scaffold BillingModule with YookassaClientFactory"
```

---

### Task 27: SubscriptionRenewalService.renewOne

**Files:**

- Modify: `apps/engines/src/apps/billing/services/subscription-renewal.service.ts`
- Create: `apps/engines/src/apps/billing/services/__tests__/subscription-renewal.service.spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { SubscriptionRenewalService } from '../subscription-renewal.service'
import { YookassaClientFactory } from '../yookassa-client.factory'
import { prisma } from '@repo/db'

describe('renewOne', () => {
  let svc: SubscriptionRenewalService
  let yk: { chargeWithSavedMethod: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    yk = { chargeWithSavedMethod: vi.fn() }
    const moduleRef = await Test.createTestingModule({
      providers: [
        SubscriptionRenewalService,
        {
          provide: YookassaClientFactory,
          useValue: { get: () => yk },
        },
      ],
    }).compile()
    svc = moduleRef.get(SubscriptionRenewalService)
  })

  it('on succeeded payment: marks Order PAID and extends Subscription', async () => {
    // Arrange: seed user, plan=pro, subscription with currentPeriodEnd in the past, paymentMethodId="pm_x"
    // ... fixture setup
    yk.chargeWithSavedMethod.mockResolvedValue({
      id: 'pmt_renewal_1',
      status: 'succeeded',
      amount: { value: '150.00', currency: 'RUB' },
      created_at: '2026-04-26T00:00:00Z',
    })
    await svc.renewOne(subscriptionId)
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } })
    expect(sub.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now())
    const order = await prisma.order.findFirstOrThrow({
      where: { subscriptionId, isInitial: false },
    })
    expect(order.status).toBe('PAID')
  })

  it('on canceled payment: marks Order FAILED and Subscription EXPIRED', async () => {
    yk.chargeWithSavedMethod.mockResolvedValue({
      id: 'pmt_renewal_2',
      status: 'canceled',
      amount: { value: '150.00', currency: 'RUB' },
      created_at: '2026-04-26T00:00:00Z',
    })
    await svc.renewOne(subscriptionId)
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } })
    expect(sub.status).toBe('EXPIRED')
    const order = await prisma.order.findFirstOrThrow({
      where: { subscriptionId, isInitial: false },
    })
    expect(order.status).toBe('FAILED')
  })
})
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement service**

```ts
// apps/engines/src/apps/billing/services/subscription-renewal.service.ts
import { Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { prisma } from '@repo/db'
import { YookassaClientFactory } from './yookassa-client.factory'

const BATCH = parseInt(process.env.BILLING_RENEWAL_BATCH_SIZE ?? '50', 10)

function addPeriod(start: Date, period: 'MONTHLY' | 'YEARLY'): Date {
  const end = new Date(start)
  if (period === 'MONTHLY') end.setMonth(end.getMonth() + 1)
  else end.setFullYear(end.getFullYear() + 1)
  return end
}

@Injectable()
export class SubscriptionRenewalService {
  private readonly logger = new Logger(SubscriptionRenewalService.name)

  constructor(private readonly yookassaFactory: YookassaClientFactory) {}

  async expireCanceled(): Promise<void> {
    await prisma.subscription.updateMany({
      where: {
        status: 'ACTIVE',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: { not: null, lte: new Date() },
      },
      data: { status: 'EXPIRED', expiredAt: new Date() },
    })
  }

  async renewActive(): Promise<void> {
    const batch = await prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
        paymentMethodId: { not: null },
        currentPeriodEnd: { not: null, lte: new Date() },
      },
      take: BATCH,
      select: { id: true },
    })
    for (const sub of batch) {
      try {
        await this.renewOne(sub.id)
      } catch (err) {
        this.logger.error(`renewOne(${sub.id}) failed`, err)
      }
    }
  }

  async renewOne(subscriptionId: string): Promise<void> {
    const sub = await prisma.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      include: { plan: true },
    })
    if (sub.status !== 'ACTIVE' || !sub.paymentMethodId) return

    const amount =
      sub.billingPeriod === 'MONTHLY' ? sub.plan.priceMonthlyKopecks : sub.plan.priceYearlyKopecks
    const idempotencyKey = randomUUID()

    const order = await prisma.order.create({
      data: {
        userId: sub.userId,
        planId: sub.planId,
        subscriptionId: sub.id,
        billingPeriod: sub.billingPeriod,
        amountKopecks: amount,
        currency: 'RUB',
        status: 'PENDING',
        isInitial: false,
        savedPaymentMethod: true,
        yookassaIdempotencyKey: idempotencyKey,
      },
    })

    const rub = (amount / 100).toFixed(2)
    const periodLabel = sub.billingPeriod === 'MONTHLY' ? 'Месяц' : 'Год'

    let payment
    try {
      payment = await this.yookassaFactory.get().chargeWithSavedMethod(
        {
          amount: { value: rub, currency: 'RUB' },
          payment_method_id: sub.paymentMethodId,
          capture: true,
          description: `Автопродление ${sub.plan.name} (${periodLabel})`,
          metadata: { orderId: order.id, subscriptionId: sub.id },
        },
        idempotencyKey,
      )
    } catch (err) {
      this.logger.error('chargeWithSavedMethod threw', err)
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'FAILED' },
      })
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'EXPIRED', expiredAt: new Date() },
      })
      return
    }

    if (payment.status === 'succeeded') {
      const now = new Date()
      const periodEnd = addPeriod(now, sub.billingPeriod)
      await prisma.$transaction([
        prisma.order.update({
          where: { id: order.id },
          data: { status: 'PAID', paidAt: now, yookassaPaymentId: payment.id },
        }),
        prisma.subscription.update({
          where: { id: sub.id },
          data: { currentPeriodStart: now, currentPeriodEnd: periodEnd },
        }),
      ])
    } else if (payment.status === 'canceled') {
      await prisma.$transaction([
        prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED', yookassaPaymentId: payment.id },
        }),
        prisma.subscription.update({
          where: { id: sub.id },
          data: { status: 'EXPIRED', expiredAt: new Date() },
        }),
      ])
    } else {
      // pending — wait for webhook
      await prisma.order.update({
        where: { id: order.id },
        data: { yookassaPaymentId: payment.id },
      })
    }
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @repo/engines test subscription-renewal`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/billing/services/
git commit -m "feat(engines): implement SubscriptionRenewalService.renewOne with idempotent YooKassa charge"
```

---

### Task 28: SubscriptionRenewalCronService

**Files:**

- Modify: `apps/engines/src/apps/billing/cron/subscription-renewal-cron.service.ts`

- [ ] **Step 1: Implement cron**

```ts
import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { SubscriptionRenewalService } from '../services/subscription-renewal.service'

@Injectable()
export class SubscriptionRenewalCronService {
  private readonly logger = new Logger(SubscriptionRenewalCronService.name)

  constructor(private readonly renewals: SubscriptionRenewalService) {}

  @Cron(process.env.BILLING_RENEWAL_CRON_EXPRESSION ?? '0 0 0 * * *', {
    timeZone: 'Europe/Moscow',
  })
  async processEndOfDay() {
    this.logger.log('Billing cron: end-of-day processing')
    await this.renewals.expireCanceled()
    await this.renewals.renewActive()
  }
}
```

- [ ] **Step 2: Add env vars to .env.example + turbo.json**

```
BILLING_RENEWAL_CRON_EXPRESSION=0 0 0 * * *
BILLING_RENEWAL_BATCH_SIZE=50
```

In `turbo.json` `globalEnv`: add `"BILLING_RENEWAL_CRON_EXPRESSION", "BILLING_RENEWAL_BATCH_SIZE"`.

- [ ] **Step 3: Type-check + commit**

```bash
git add apps/engines/src/apps/billing/cron/ .env.example turbo.json
git commit -m "feat(engines): add SubscriptionRenewalCronService at 00:00 МСК daily"
```

---

### Task 29: RefundService

**Files:**

- Modify: `apps/engines/src/apps/billing/services/refund.service.ts`
- Create: `apps/engines/src/apps/billing/services/__tests__/refund.service.spec.ts`

- [ ] **Step 1: Failing test**

```ts
describe('RefundService.fullRefund', () => {
  it('creates YooKassa refund and marks Order REFUNDED, Subscription EXPIRED', async () => {
    // seed PAID order linked to ACTIVE subscription
    yk.createRefund.mockResolvedValue({
      id: 'rf_1',
      payment_id: 'pmt_1',
      status: 'succeeded',
      amount: { value: '150.00', currency: 'RUB' },
      created_at: '2026-04-26T00:00:00Z',
    })
    const result = await svc.fullRefund(orderId)
    expect(result.yookassaRefundId).toBe('rf_1')
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } })
    expect(order.status).toBe('REFUNDED')
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } })
    expect(sub.status).toBe('EXPIRED')
  })

  it('rejects already-refunded order', async () => {
    // seed REFUNDED order
    await expect(svc.fullRefund(orderId)).rejects.toThrow(/already refunded/i)
  })
})
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

```ts
import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { prisma } from '@repo/db'
import { YookassaClientFactory } from './yookassa-client.factory'

@Injectable()
export class RefundService {
  constructor(private readonly yookassaFactory: YookassaClientFactory) {}

  async fullRefund(orderId: string): Promise<{ yookassaRefundId: string; subscriptionId: string }> {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    })
    if (order.status !== 'PAID' || order.refundedAt) {
      throw new Error(`Order ${orderId} is already refunded or not paid`)
    }
    if (!order.yookassaPaymentId) {
      throw new Error(`Order ${orderId} has no YooKassa payment id`)
    }
    if (!order.subscriptionId) {
      throw new Error(`Order ${orderId} has no subscription`)
    }

    const refund = await this.yookassaFactory.get().createRefund(
      {
        payment_id: order.yookassaPaymentId,
        amount: { value: (order.amountKopecks / 100).toFixed(2), currency: 'RUB' },
        description: 'Возврат',
      },
      randomUUID(),
    )

    await prisma.$transaction([
      prisma.order.update({
        where: { id: orderId },
        data: { status: 'REFUNDED', refundedAt: new Date(), yookassaRefundId: refund.id },
      }),
      prisma.subscription.update({
        where: { id: order.subscriptionId },
        data: { status: 'EXPIRED', expiredAt: new Date(), currentPeriodEnd: new Date() },
      }),
    ])

    return { yookassaRefundId: refund.id, subscriptionId: order.subscriptionId }
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/billing/services/refund.service.ts apps/engines/src/apps/billing/services/__tests__/refund.service.spec.ts
git commit -m "feat(engines): implement RefundService.fullRefund with EXPIRED soft-downgrade"
```

---

## Phase 8 — Engines CLI (nest-commander)

### Task 30: nest-commander setup + cli.ts entry

**Files:**

- Modify: `apps/engines/package.json`
- Create: `apps/engines/src/cli.ts`
- Create: `apps/engines/src/cli.module.ts`

- [ ] **Step 1: Add nest-commander dep**

In `apps/engines/package.json`, add:

```json
"dependencies": {
  "nest-commander": "^3.x",
  ...
},
"scripts": {
  "cli": "tsx src/cli.ts",
  "cli:prod": "node dist/cli.js"
}
```

Run: `pnpm install`

- [ ] **Step 2: cli.ts entry**

```ts
// apps/engines/src/cli.ts
import { CommandFactory } from 'nest-commander'
import { CliModule } from './cli.module'

async function bootstrap() {
  await CommandFactory.run(CliModule, { logger: ['error', 'warn', 'log'] })
}
bootstrap().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 3: CliModule**

```ts
// apps/engines/src/cli.module.ts
import { Module } from '@nestjs/common'
import { BillingModule } from './apps/billing/billing.module'
import { IndexerModule } from './apps/indexer/indexer.module'

@Module({
  imports: [BillingModule, IndexerModule],
})
export class CliModule {}
```

(Commands will be added as providers in BillingModule and IndexerModule respectively in next tasks.)

- [ ] **Step 4: Smoke test**

Run: `pnpm --filter @repo/engines cli --help`
Expected: prints usage (will be empty until commands added in Task 31).

- [ ] **Step 5: Commit**

```bash
git add apps/engines/package.json apps/engines/src/cli.ts apps/engines/src/cli.module.ts
git commit -m "feat(engines): scaffold nest-commander CLI with shared module"
```

---

### Task 31: RefundCommand

**Files:**

- Create: `apps/engines/src/apps/billing/commands/refund.command.ts`
- Modify: `apps/engines/src/apps/billing/billing.module.ts`

- [ ] **Step 1: Implement command**

```ts
// apps/engines/src/apps/billing/commands/refund.command.ts
import { Command, CommandRunner } from 'nest-commander'
import { RefundService } from '../services/refund.service'

@Command({
  name: 'refund',
  description: 'Полный возврат по Order id',
  arguments: '<orderId>',
})
export class RefundCommand extends CommandRunner {
  constructor(private readonly refunds: RefundService) {
    super()
  }

  async run(passedParams: string[]): Promise<void> {
    const [orderId] = passedParams
    if (!orderId) {
      console.error('Usage: cli refund <orderId>')
      process.exit(1)
    }
    const result = await this.refunds.fullRefund(orderId)
    console.log('✓ Refunded:', result.yookassaRefundId)
    console.log('✓ Order:', orderId, '→ REFUNDED')
    console.log('✓ Subscription:', result.subscriptionId, '→ EXPIRED')
  }
}
```

- [ ] **Step 2: Register in BillingModule**

In `billing.module.ts`, add `RefundCommand` to providers:

```ts
import { RefundCommand } from './commands/refund.command'

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    YookassaClientFactory,
    SubscriptionRenewalService,
    RefundService,
    SubscriptionRenewalCronService,
    RefundCommand,
  ],
  exports: [SubscriptionRenewalService, RefundService, YookassaClientFactory],
})
export class BillingModule {}
```

- [ ] **Step 3: Smoke test**

Run: `pnpm --filter @repo/engines cli refund --help`
Expected: prints command description.

Run: `pnpm --filter @repo/engines cli refund <test-order-id>` against a seeded PAID order with mock-creds (or real test creds) → expect successful refund.

- [ ] **Step 4: Commit**

```bash
git add apps/engines/src/apps/billing/commands/refund.command.ts apps/engines/src/apps/billing/billing.module.ts
git commit -m "feat(engines): add 'refund <orderId>' CLI command"
```

---

### Task 32: ForceRenew + CancelSubscription commands + migrate backfill-reindex

**Files:**

- Create: `apps/engines/src/apps/billing/commands/force-renew.command.ts`
- Create: `apps/engines/src/apps/billing/commands/cancel-subscription.command.ts`
- Modify: `apps/engines/src/apps/billing/billing.module.ts`
- Modify or create: `apps/engines/src/apps/indexer/commands/backfill-reindex.command.ts` (migrating from existing standalone script)

- [ ] **Step 1: ForceRenewCommand**

```ts
import { Command, CommandRunner } from 'nest-commander'
import { SubscriptionRenewalService } from '../services/subscription-renewal.service'

@Command({
  name: 'force-renew',
  description: 'Force-renew subscription bypassing currentPeriodEnd',
  arguments: '<subscriptionId>',
})
export class ForceRenewCommand extends CommandRunner {
  constructor(private readonly renewals: SubscriptionRenewalService) {
    super()
  }
  async run([subscriptionId]: string[]): Promise<void> {
    if (!subscriptionId) {
      console.error('Usage: cli force-renew <subscriptionId>')
      process.exit(1)
    }
    await this.renewals.renewOne(subscriptionId)
    console.log('✓ Renewal attempted for', subscriptionId)
  }
}
```

- [ ] **Step 2: CancelSubscriptionCommand**

```ts
import { Command, CommandRunner } from 'nest-commander'
import { prisma } from '@repo/db'

@Command({
  name: 'cancel-subscription',
  description: 'Set cancelAtPeriodEnd=true on a subscription (admin)',
  arguments: '<subscriptionId>',
})
export class CancelSubscriptionCommand extends CommandRunner {
  async run([subscriptionId]: string[]): Promise<void> {
    if (!subscriptionId) {
      console.error('Usage: cli cancel-subscription <subscriptionId>')
      process.exit(1)
    }
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { cancelAtPeriodEnd: true, cancelledAt: new Date() },
    })
    console.log('✓ Subscription marked cancelAtPeriodEnd=true')
  }
}
```

- [ ] **Step 3: Migrate backfill-reindex**

Create `apps/engines/src/apps/indexer/commands/backfill-reindex.command.ts`:

```ts
import { Command, CommandRunner } from 'nest-commander'
// import the underlying logic from the old standalone script (extract into a service)

@Command({ name: 'backfill-reindex', description: 'Re-emit OutboxEvent for all TEXT pages' })
export class BackfillReindexCommand extends CommandRunner {
  async run(): Promise<void> {
    // call out to the extracted service
  }
}
```

If the old script has logic worth preserving, extract it into `apps/engines/src/apps/indexer/services/backfill-reindex.service.ts` and call from this command. Then delete the old `apps/engines/src/cli/backfill-reindex.ts`.

- [ ] **Step 4: Register all commands**

In `billing.module.ts` providers add `ForceRenewCommand`, `CancelSubscriptionCommand`. In `indexer.module.ts` providers add `BackfillReindexCommand`.

- [ ] **Step 5: Smoke test all CLI commands**

```
pnpm --filter @repo/engines cli refund --help
pnpm --filter @repo/engines cli force-renew --help
pnpm --filter @repo/engines cli cancel-subscription --help
pnpm --filter @repo/engines cli backfill-reindex --help
```

All print usage cleanly.

- [ ] **Step 6: Type-check + commit**

```bash
git add apps/engines/src/apps/billing/commands/ apps/engines/src/apps/indexer/commands/ apps/engines/src/apps/billing/billing.module.ts apps/engines/src/apps/indexer/indexer.module.ts
git rm apps/engines/src/cli/backfill-reindex.ts
git commit -m "feat(engines): add force-renew/cancel-subscription CLI and migrate backfill-reindex"
```

---

## Phase 9 — Soft-downgrade write guards

### Task 33: Apply requireWritableWorkspace in mutations

**Files:**

- Modify: `packages/trpc/src/routers/page.ts` (or wherever page mutations live)
- Modify: `packages/trpc/src/routers/member.ts` (invite mutation)

- [ ] **Step 1: Identify all write mutations**

Run: `grep -rn "protectedProcedure" packages/trpc/src/routers/ | grep -E "(page|member|workspace)"`
List every `.mutation(...)` inside these routers that operates on a `workspaceId` argument.

Likely candidates:

- `page.create`, `page.update`, `page.delete`, `page.duplicate`, `page.rename`
- `member.invite`, `member.remove`
- `workspace.update`, `workspace.delete`

- [ ] **Step 2: Add guard to each**

For every identified mutation that has `input.workspaceId` (or accepts `pageId` whose page belongs to a workspace), insert at the top of the resolver:

```ts
import { requireWritableWorkspace } from '../helpers/plan'

// inside resolver, before write:
await requireWritableWorkspace(input.workspaceId, ctx.user.id)
```

For mutations addressing a `pageId`:

```ts
const page = await ctx.prisma.page.findUniqueOrThrow({
  where: { id: input.pageId },
  select: { workspaceId: true },
})
await requireWritableWorkspace(page.workspaceId, ctx.user.id)
```

For `workspace.create`:

```ts
// soft limit on creating new workspace beyond plan's maxWorkspaces
const ownedCount = await ctx.prisma.workspace.count({ where: { ownerId: ctx.user.id } })
const features = await getActivePlanFeaturesForUser(ctx.user.id) // similar helper
if (features.maxWorkspaces !== null && ownedCount >= features.maxWorkspaces) {
  throw new TRPCError({ code: 'FORBIDDEN', message: 'WORKSPACE_OVER_PLAN_LIMIT' })
}
```

(Add `getActivePlanFeaturesForUser` helper if needed — mirror of `getWorkspaceFeatures` but keyed by user id.)

- [ ] **Step 3: Tests**

Add a test per affected router verifying:

- Personal owner with 1 workspace → mutation succeeds
- Personal owner with 2 workspaces (created earlier) → 2nd workspace mutation throws `WORKSPACE_OVER_PLAN_LIMIT`

- [ ] **Step 4: Run all trpc tests**

Run: `pnpm --filter @repo/trpc test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/ packages/trpc/src/helpers/plan.ts
git commit -m "feat(trpc): enforce requireWritableWorkspace on page/member/workspace mutations"
```

---

## Phase 10 — End-to-end test (Playwright)

### Task 34: E2E billing flow

**Files:**

- Create: `apps/e2e/billing.spec.ts`
- Possibly create: `apps/e2e/fixtures/yookassa-mock.ts`

- [ ] **Step 1: Mock YooKassa**

For local-only E2E, the simplest path is to bypass real YooKassa by injecting a stub via env vars and a request interceptor in the dev server:

Option A — fixture-based: in test setup, monkey-patch `getYookassaClient` via a test-only env hook (e.g., `YOOKASSA_MOCK_ENABLED=true` checked inside `apps/web/src/server/yookassa.ts` to return an in-memory mock).

Document this in the spec follow-up — for v1, accept that this E2E task documents the _flow_ but full mocking infrastructure is its own follow-up if not feasible inside this plan.

- [ ] **Step 2: Test cases**

```ts
// apps/e2e/billing.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Billing flow', () => {
  test('New user lands on Personal and /chats returns 404', async ({ page }) => {
    // sign up via existing helper
    // open workspace
    await expect(page.getByText('Personal')).toBeVisible()
    await page.goto(`/workspaces/${workspaceId}/chats`)
    await expect(page.getByText('404')).toBeVisible()
  })

  test('Pro purchase flow shows Pro chip and unlocks /chats', async ({ page }) => {
    // configure YOOKASSA_MOCK to return immediate succeeded payment
    await page.goto('/pricing')
    await page
      .getByRole('button', { name: /Купить/ })
      .first()
      .click()
    await page.getByLabel(/Принимаю условия/).check()
    await page.getByRole('button', { name: /Оплатить/ }).click()
    // mock redirects back to /billing/return immediately and webhook fires
    await expect(page).toHaveURL(/\/billing\/return/)
    await expect(page.getByText(/Оплата прошла/)).toBeVisible({ timeout: 10_000 })
    await page.goto(`/workspaces/${workspaceId}/chats`)
    await expect(page.getByText(/404/)).not.toBeVisible()
    await expect(page.getByRole('region', { name: /chip/i })).toContainText('Pro')
  })

  test('Cancel flow shows access until period end', async ({ page }) => {
    // Pre-seed an ACTIVE Pro subscription with currentPeriodEnd in 5s
    await page.goto('/settings/billing')
    await page.getByRole('button', { name: /Отменить подписку/ }).click()
    await page.getByRole('button', { name: /Отменить подписку/ }).click() // confirm
    await expect(page.getByText(/Отменена, доступ до/)).toBeVisible()
    // Run cron via API hook or wait & re-test
  })
})
```

- [ ] **Step 3: Run dev server + e2e**

```bash
# Terminal 1
pnpm dev

# Terminal 2
pnpm exec playwright test apps/e2e/billing.spec.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/e2e/billing.spec.ts apps/e2e/fixtures/yookassa-mock.ts
git commit -m "test(billing): E2E flow for Personal default → Pro purchase → cancel"
```

---

## Final verification checklist

After all 34 tasks complete:

- [ ] `pnpm check-types` — PASS across all workspaces
- [ ] `pnpm lint` — PASS (max-warnings 0)
- [ ] `pnpm test` — all unit tests PASS
- [ ] `pnpm exec playwright test apps/e2e/billing.spec.ts` — PASS
- [ ] Manual smoke: sign up new user → see Personal → /chats 404 → /pricing → modal → checkout (with real YooKassa test creds) → return → Pro Chip + /chats accessible
- [ ] Manual: cancel from /settings/billing → "доступ до DD.MM.YYYY" → resume → "Активна, продление DD.MM.YYYY"
- [ ] Manual: in apps/engines, `pnpm --filter @repo/engines cli refund <orderId>` → Order REFUNDED, Subscription EXPIRED
- [ ] Cron sanity: set `BILLING_RENEWAL_CRON_EXPRESSION=*/30 * * * * *` temporarily and observe `expireCanceled` + `renewActive` logs

When all checks pass, prepare PR description summarizing the new tariff structure, capability flags, payment flow, and known limitations from the spec's "Known limitations" section.
