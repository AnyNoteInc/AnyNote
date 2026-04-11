# Workspaces and Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/settings/{general,account,billing,integrations}`, `/workspaces/new`, and the Notion-style `/workspaces/[workspaceId]` onboarding page, backed by a minimal Prisma schema merge that adds workspaces, integrations, and plan/subscription billing.

**Architecture:** A single Prisma migration portals the subset of `docs/database.md` we need (Workspace, WorkspaceMember, UserPreference, Page skeleton) plus two greenfield domains (integration_providers + integrations, plans + subscriptions). A new `(protected)` route group collapses auth gating and tRPC provider setup into one place. tRPC routers are refactored into four namespaces (user / workspace / subscription / integration). The Notion-style onboarding page is fully static JSX — no Block/Page records are read or written in this iteration.

**Tech Stack:** Next.js 16 App Router · React 19 · Prisma 7 (PrismaPg adapter) · tRPC v11 · @tanstack/react-query v5 · better-auth 1.4.9 · MUI v6 · Playwright.

**Reference spec:** `docs/specs/2026-04-11-workspaces-and-settings.md` — read this before starting. All architectural decisions and their rationale live there; this plan is only "how to implement it step by step."

---

## File structure

### Created

**Schema & seed**

- `packages/db/prisma/migrations/20260411XXXXXX_workspaces_settings_billing_integrations/migration.sql` — tables, enums, raw-SQL constraints, inline seed, data backfill
- `packages/db/prisma/seed.ts` — idempotent upsert for fresh dev/CI environments

**tRPC layer (refactor `packages/trpc/src/`)**

- `packages/trpc/src/trpc.ts` — shared `initTRPC` instance, context, `publicProcedure`, `protectedProcedure`
- `packages/trpc/src/routers/user.ts` — preferences, profile, theme, sessions
- `packages/trpc/src/routers/workspace.ts` — create, getById, listMine, getDefault
- `packages/trpc/src/routers/subscription.ts` — getCurrent, listHistory
- `packages/trpc/src/routers/integration.ts` — listProviders, listMine, connect, disconnect
- `packages/trpc/src/helpers/plan.ts` — `getActivePlanForUser`

**Route group & shared shells**

- `apps/web/src/app/(protected)/layout.tsx`
- `apps/web/src/app/(protected)/app/page.tsx`
- `apps/web/src/app/(protected)/settings/layout.tsx`
- `apps/web/src/app/(protected)/settings/general/page.tsx`
- `apps/web/src/app/(protected)/settings/account/page.tsx`
- `apps/web/src/app/(protected)/settings/billing/page.tsx`
- `apps/web/src/app/(protected)/settings/integrations/page.tsx`
- `apps/web/src/app/(protected)/workspaces/new/page.tsx`
- `apps/web/src/app/(protected)/workspaces/[workspaceId]/layout.tsx`
- `apps/web/src/app/(protected)/workspaces/[workspaceId]/page.tsx`

**Settings components (`apps/web/src/components/settings/`)**

- `settings-nav.tsx` (client) — the 4-item left nav with active highlighting
- `profile-section.tsx` (client) — avatar placeholder + name/email inputs
- `theme-section.tsx` (client) — 3 theme cards
- `notifications-section.tsx` (client) — 3 Switch controls
- `sign-out-button.tsx` (client)
- `sessions-table.tsx` (client) — active sessions with terminate action
- `current-plan-card.tsx` — active plan card
- `subscription-history-table.tsx` — history table
- `integration-card.tsx` (client) — provider card with connect/disconnect modal

**Workspace components (`apps/web/src/components/workspace/`)**

- `workspace-shell.tsx` — 3-column grid + forced dark MUI theme provider
- `workspace-sidebar.tsx` (client) — left sidebar
- `workspace-toolbar.tsx` — top row of center column
- `workspace-onboarding.tsx` — the centered 480px column with emoji, h1, checklist
- `workspace-ai-panel.tsx` (client) — right AI sidebar
- `cookie-banner.tsx` (client) — floating banner with localStorage dismissal

**E2E**

- `apps/e2e/workspace-flow.spec.ts` — sign-up → no default → new → default workspace → settings nav → free-plan limit

### Modified

- `packages/db/prisma/schema.prisma` — add enums + 8 new models + User back-relations
- `packages/db/package.json` — add `"prisma": { "seed": "tsx prisma/seed.ts" }` and a `prisma:seed` script; add `tsx` devDependency if not already present
- `packages/auth/src/auth.ts` — `databaseHooks.user.create.after` creates FREE subscription + empty UserPreference row
- `packages/trpc/src/index.ts` — reorganized into the namespaced `appRouter`, re-exports from routers/
- `apps/web/src/app/layout.tsx` — read theme from `user_preferences.theme` (authed) or cookie, pass to `<UiProvider mode>`
- `packages/ui/src/providers/ui-provider.tsx` — accept optional `mode` prop (override to the theme value read by the server)

### Deleted

- `apps/web/src/app/app/layout.tsx` — auth and tRPC provider moved to `(protected)/layout.tsx`
- `apps/web/src/app/app/page.tsx` — moved to `(protected)/app/page.tsx` as a pure redirect
- `apps/web/src/app/app/` directory (entire thing)

---

## Verification strategy

Unit tests for tRPC routers would require a new test framework (project has none). Instead, this plan verifies via:

1. **Type and build checks** after each code-heavy task: `pnpm check-types`, `pnpm lint` at `apps/web`, `packages/trpc`, `packages/db`.
2. **Migration smoke**: `pnpm --filter @repo/db prisma:generate` and `prisma migrate dev` against the local docker Postgres.
3. **Dev server smoke** at phase boundaries: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/<route>`.
4. **Playwright spec `workspace-flow.spec.ts`** as the end-to-end safety net — covers sign-up redirect, workspace creation, settings nav, and free-plan limit.

"Red" in TDD steps below means: run the verification command and get a failing result first (types error, migration error, 500, 404, test red). "Green" means: same command passes after the fix. This keeps classical TDD rhythm even when the "test" is `pnpm check-types`.

---

## Task list

### Task 1: Add new enums to `schema.prisma`

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1.1 — Add the five new enums**

Append after the existing `Jwks` model, before the end of the file:

```prisma
enum RoleType {
  OWNER
  ADMIN
  EDITOR
  COMMENTER
  VIEWER
  GUEST
}

enum ParentType {
  WORKSPACE
  PAGE
  DATABASE
  BLOCK
}

enum IntegrationScope {
  USER
  WORKSPACE
  BOTH
}

enum IntegrationStatus {
  PENDING
  CONNECTED
  DISCONNECTED
  ERROR
}

enum SubscriptionStatus {
  TRIAL
  ACTIVE
  CANCELED
  EXPIRED
  PAST_DUE
}
```

- [ ] **Step 1.2 — Verify the schema still parses**

```bash
pnpm --filter @repo/db prisma:generate
```

Expected: exits 0, `@prisma/client` regenerated. If it fails with "Field/enum already exists" or similar, check that you didn't duplicate a name.

- [ ] **Step 1.3 — Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add enums for workspaces, integrations, and subscriptions"
```

---

### Task 2: Add `Workspace` and `WorkspaceMember` models

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 2.1 — Append the two models**

```prisma
model Workspace {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name        String   @db.VarChar(255)
  slug        String?  @unique @db.VarChar(255)
  icon        String?  @db.VarChar(64)
  createdById String?  @map("created_by_id") @db.Uuid
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  createdBy             User?             @relation("WorkspaceCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
  members               WorkspaceMember[]
  pages                 Page[]
  workspaceIntegrations Integration[]     @relation("WorkspaceIntegrations")
  defaultForUsers       UserPreference[]  @relation("DefaultWorkspace")

  @@index([createdById])
  @@map("workspaces")
}

model WorkspaceMember {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  userId      String   @map("user_id") @db.Uuid
  role        RoleType
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, userId])
  @@index([workspaceId])
  @@index([userId])
  @@index([userId, role])
  @@map("workspace_members")
}
```

- [ ] **Step 2.2 — Verify the schema parses (it will fail — missing User back-relations)**

```bash
pnpm --filter @repo/db prisma:generate
```

Expected: **FAIL** with errors like `The relation field "createdBy" on Model "Workspace" is missing an opposite relation field on the model "User"`. Good — we want red before green.

- [ ] **Step 2.3 — Add the User back-relations**

In the `User` model, right before the closing `}`, append:

```prisma
  createdWorkspaces    Workspace[]       @relation("WorkspaceCreatedBy")
  workspaceMemberships WorkspaceMember[]
```

- [ ] **Step 2.4 — Verify the schema parses (green)**

```bash
pnpm --filter @repo/db prisma:generate
```

Expected: exits 0.

- [ ] **Step 2.5 — Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add Workspace and WorkspaceMember models"
```

---

### Task 3: Add `Page` skeleton model

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 3.1 — Append the Page model**

```prisma
model Page {
  id            String     @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId   String     @map("workspace_id") @db.Uuid
  parentType    ParentType @map("parent_type")
  parentId      String?    @map("parent_id") @db.Uuid
  title         String?    @db.Text
  icon          String?    @db.Text
  coverUrl      String?    @map("cover_url") @db.Text
  isDatabaseRow Boolean    @default(false) @map("is_database_row")
  archived      Boolean    @default(false)
  deletedAt     DateTime?  @map("deleted_at") @db.Timestamptz(6)
  createdById   String?    @map("created_by_id") @db.Uuid
  updatedById   String?    @map("updated_by_id") @db.Uuid
  createdAt     DateTime   @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime   @updatedAt @map("updated_at") @db.Timestamptz(6)

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  createdBy User?     @relation("PageCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
  updatedBy User?     @relation("PageUpdatedBy", fields: [updatedById], references: [id], onDelete: SetNull)

  @@index([workspaceId])
  @@index([parentType, parentId])
  @@index([archived])
  @@map("pages")
}
```

- [ ] **Step 3.2 — Add User back-relations**

In `User`, append next to the existing back-relations:

```prisma
  createdPages Page[] @relation("PageCreatedBy")
  updatedPages Page[] @relation("PageUpdatedBy")
```

- [ ] **Step 3.3 — Verify**

```bash
pnpm --filter @repo/db prisma:generate
```

Expected: exits 0.

- [ ] **Step 3.4 — Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add Page skeleton model (no Block relations yet)"
```

---

### Task 4: Add `UserPreference` model

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 4.1 — Append UserPreference**

```prisma
model UserPreference {
  id                   String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId               String    @unique @map("user_id") @db.Uuid
  theme                String?   @db.VarChar(16)
  locale               String?   @db.VarChar(16)
  defaultWorkspaceId   String?   @map("default_workspace_id") @db.Uuid
  notificationSettings Json?     @map("notification_settings")
  createdAt            DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt            DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  user             User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  defaultWorkspace Workspace? @relation("DefaultWorkspace", fields: [defaultWorkspaceId], references: [id], onDelete: SetNull)

  @@index([defaultWorkspaceId])
  @@map("user_preferences")
}
```

- [ ] **Step 4.2 — Add User back-relation**

```prisma
  preferences UserPreference?
```

- [ ] **Step 4.3 — Verify and commit**

```bash
pnpm --filter @repo/db prisma:generate
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add UserPreference model"
```

---

### Task 5: Add `IntegrationProvider` and `Integration` models

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 5.1 — Append both models**

```prisma
model IntegrationProvider {
  id           String           @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  slug         String           @unique @db.VarChar(50)
  name         String           @db.VarChar(100)
  description  String?          @db.Text
  iconUrl      String?          @map("icon_url") @db.Text
  scope        IntegrationScope
  isEnabled    Boolean          @default(true) @map("is_enabled")
  configSchema Json?            @map("config_schema")
  sortOrder    Int              @default(0) @map("sort_order")
  createdAt    DateTime         @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime         @updatedAt @map("updated_at") @db.Timestamptz(6)

  integrations Integration[]

  @@map("integration_providers")
}

model Integration {
  id           String            @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  providerId   String            @map("provider_id") @db.Uuid
  scope        IntegrationScope
  userId       String?           @map("user_id") @db.Uuid
  workspaceId  String?           @map("workspace_id") @db.Uuid
  status       IntegrationStatus @default(PENDING)
  externalId   String?           @map("external_id") @db.VarChar(255)
  config       Json?
  credentials  Json?
  connectedAt  DateTime?         @map("connected_at") @db.Timestamptz(6)
  lastSyncAt   DateTime?         @map("last_sync_at") @db.Timestamptz(6)
  errorMessage String?           @map("error_message") @db.Text
  createdAt    DateTime          @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime          @updatedAt @map("updated_at") @db.Timestamptz(6)

  provider  IntegrationProvider @relation(fields: [providerId], references: [id], onDelete: Restrict)
  user      User?               @relation("UserIntegrations", fields: [userId], references: [id], onDelete: Cascade)
  workspace Workspace?          @relation("WorkspaceIntegrations", fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([providerId])
  @@index([userId])
  @@index([workspaceId])
  @@index([status])
  @@map("integrations")
}
```

- [ ] **Step 5.2 — Add User back-relation**

```prisma
  userIntegrations Integration[] @relation("UserIntegrations")
```

- [ ] **Step 5.3 — Verify and commit**

```bash
pnpm --filter @repo/db prisma:generate
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add IntegrationProvider and Integration models"
```

---

### Task 6: Add `Plan` and `Subscription` models

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 6.1 — Append both models**

```prisma
model Plan {
  id                     String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  slug                   String   @unique @db.VarChar(50)
  name                   String   @db.VarChar(100)
  description            String?  @db.Text
  priceMonthly           Int      @default(0) @map("price_monthly")
  currency               String   @default("RUB") @db.VarChar(3)
  maxWorkspaces          Int?     @map("max_workspaces")
  maxMembersPerWorkspace Int?     @map("max_members_per_workspace")
  features               Json     @default("[]")
  isActive               Boolean  @default(true) @map("is_active")
  sortOrder              Int      @default(0) @map("sort_order")
  createdAt              DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt              DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  subscriptions Subscription[]

  @@map("plans")
}

model Subscription {
  id                     String             @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId                 String             @map("user_id") @db.Uuid
  planId                 String             @map("plan_id") @db.Uuid
  status                 SubscriptionStatus @default(ACTIVE)
  startedAt              DateTime           @default(now()) @map("started_at") @db.Timestamptz(6)
  currentPeriodEnd       DateTime?          @map("current_period_end") @db.Timestamptz(6)
  canceledAt             DateTime?          @map("canceled_at") @db.Timestamptz(6)
  paymentProvider        String?            @map("payment_provider") @db.VarChar(32)
  providerSubscriptionId String?            @map("provider_subscription_id") @db.VarChar(255)
  amountPaid             Int?               @map("amount_paid")
  currency               String?            @db.VarChar(3)
  metadata               Json?
  createdAt              DateTime           @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt              DateTime           @updatedAt @map("updated_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  plan Plan @relation(fields: [planId], references: [id], onDelete: Restrict)

  @@index([userId])
  @@index([planId])
  @@index([userId, status])
  @@map("subscriptions")
}
```

- [ ] **Step 6.2 — Add User back-relation**

```prisma
  subscriptions Subscription[]
```

- [ ] **Step 6.3 — Verify**

```bash
pnpm --filter @repo/db prisma:generate
```

Expected: exits 0.

- [ ] **Step 6.4 — Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add Plan and Subscription models"
```

---

### Task 7: Generate migration and append raw SQL

**Files:**

- Create: `packages/db/prisma/migrations/<TIMESTAMP>_workspaces_settings_billing_integrations/migration.sql`

- [ ] **Step 7.1 — Start local Postgres if not running**

```bash
docker compose up -d postgres
```

Expected: `Container ... Running` or `Started`. Wait a few seconds for healthcheck.

- [ ] **Step 7.2 — Generate the migration without applying it**

```bash
cd packages/db
pnpm exec prisma migrate dev --create-only --name workspaces_settings_billing_integrations
cd -
```

Expected: a new directory `packages/db/prisma/migrations/<timestamp>_workspaces_settings_billing_integrations/` with `migration.sql` that contains the Prisma-generated DDL for enums and all 8 new tables.

- [ ] **Step 7.3 — Append manual additions to `migration.sql`**

Open the generated `migration.sql` and add the following at the **top** of the file (before any DDL):

```sql
-- Required for gen_random_uuid() in raw SQL inserts below.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

Then, at the **bottom** of the file after all `CREATE TABLE`/`CREATE INDEX` statements, append:

```sql
-- ---- manual additions below ----

-- Scope invariant: a user-scoped integration must have user_id (not workspace_id), and vice versa.
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_scope_target_check" CHECK (
  ("scope" = 'USER'      AND "user_id" IS NOT NULL AND "workspace_id" IS NULL)
  OR
  ("scope" = 'WORKSPACE' AND "workspace_id" IS NOT NULL AND "user_id" IS NULL)
);

-- Partial uniques: one live (PENDING/CONNECTED) integration per (provider, user) or (provider, workspace).
-- DISCONNECTED rows accumulate for history.
CREATE UNIQUE INDEX "integrations_user_provider_unique"
  ON "integrations" ("provider_id", "user_id")
  WHERE "scope" = 'USER' AND "status" IN ('PENDING', 'CONNECTED');

CREATE UNIQUE INDEX "integrations_workspace_provider_unique"
  ON "integrations" ("provider_id", "workspace_id")
  WHERE "scope" = 'WORKSPACE' AND "status" IN ('PENDING', 'CONNECTED');

-- Only one active subscription per user. Canceled/expired rows accumulate for history.
CREATE UNIQUE INDEX "subscriptions_one_active_per_user"
  ON "subscriptions" ("user_id")
  WHERE "status" IN ('TRIAL', 'ACTIVE', 'PAST_DUE');

-- ---- seed: integration_providers ----
INSERT INTO "integration_providers" ("id", "slug", "name", "description", "scope", "is_enabled", "sort_order", "created_at", "updated_at") VALUES
  (gen_random_uuid(), 'yandex',       'Yandex',      'Личный аккаунт Яндекс (диск, почта, календарь)', 'USER',      true, 10, now(), now()),
  (gen_random_uuid(), 'github',       'GitHub',      'Личный GitHub — репозитории, issues, PR',         'USER',      true, 20, now(), now()),
  (gen_random_uuid(), 'telegram',     'Telegram',    'Личный Telegram для уведомлений',                 'USER',      true, 30, now(), now()),
  (gen_random_uuid(), 'amocrm',       'AmoCRM',      'CRM для workspace — сделки, контакты',            'WORKSPACE', true, 40, now(), now()),
  (gen_random_uuid(), 'mango_office', 'MangoOffice', 'Облачная телефония MangoOffice',                  'WORKSPACE', true, 50, now(), now());

-- ---- seed: plans ----
INSERT INTO "plans" ("id", "slug", "name", "description", "price_monthly", "currency", "max_workspaces", "max_members_per_workspace", "features", "is_active", "sort_order", "created_at", "updated_at") VALUES
  (gen_random_uuid(), 'free',      'Free',      'Одно пространство, базовые возможности',   0,      'RUB', 1,    1,    '["Одно пространство", "Базовый редактор"]'::jsonb,                       true, 10, now(), now()),
  (gen_random_uuid(), 'personal',  'Personal',  'Для личных проектов и фриланса',            39000,  'RUB', 5,    1,    '["5 пространств", "История версий", "AI поиск"]'::jsonb,                 true, 20, now(), now()),
  (gen_random_uuid(), 'corporate', 'Corporate', 'Для команд и компаний',                     149000, 'RUB', NULL, NULL, '["∞ пространств", "Команды", "SSO", "Приоритетная поддержка"]'::jsonb,   true, 30, now(), now());

-- ---- backfill: every existing user gets a FREE subscription and an empty preference row ----
INSERT INTO "subscriptions" ("id", "user_id", "plan_id", "status", "started_at", "created_at", "updated_at")
SELECT gen_random_uuid(), u."id", p."id", 'ACTIVE', now(), now(), now()
FROM "users" u
CROSS JOIN LATERAL (SELECT "id" FROM "plans" WHERE "slug" = 'free' LIMIT 1) p;

INSERT INTO "user_preferences" ("id", "user_id", "created_at", "updated_at")
SELECT gen_random_uuid(), u."id", now(), now()
FROM "users" u;
```

- [ ] **Step 7.4 — Apply the migration**

```bash
cd packages/db
pnpm exec prisma migrate dev
cd -
```

Expected: migration applies, `@prisma/client` regenerates, no errors.

- [ ] **Step 7.5 — Smoke-verify constraints and seeds**

```bash
docker compose exec -T postgres psql -U user -d anynote -c "SELECT slug, name, scope FROM integration_providers ORDER BY sort_order;"
docker compose exec -T postgres psql -U user -d anynote -c "SELECT slug, price_monthly, max_workspaces FROM plans ORDER BY sort_order;"
docker compose exec -T postgres psql -U user -d anynote -c "\d+ integrations" | grep -E '(check|unique)'
```

Expected:

- 5 providers (yandex, github, telegram, amocrm, mango_office)
- 3 plans (free/0, personal/39000, corporate/149000)
- CHECK constraint `integrations_scope_target_check` and two partial UNIQUE indexes listed

- [ ] **Step 7.6 — Commit**

```bash
git add packages/db/prisma/migrations/
git commit -m "feat(db): migration for workspaces, integrations, plans, subscriptions"
```

---

### Task 8: Idempotent seed script for fresh environments

**Files:**

- Create: `packages/db/prisma/seed.ts`
- Modify: `packages/db/package.json`

- [ ] **Step 8.1 — Add `tsx` devDependency if not already present**

Check `packages/db/package.json` for `tsx` in `devDependencies`. If missing:

```bash
pnpm --filter @repo/db add -D tsx
```

- [ ] **Step 8.2 — Add `prisma.seed` config to `packages/db/package.json`**

Add to `packages/db/package.json` (merge with existing fields, do not overwrite):

```json
{
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  },
  "scripts": {
    "prisma:seed": "tsx prisma/seed.ts"
  }
}
```

(The `scripts` field already exists; only add the `prisma:seed` line.)

- [ ] **Step 8.3 — Write `packages/db/prisma/seed.ts`**

```ts
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

const providers = [
  {
    slug: "yandex",
    name: "Yandex",
    scope: "USER" as const,
    sortOrder: 10,
    description: "Личный аккаунт Яндекс (диск, почта, календарь)",
  },
  {
    slug: "github",
    name: "GitHub",
    scope: "USER" as const,
    sortOrder: 20,
    description: "Личный GitHub — репозитории, issues, PR",
  },
  {
    slug: "telegram",
    name: "Telegram",
    scope: "USER" as const,
    sortOrder: 30,
    description: "Личный Telegram для уведомлений",
  },
  {
    slug: "amocrm",
    name: "AmoCRM",
    scope: "WORKSPACE" as const,
    sortOrder: 40,
    description: "CRM для workspace — сделки, контакты",
  },
  {
    slug: "mango_office",
    name: "MangoOffice",
    scope: "WORKSPACE" as const,
    sortOrder: 50,
    description: "Облачная телефония MangoOffice",
  },
]

const plans = [
  {
    slug: "free",
    name: "Free",
    priceMonthly: 0,
    maxWorkspaces: 1,
    maxMembersPerWorkspace: 1,
    sortOrder: 10,
    description: "Одно пространство, базовые возможности",
    features: ["Одно пространство", "Базовый редактор"],
  },
  {
    slug: "personal",
    name: "Personal",
    priceMonthly: 39000,
    maxWorkspaces: 5,
    maxMembersPerWorkspace: 1,
    sortOrder: 20,
    description: "Для личных проектов и фриланса",
    features: ["5 пространств", "История версий", "AI поиск"],
  },
  {
    slug: "corporate",
    name: "Corporate",
    priceMonthly: 149000,
    maxWorkspaces: null,
    maxMembersPerWorkspace: null,
    sortOrder: 30,
    description: "Для команд и компаний",
    features: ["∞ пространств", "Команды", "SSO", "Приоритетная поддержка"],
  },
]

async function main() {
  for (const p of providers) {
    await prisma.integrationProvider.upsert({
      where: { slug: p.slug },
      create: p,
      update: { name: p.name, description: p.description, scope: p.scope, sortOrder: p.sortOrder },
    })
  }
  for (const p of plans) {
    await prisma.plan.upsert({
      where: { slug: p.slug },
      create: p,
      update: {
        name: p.name,
        description: p.description,
        priceMonthly: p.priceMonthly,
        maxWorkspaces: p.maxWorkspaces,
        maxMembersPerWorkspace: p.maxMembersPerWorkspace,
        sortOrder: p.sortOrder,
        features: p.features,
      },
    })
  }
  console.info("Seed complete: 5 providers, 3 plans")
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
```

- [ ] **Step 8.4 — Run the seed and verify idempotency**

```bash
pnpm --filter @repo/db prisma:seed
pnpm --filter @repo/db prisma:seed  # twice — must not duplicate
docker compose exec -T postgres psql -U user -d anynote -c "SELECT count(*) FROM integration_providers;"
docker compose exec -T postgres psql -U user -d anynote -c "SELECT count(*) FROM plans;"
```

Expected: first run logs "Seed complete", second run also succeeds, counts are still 5 and 3.

- [ ] **Step 8.5 — Commit**

```bash
git add packages/db/prisma/seed.ts packages/db/package.json
git commit -m "feat(db): add idempotent seed script for providers and plans"
```

---

### Task 9: Add `databaseHooks.user.create.after` to better-auth

**Files:**

- Modify: `packages/auth/src/auth.ts`

- [ ] **Step 9.1 — Verify the hook signature in installed better-auth**

```bash
grep -rE "(databaseHooks|hooks.user|create.*after)" node_modules/better-auth/dist/types/ 2>/dev/null | head -20
```

Look for the exact signature. If uncertain, open `node_modules/better-auth/dist/types/index.d.ts` and search for `databaseHooks`.

- [ ] **Step 9.2 — Add the hook to `betterAuth(...)` config**

In `packages/auth/src/auth.ts`, extend the `betterAuth({ ... })` call. Add `databaseHooks` alongside existing top-level keys (after `session` / `experimental`, before closing `})`):

```ts
databaseHooks: {
  user: {
    create: {
      after: async (user) => {
        const freePlan = await prisma.plan.findUniqueOrThrow({ where: { slug: "free" } })
        await prisma.subscription.create({
          data: { userId: user.id, planId: freePlan.id, status: "ACTIVE" },
        })
        await prisma.userPreference.upsert({
          where: { userId: user.id },
          create: { userId: user.id },
          update: {},
        })
      },
    },
  },
},
```

- [ ] **Step 9.3 — Verify types compile**

```bash
pnpm --filter @repo/auth check-types
```

Expected: exits 0. If the hook signature doesn't match what better-auth 1.4.9 expects (e.g., it passes `(data, context)` instead of `(user)`), adjust parameters to match the actual typedef you inspected in Step 9.1.

- [ ] **Step 9.4 — Commit**

```bash
git add packages/auth/src/auth.ts
git commit -m "feat(auth): create FREE subscription and preferences on user signup"
```

---

### Task 10: Refactor tRPC base into `trpc.ts` with `protectedProcedure`

**Files:**

- Create: `packages/trpc/src/trpc.ts`
- Modify: `packages/trpc/src/index.ts` (partially — full refactor in Task 14)

- [ ] **Step 10.1 — Create `packages/trpc/src/trpc.ts`**

```ts
import { initTRPC, TRPCError } from "@trpc/server"

import { prisma } from "@repo/db"
import { getUserFromRequest } from "@repo/auth"

type CreateContextOptions = {
  req: Request
  resHeaders: Headers
}

export const createContext = async ({ req, resHeaders }: CreateContextOptions) => {
  const user = await getUserFromRequest(req, resHeaders)
  return {
    prisma,
    user,
    headers: req.headers,
    resHeaders,
  }
}

export const createServerContext = async (headers: Headers) => {
  return createContext({
    req: new Request("http://rsc.internal", { headers }),
    resHeaders: new Headers(),
  })
}

export type Context = Awaited<ReturnType<typeof createContext>>

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure
export const createCallerFactory = t.createCallerFactory

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Session required" })
  }
  return next({ ctx: { ...ctx, user: ctx.user } })
})
```

- [ ] **Step 10.2 — Point `index.ts` at the new base (temporary transitional state)**

Replace the top of `packages/trpc/src/index.ts` with:

```ts
import { router, publicProcedure, createCallerFactory } from "./trpc"
export { createContext, createServerContext } from "./trpc"
export type { Context } from "./trpc"
```

Leave the existing `appRouter = t.router({ ... })` definition below for now — it will be replaced in Task 14. Just swap local `t.router` / `t.procedure` references to `router` / `publicProcedure` so the file still compiles.

- [ ] **Step 10.3 — Verify types**

```bash
pnpm --filter @repo/trpc check-types
pnpm --filter web check-types
```

Expected: both exit 0.

- [ ] **Step 10.4 — Commit**

```bash
git add packages/trpc/
git commit -m "refactor(trpc): extract base into trpc.ts with protectedProcedure"
```

---

### Task 11: Add `getActivePlanForUser` helper

**Files:**

- Create: `packages/trpc/src/helpers/plan.ts`

- [ ] **Step 11.1 — Write the helper**

```ts
import type { PrismaClient } from "@prisma/client"

export async function getActivePlanForUser(prisma: PrismaClient, userId: string) {
  const subscription = await prisma.subscription.findFirst({
    where: { userId, status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } },
    include: { plan: true },
    orderBy: { startedAt: "desc" },
  })
  if (!subscription) {
    throw new Error(`User ${userId} has no active subscription`)
  }
  return { subscription, plan: subscription.plan }
}
```

- [ ] **Step 11.2 — Verify types**

```bash
pnpm --filter @repo/trpc check-types
```

Expected: exits 0.

- [ ] **Step 11.3 — Commit**

```bash
git add packages/trpc/src/helpers/plan.ts
git commit -m "feat(trpc): add getActivePlanForUser helper"
```

---

### Task 12: Write `userRouter`

**Files:**

- Create: `packages/trpc/src/routers/user.ts`

- [ ] **Step 12.1 — Write the router**

```ts
import { z } from "zod"
import { TRPCError } from "@trpc/server"

import { router, protectedProcedure } from "../trpc"

const ThemeSchema = z.enum(["light", "dark", "system"])

const NotificationSettingsSchema = z.object({
  email: z.object({
    mentions: z.boolean(),
    comments: z.boolean(),
    weeklyDigest: z.boolean(),
  }),
})

export const userRouter = router({
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.userPreference.findUnique({
      where: { userId: ctx.user.id },
    })
  }),

  setTheme: protectedProcedure
    .input(z.object({ theme: ThemeSchema }))
    .mutation(async ({ ctx, input }) => {
      // Persist to DB — the client is responsible for also setting the `theme`
      // cookie via `document.cookie` so the next SSR render picks it up
      // immediately. We don't set Set-Cookie here because the current tRPC
      // fetchRequestHandler doesn't forward ctx.resHeaders to the Response.
      return ctx.prisma.userPreference.upsert({
        where: { userId: ctx.user.id },
        create: { userId: ctx.user.id, theme: input.theme },
        update: { theme: input.theme },
      })
    }),

  setNotificationSettings: protectedProcedure
    .input(NotificationSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.userPreference.upsert({
        where: { userId: ctx.user.id },
        create: { userId: ctx.user.id, notificationSettings: input },
        update: { notificationSettings: input },
      })
    }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        firstName: z.string().min(1).max(255),
        lastName: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.user.update({
        where: { id: ctx.user.id },
        data: { firstName: input.firstName, lastName: input.lastName },
      })
    }),

  listSessions: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.session.findMany({
      where: { userId: ctx.user.id, expiresAt: { gt: new Date() } },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        token: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        updatedAt: true,
        expiresAt: true,
      },
    })
  }),

  revokeSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.prisma.session.findUnique({
        where: { id: input.sessionId },
      })
      if (!session || session.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" })
      }
      await ctx.prisma.session.delete({ where: { id: input.sessionId } })
      return { ok: true }
    }),
})
```

- [ ] **Step 12.2 — Verify types**

```bash
pnpm --filter @repo/trpc check-types
```

Expected: exits 0.

- [ ] **Step 12.3 — Commit**

```bash
git add packages/trpc/src/routers/user.ts
git commit -m "feat(trpc): add userRouter (preferences, sessions, profile)"
```

---

### Task 13: Write `workspaceRouter`, `subscriptionRouter`, `integrationRouter`

**Files:**

- Create: `packages/trpc/src/routers/workspace.ts`
- Create: `packages/trpc/src/routers/subscription.ts`
- Create: `packages/trpc/src/routers/integration.ts`

- [ ] **Step 13.1 — `workspace.ts`**

```ts
import { z } from "zod"
import { TRPCError } from "@trpc/server"

import { router, protectedProcedure } from "../trpc"
import { getActivePlanForUser } from "../helpers/plan"

export const workspaceRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(64),
        icon: z.string().max(64).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { plan } = await getActivePlanForUser(ctx.prisma, ctx.user.id)
      if (plan.maxWorkspaces !== null) {
        const owned = await ctx.prisma.workspaceMember.count({
          where: { userId: ctx.user.id, role: "OWNER" },
        })
        if (owned >= plan.maxWorkspaces) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `На тарифе ${plan.name} можно создать не больше ${plan.maxWorkspaces} пространств`,
          })
        }
      }

      return ctx.prisma.$transaction(async (tx) => {
        const workspace = await tx.workspace.create({
          data: { name: input.name, icon: input.icon, createdById: ctx.user.id },
        })
        await tx.workspaceMember.create({
          data: { workspaceId: workspace.id, userId: ctx.user.id, role: "OWNER" },
        })
        await tx.userPreference.upsert({
          where: { userId: ctx.user.id },
          create: { userId: ctx.user.id, defaultWorkspaceId: workspace.id },
          update: { defaultWorkspaceId: workspace.id },
        })
        return workspace
      })
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.workspace.findFirst({
        where: {
          id: input.id,
          members: { some: { userId: ctx.user.id } },
        },
      })
    }),

  listMine: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.workspace.findMany({
      where: { members: { some: { userId: ctx.user.id } } },
      orderBy: { createdAt: "asc" },
    })
  }),

  getDefault: protectedProcedure.query(async ({ ctx }) => {
    const pref = await ctx.prisma.userPreference.findUnique({
      where: { userId: ctx.user.id },
      include: { defaultWorkspace: true },
    })
    return pref?.defaultWorkspace ?? null
  }),
})
```

- [ ] **Step 13.2 — `subscription.ts`**

```ts
import { router, protectedProcedure } from "../trpc"
import { getActivePlanForUser } from "../helpers/plan"

export const subscriptionRouter = router({
  getCurrent: protectedProcedure.query(async ({ ctx }) => {
    return getActivePlanForUser(ctx.prisma, ctx.user.id)
  }),

  listHistory: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.subscription.findMany({
      where: { userId: ctx.user.id },
      include: { plan: true },
      orderBy: { startedAt: "desc" },
    })
  }),
})
```

- [ ] **Step 13.3 — `integration.ts`**

```ts
import { z } from "zod"
import { TRPCError } from "@trpc/server"

import { router, protectedProcedure } from "../trpc"

const ScopeSchema = z.enum(["USER", "WORKSPACE"])

export const integrationRouter = router({
  listProviders: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.integrationProvider.findMany({
      where: { isEnabled: true },
      orderBy: { sortOrder: "asc" },
    })
  }),

  listMine: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.integration.findMany({
        where: {
          OR: [
            { scope: "USER", userId: ctx.user.id },
            ...(input.workspaceId
              ? [{ scope: "WORKSPACE" as const, workspaceId: input.workspaceId }]
              : []),
          ],
          status: { in: ["PENDING", "CONNECTED", "ERROR"] },
        },
        include: { provider: true },
      })
    }),

  connect: protectedProcedure
    .input(
      z.object({
        providerId: z.string().uuid(),
        scope: ScopeSchema,
        workspaceId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.scope === "WORKSPACE" && !input.workspaceId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "workspaceId required for WORKSPACE scope",
        })
      }
      if (input.scope === "WORKSPACE") {
        const member = await ctx.prisma.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: input.workspaceId!, userId: ctx.user.id } },
        })
        if (!member) throw new TRPCError({ code: "FORBIDDEN" })
      }
      return ctx.prisma.integration.create({
        data: {
          providerId: input.providerId,
          scope: input.scope,
          userId: input.scope === "USER" ? ctx.user.id : null,
          workspaceId: input.scope === "WORKSPACE" ? input.workspaceId : null,
          status: "PENDING",
        },
      })
    }),

  disconnect: protectedProcedure
    .input(z.object({ integrationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const integration = await ctx.prisma.integration.findUnique({
        where: { id: input.integrationId },
      })
      if (!integration) throw new TRPCError({ code: "NOT_FOUND" })
      // Authorization: user must own it or be a member of the workspace.
      if (integration.scope === "USER" && integration.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" })
      }
      if (integration.scope === "WORKSPACE") {
        const member = await ctx.prisma.workspaceMember.findUnique({
          where: {
            workspaceId_userId: { workspaceId: integration.workspaceId!, userId: ctx.user.id },
          },
        })
        if (!member) throw new TRPCError({ code: "FORBIDDEN" })
      }
      return ctx.prisma.integration.update({
        where: { id: input.integrationId },
        data: { status: "DISCONNECTED" },
      })
    }),
})
```

- [ ] **Step 13.4 — Verify types**

```bash
pnpm --filter @repo/trpc check-types
```

Expected: exits 0.

- [ ] **Step 13.5 — Commit**

```bash
git add packages/trpc/src/routers/
git commit -m "feat(trpc): add workspace, subscription, integration routers"
```

---

### Task 14: Assemble the namespaced `appRouter`

**Files:**

- Modify: `packages/trpc/src/index.ts`

- [ ] **Step 14.1 — Rewrite `index.ts` end-to-end**

Replace the entire contents of `packages/trpc/src/index.ts` with:

```ts
import { router, publicProcedure, createCallerFactory } from "./trpc"
import { userRouter } from "./routers/user"
import { workspaceRouter } from "./routers/workspace"
import { subscriptionRouter } from "./routers/subscription"
import { integrationRouter } from "./routers/integration"

export { createContext, createServerContext } from "./trpc"
export type { Context } from "./trpc"

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true })),
  user: userRouter,
  workspace: workspaceRouter,
  subscription: subscriptionRouter,
  integration: integrationRouter,
})

export const createCaller = createCallerFactory(appRouter)
export type AppRouter = typeof appRouter
```

- [ ] **Step 14.2 — Verify types across the monorepo**

```bash
pnpm --filter @repo/trpc check-types
pnpm --filter web check-types
```

Expected: both exit 0. The web app's `trpc.ts` imports `AppRouter` — renaming procedures (e.g., old flat `users.query` → new `user.listSessions`) may break any existing call sites. Fix them as they surface.

- [ ] **Step 14.3 — Commit**

```bash
git add packages/trpc/src/index.ts
git commit -m "refactor(trpc): assemble appRouter from namespaced routers"
```

---

### Task 15: Create the `(protected)` route group layout

**Files:**

- Create: `apps/web/src/app/(protected)/layout.tsx`

- [ ] **Step 15.1 — Write the layout**

```tsx
import type { ReactNode } from "react"

import { requireSession } from "@/lib/get-session"
import { TRPCReactProvider } from "@/trpc/client"

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  await requireSession()
  return <TRPCReactProvider>{children}</TRPCReactProvider>
}
```

- [ ] **Step 15.2 — Verify**

```bash
pnpm --filter web check-types
```

Expected: exits 0.

- [ ] **Step 15.3 — Commit**

```bash
git add apps/web/src/app/\(protected\)/layout.tsx
git commit -m "feat(web): add (protected) route group with auth gate and tRPC provider"
```

---

### Task 16: Move `/app` into `(protected)` as a redirect

**Files:**

- Create: `apps/web/src/app/(protected)/app/page.tsx`
- Delete: `apps/web/src/app/app/layout.tsx`, `apps/web/src/app/app/page.tsx`

- [ ] **Step 16.1 — Write the new `/app` page (pure redirect)**

```tsx
import { redirect } from "next/navigation"

import { getServerTRPC } from "@/trpc/server"

export default async function AppIndexPage() {
  const defaultWorkspace = await (await getServerTRPC()).workspace.getDefault()
  if (!defaultWorkspace) redirect("/workspaces/new")
  redirect(`/workspaces/${defaultWorkspace.id}`)
}
```

- [ ] **Step 16.2 — Delete the old `/app` directory**

```bash
rm apps/web/src/app/app/layout.tsx apps/web/src/app/app/page.tsx
rmdir apps/web/src/app/app
```

- [ ] **Step 16.3 — Verify build**

```bash
pnpm --filter web check-types
pnpm --filter web lint
```

Expected: both exit 0. If any unrelated code imports from `@/app/app/*`, fix it.

- [ ] **Step 16.4 — Commit**

```bash
git add apps/web/src/app/\(protected\)/app/ apps/web/src/app/app/
git commit -m "refactor(web): move /app into (protected) as redirect to workspace"
```

---

### Task 17: Settings shell — layout + nav

**Files:**

- Create: `apps/web/src/app/(protected)/settings/layout.tsx`
- Create: `apps/web/src/components/settings/settings-nav.tsx`

- [ ] **Step 17.1 — `settings-nav.tsx` (client)**

```tsx
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { Box, Stack, Typography } from "@repo/ui/components"

const items = [
  { href: "/settings/general", label: "Общее", icon: "⚙" },
  { href: "/settings/account", label: "Аккаунт", icon: "◉" },
  { href: "/settings/billing", label: "Оплата", icon: "💳" },
  { href: "/settings/integrations", label: "Интеграции", icon: "⇌" },
]

export function SettingsNav() {
  const pathname = usePathname()
  return (
    <Stack spacing={0.25} component="nav" aria-label="Настройки">
      {items.map((item) => {
        const active = pathname?.startsWith(item.href) ?? false
        return (
          <Box
            key={item.href}
            component={Link}
            href={item.href}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.25,
              px: 1.25,
              py: 1,
              borderRadius: 1,
              textDecoration: "none",
              color: active ? "text.primary" : "text.secondary",
              fontWeight: active ? 600 : 400,
              backgroundColor: active ? "action.selected" : "transparent",
              "&:hover": { backgroundColor: "action.hover" },
            }}
          >
            <Typography component="span" sx={{ fontSize: 16 }}>
              {item.icon}
            </Typography>
            <Typography variant="body2">{item.label}</Typography>
          </Box>
        )
      })}
    </Stack>
  )
}
```

- [ ] **Step 17.2 — `settings/layout.tsx`**

```tsx
import type { ReactNode } from "react"
import Link from "next/link"

import { Box, Container, Paper, Stack, Typography } from "@repo/ui/components"

import { SettingsNav } from "@/components/settings/settings-nav"
import { getSession } from "@/lib/get-session"

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  const user = session!.user

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "260px minmax(0, 1fr)" },
          gap: { xs: 3, md: 4 },
        }}
      >
        <Paper
          elevation={0}
          sx={{
            p: 2,
            borderRadius: 2,
            border: "1px solid",
            borderColor: "divider",
            alignSelf: "start",
            position: { md: "sticky" },
            top: { md: 24 },
          }}
        >
          <Stack spacing={2}>
            <Box
              component={Link}
              href="/app"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                color: "text.secondary",
                fontSize: 13,
                textDecoration: "none",
              }}
            >
              <span>←</span>
              <span>Вернуться в workspace</span>
            </Box>
            <Stack
              direction="row"
              spacing={1.25}
              alignItems="center"
              sx={{ pb: 2, borderBottom: "1px solid", borderColor: "divider" }}
            >
              <Box
                sx={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg,#0f766e,#155e75)",
                }}
              />
              <Stack spacing={0}>
                <Typography variant="body2" fontWeight={600}>
                  {user.firstName} {user.lastName}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {user.email}
                </Typography>
              </Stack>
            </Stack>
            <Stack spacing={0.5}>
              <Typography variant="overline" color="text.secondary">
                Настройки
              </Typography>
              <SettingsNav />
            </Stack>
          </Stack>
        </Paper>
        <Box>{children}</Box>
      </Box>
    </Container>
  )
}
```

- [ ] **Step 17.3 — Verify**

```bash
pnpm --filter web check-types
```

Expected: exits 0. (The `@repo/ui/components` re-exports should include `Box`, `Container`, `Paper`, `Stack`, `Typography`. If one is missing, add it there.)

- [ ] **Step 17.4 — Commit**

```bash
git add apps/web/src/app/\(protected\)/settings/layout.tsx apps/web/src/components/settings/settings-nav.tsx
git commit -m "feat(web): add settings layout with 2-pane shell and left nav"
```

---

### Task 18: `/settings/general` — profile, theme, notifications

**Files:**

- Create: `apps/web/src/app/(protected)/settings/general/page.tsx`
- Create: `apps/web/src/components/settings/profile-section.tsx`
- Create: `apps/web/src/components/settings/theme-section.tsx`
- Create: `apps/web/src/components/settings/notifications-section.tsx`

- [ ] **Step 18.1 — `profile-section.tsx` (client)**

```tsx
"use client"

import { useState } from "react"

import { Box, Button, Stack, TextField, Typography } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type Props = {
  initial: {
    firstName: string
    lastName: string
    email: string
    emailVerified: boolean
    image: string | null
  }
}

export function ProfileSection({ initial }: Props) {
  const [firstName, setFirstName] = useState(initial.firstName)
  const [lastName, setLastName] = useState(initial.lastName)
  const updateProfile = trpc.user.updateProfile.useMutation()

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        p: { xs: 2.5, md: 3 },
        backgroundColor: "background.paper",
      }}
    >
      <Typography variant="subtitle1" fontWeight={700}>
        Профиль
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Имя, email и аватар, которые видят другие
      </Typography>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
        <Box
          sx={{
            width: 60,
            height: 60,
            borderRadius: "50%",
            background: "linear-gradient(135deg,#0f766e,#155e75)",
          }}
        />
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" size="small" disabled>
            Загрузить
          </Button>
          <Button variant="text" size="small" color="inherit" disabled>
            Удалить
          </Button>
        </Stack>
      </Stack>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, mb: 2 }}>
        <TextField
          label="Имя"
          size="small"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
        />
        <TextField
          label="Фамилия"
          size="small"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
        />
      </Box>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="caption" color="text.secondary">
          Email
        </Typography>
        <Box
          sx={{
            px: 1,
            py: 0.25,
            borderRadius: 10,
            fontSize: 10,
            fontWeight: 600,
            color: initial.emailVerified ? "success.dark" : "warning.dark",
            backgroundColor: initial.emailVerified ? "success.light" : "warning.light",
          }}
        >
          {initial.emailVerified ? "Подтверждён" : "Не подтверждён"}
        </Box>
      </Stack>
      <Stack direction="row" spacing={1}>
        <TextField
          size="small"
          value={initial.email}
          sx={{ flex: 1 }}
          InputProps={{ readOnly: true }}
        />
        <Button variant="outlined" size="small" disabled>
          Изменить
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        Смена email потребует повторного подтверждения по ссылке
      </Typography>
      <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 3 }}>
        <Button
          variant="contained"
          size="small"
          disabled={updateProfile.isPending}
          onClick={() => updateProfile.mutate({ firstName, lastName })}
        >
          Сохранить
        </Button>
      </Box>
    </Box>
  )
}
```

- [ ] **Step 18.2 — `theme-section.tsx` (client)**

```tsx
"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Box, Stack, Typography } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type Theme = "light" | "dark" | "system"

const options: Array<{ value: Theme; label: string; preview: React.CSSProperties }> = [
  {
    value: "light",
    label: "Светлая",
    preview: { background: "#fff", border: "1px solid #e5e7eb" },
  },
  {
    value: "dark",
    label: "Тёмная",
    preview: { background: "#0c0d10", border: "1px solid #1e2024" },
  },
  {
    value: "system",
    label: "Системная",
    preview: {
      background: "linear-gradient(90deg,#fff 50%,#0c0d10 50%)",
      border: "1px solid #d1d5db",
    },
  },
]

export function ThemeSection({ initial }: { initial: Theme | null }) {
  const [selected, setSelected] = useState<Theme>(initial ?? "system")
  const setTheme = trpc.user.setTheme.useMutation()
  const router = useRouter()

  const choose = async (theme: Theme) => {
    setSelected(theme)
    // Set the cookie immediately so the next SSR render uses it. tRPC handler
    // route doesn't propagate Set-Cookie from ctx.resHeaders, so we do this
    // client-side.
    document.cookie = `theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`
    await setTheme.mutateAsync({ theme })
    router.refresh()
  }

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        p: { xs: 2.5, md: 3 },
        backgroundColor: "background.paper",
      }}
    >
      <Typography variant="subtitle1" fontWeight={700}>
        Тема оформления
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Выберите светлую, тёмную или автоматическую тему
      </Typography>
      <Stack direction="row" spacing={1.5}>
        {options.map((opt) => {
          const active = selected === opt.value
          return (
            <Box
              key={opt.value}
              onClick={() => void choose(opt.value)}
              sx={{
                flex: 1,
                p: 1.5,
                borderRadius: 1.5,
                border: active ? "2px solid" : "1px solid",
                borderColor: active ? "primary.main" : "divider",
                cursor: "pointer",
                textAlign: "center",
              }}
            >
              <Box sx={{ height: 36, borderRadius: 1, mb: 1, ...opt.preview }} />
              <Typography variant="caption" fontWeight={active ? 700 : 400}>
                {opt.label}
              </Typography>
            </Box>
          )
        })}
      </Stack>
    </Box>
  )
}
```

- [ ] **Step 18.3 — `notifications-section.tsx` (client)**

```tsx
"use client"

import { useState } from "react"

import { Box, Stack, Switch, Typography } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type NotificationSettings = {
  email: { mentions: boolean; comments: boolean; weeklyDigest: boolean }
}

const defaultSettings: NotificationSettings = {
  email: { mentions: true, comments: true, weeklyDigest: false },
}

export function NotificationsSection({ initial }: { initial: NotificationSettings | null }) {
  const [value, setValue] = useState<NotificationSettings>(initial ?? defaultSettings)
  const mutate = trpc.user.setNotificationSettings.useMutation()

  const toggle =
    (key: keyof NotificationSettings["email"]) => async (_: unknown, checked: boolean) => {
      const next: NotificationSettings = {
        email: { ...value.email, [key]: checked },
      }
      setValue(next)
      await mutate.mutateAsync(next)
    }

  const rows = [
    {
      key: "mentions" as const,
      title: "Упоминания",
      desc: "Когда вас упоминают в странице или комментарии",
    },
    {
      key: "comments" as const,
      title: "Комментарии",
      desc: "Новые комментарии в документах, где вы участник",
    },
    {
      key: "weeklyDigest" as const,
      title: "Еженедельный дайджест",
      desc: "Сводка активности раз в неделю",
    },
  ]

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        p: { xs: 2.5, md: 3 },
        backgroundColor: "background.paper",
      }}
    >
      <Typography variant="subtitle1" fontWeight={700}>
        Уведомления
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Когда присылать email, push и in-app
      </Typography>
      <Stack spacing={1.5}>
        {rows.map((row, i) => (
          <Stack
            key={row.key}
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{
              py: 1,
              borderBottom: i < rows.length - 1 ? "1px solid" : "none",
              borderColor: "divider",
            }}
          >
            <Stack spacing={0.25}>
              <Typography variant="body2" fontWeight={600}>
                {row.title}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {row.desc}
              </Typography>
            </Stack>
            <Switch checked={value.email[row.key]} onChange={toggle(row.key)} />
          </Stack>
        ))}
      </Stack>
    </Box>
  )
}
```

- [ ] **Step 18.4 — `settings/general/page.tsx`**

```tsx
import { Stack, Typography } from "@repo/ui/components"

import { NotificationsSection } from "@/components/settings/notifications-section"
import { ProfileSection } from "@/components/settings/profile-section"
import { ThemeSection } from "@/components/settings/theme-section"
import { getSession } from "@/lib/get-session"
import { getServerTRPC } from "@/trpc/server"

export const metadata = { title: "Общее · Настройки" }

export default async function GeneralSettingsPage() {
  const session = await getSession()
  const user = session!.user
  const prefs = await (await getServerTRPC()).user.getPreferences()

  type NotificationSettings = {
    email: { mentions: boolean; comments: boolean; weeklyDigest: boolean }
  }

  return (
    <Stack spacing={2}>
      <Stack spacing={0.5} sx={{ mb: 1 }}>
        <Typography variant="h5" fontWeight={700}>
          Общее
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Настройки профиля, темы и уведомлений
        </Typography>
      </Stack>
      <ProfileSection
        initial={{
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          emailVerified: user.emailVerified,
          image: user.image ?? null,
        }}
      />
      <ThemeSection initial={(prefs?.theme as "light" | "dark" | "system" | null) ?? null} />
      <NotificationsSection
        initial={(prefs?.notificationSettings as NotificationSettings | null) ?? null}
      />
    </Stack>
  )
}
```

- [ ] **Step 18.5 — Verify**

```bash
pnpm --filter web check-types
```

Expected: exits 0. If `Switch` / `TextField` aren't in `@repo/ui/components` exports, add them.

- [ ] **Step 18.6 — Commit**

```bash
git add apps/web/src/app/\(protected\)/settings/general/ apps/web/src/components/settings/profile-section.tsx apps/web/src/components/settings/theme-section.tsx apps/web/src/components/settings/notifications-section.tsx
git commit -m "feat(web): /settings/general page with profile, theme, notifications"
```

---

### Task 19: `/settings/account` — sign out and sessions table

**Files:**

- Create: `apps/web/src/app/(protected)/settings/account/page.tsx`
- Create: `apps/web/src/components/settings/sign-out-button.tsx`
- Create: `apps/web/src/components/settings/sessions-table.tsx`
- Create: `apps/web/src/lib/parse-user-agent.ts`

- [ ] **Step 19.1 — `parse-user-agent.ts`**

```ts
export function parseUserAgent(ua: string | null | undefined): { browser: string; os: string } {
  if (!ua) return { browser: "Unknown", os: "Unknown" }
  const browser = /Edg/.test(ua)
    ? "Edge"
    : /Chrome/.test(ua)
      ? "Chrome"
      : /Firefox/.test(ua)
        ? "Firefox"
        : /Safari/.test(ua)
          ? "Safari"
          : "Unknown"
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac OS X|Macintosh/.test(ua)
      ? "macOS"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Android/.test(ua)
          ? "Android"
          : /Linux/.test(ua)
            ? "Linux"
            : "Unknown"
  return { browser, os }
}
```

- [ ] **Step 19.2 — `sign-out-button.tsx`**

```tsx
"use client"

import { useRouter } from "next/navigation"

import { Button } from "@repo/ui/components"

import { authClient } from "@/lib/auth-client"

export function SignOutButton() {
  const router = useRouter()
  return (
    <Button
      variant="contained"
      color="error"
      onClick={async () => {
        await authClient.signOut()
        router.push("/sign-in")
      }}
    >
      Выйти из системы
    </Button>
  )
}
```

- [ ] **Step 19.3 — `sessions-table.tsx`**

```tsx
"use client"

import { useRouter } from "next/navigation"

import {
  Box,
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@repo/ui/components"

import { parseUserAgent } from "@/lib/parse-user-agent"
import { trpc } from "@/trpc/client"

type Props = {
  currentSessionId: string
}

function formatRelative(date: Date): string {
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "только что"
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  const days = Math.floor(hours / 24)
  return `${days} дн назад`
}

export function SessionsTable({ currentSessionId }: Props) {
  const router = useRouter()
  const sessionsQuery = trpc.user.listSessions.useQuery()
  const revoke = trpc.user.revokeSession.useMutation({
    onSuccess: () => {
      sessionsQuery.refetch()
      router.refresh()
    },
  })

  if (sessionsQuery.isLoading) return <Typography color="text.secondary">Загрузка...</Typography>
  if (!sessionsQuery.data?.length)
    return <Typography color="text.secondary">Нет активных сессий</Typography>

  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, overflow: "hidden" }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Устройство</TableCell>
            <TableCell>IP</TableCell>
            <TableCell>Последняя активность</TableCell>
            <TableCell align="right">Действие</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sessionsQuery.data.map((session) => {
            const { browser, os } = parseUserAgent(session.userAgent)
            const isCurrent = session.id === currentSessionId
            return (
              <TableRow key={session.id}>
                <TableCell>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <span>
                      {browser} на {os}
                    </span>
                    {isCurrent && <Chip size="small" label="Эта сессия" color="primary" />}
                  </Stack>
                </TableCell>
                <TableCell>{session.ipAddress ?? "—"}</TableCell>
                <TableCell>{formatRelative(new Date(session.updatedAt))}</TableCell>
                <TableCell align="right">
                  {isCurrent ? null : (
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate({ sessionId: session.id })}
                    >
                      Завершить
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Box>
  )
}
```

- [ ] **Step 19.4 — `settings/account/page.tsx`**

```tsx
import { Stack, Typography } from "@repo/ui/components"

import { SessionsTable } from "@/components/settings/sessions-table"
import { SignOutButton } from "@/components/settings/sign-out-button"
import { getSession } from "@/lib/get-session"

export const metadata = { title: "Аккаунт · Настройки" }

export default async function AccountSettingsPage() {
  const session = await getSession()
  const currentSessionId = session!.session.id

  return (
    <Stack spacing={3}>
      <Stack spacing={0.5}>
        <Typography variant="h5" fontWeight={700}>
          Аккаунт
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Выход из системы и активные сессии
        </Typography>
      </Stack>
      <SignOutButton />
      <Stack spacing={1}>
        <Typography variant="subtitle1" fontWeight={700}>
          Активные сессии
        </Typography>
        <SessionsTable currentSessionId={currentSessionId} />
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 19.5 — Verify**

```bash
pnpm --filter web check-types
```

Expected: exits 0. Missing MUI exports from `@repo/ui/components` (Table\*, Chip) — add them if necessary.

- [ ] **Step 19.6 — Commit**

```bash
git add apps/web/src/app/\(protected\)/settings/account/ apps/web/src/components/settings/ apps/web/src/lib/parse-user-agent.ts
git commit -m "feat(web): /settings/account with sign out and sessions table"
```

---

### Task 20: `/settings/billing` — current plan and history

**Files:**

- Create: `apps/web/src/app/(protected)/settings/billing/page.tsx`
- Create: `apps/web/src/components/settings/current-plan-card.tsx`
- Create: `apps/web/src/components/settings/subscription-history-table.tsx`

- [ ] **Step 20.1 — `current-plan-card.tsx`**

```tsx
import { Box, Button, Chip, Stack, Typography } from "@repo/ui/components"

type Plan = {
  name: string
  slug: string
  priceMonthly: number
  currency: string
  maxWorkspaces: number | null
  features: unknown
}

type Subscription = {
  status: string
  startedAt: Date
  currentPeriodEnd: Date | null
}

function formatPrice(minor: number, currency: string): string {
  if (minor === 0) return "Бесплатно"
  const major = minor / 100
  return `${major.toLocaleString("ru-RU")} ${currency}/мес`
}

export function CurrentPlanCard({
  plan,
  subscription,
}: {
  plan: Plan
  subscription: Subscription
}) {
  const features = Array.isArray(plan.features) ? (plan.features as string[]) : []
  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        p: 3,
        backgroundColor: "background.paper",
      }}
    >
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="h5" fontWeight={700}>
              {plan.name}
            </Typography>
            <Chip
              size="small"
              label={subscription.status}
              color={subscription.status === "ACTIVE" ? "success" : "default"}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {formatPrice(plan.priceMonthly, plan.currency)}
            {plan.maxWorkspaces !== null &&
              ` · до ${plan.maxWorkspaces} ${plan.maxWorkspaces === 1 ? "пространства" : "пространств"}`}
          </Typography>
          {features.length > 0 && (
            <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5, color: "text.secondary" }}>
              {features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </Stack>
          )}
        </Stack>
        <Button variant="contained" disabled>
          Обновить тариф
        </Button>
      </Stack>
    </Box>
  )
}
```

- [ ] **Step 20.2 — `subscription-history-table.tsx`**

```tsx
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@repo/ui/components"

type Row = {
  id: string
  status: string
  startedAt: Date
  currentPeriodEnd: Date | null
  canceledAt: Date | null
  amountPaid: number | null
  currency: string | null
  paymentProvider: string | null
  plan: { name: string; slug: string }
}

function formatAmount(amount: number | null, currency: string | null): string {
  if (amount === null || amount === 0) return "—"
  const major = amount / 100
  return `${major.toLocaleString("ru-RU")} ${currency ?? ""}`
}

function formatPeriod(started: Date, end: Date | null, canceled: Date | null): string {
  const s = new Date(started).toLocaleDateString("ru-RU")
  const e = (canceled ?? end) ? new Date((canceled ?? end)!).toLocaleDateString("ru-RU") : "—"
  return `${s} → ${e}`
}

export function SubscriptionHistoryTable({ rows }: { rows: Row[] }) {
  if (!rows.length) return <Typography color="text.secondary">История пуста</Typography>
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, overflow: "hidden" }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Тариф</TableCell>
            <TableCell>Период</TableCell>
            <TableCell>Сумма</TableCell>
            <TableCell>Статус</TableCell>
            <TableCell>Оплачен через</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{r.plan.name}</TableCell>
              <TableCell>{formatPeriod(r.startedAt, r.currentPeriodEnd, r.canceledAt)}</TableCell>
              <TableCell>{formatAmount(r.amountPaid, r.currency)}</TableCell>
              <TableCell>{r.status}</TableCell>
              <TableCell>{r.paymentProvider ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  )
}
```

- [ ] **Step 20.3 — `settings/billing/page.tsx`**

```tsx
import { Stack, Typography } from "@repo/ui/components"

import { CurrentPlanCard } from "@/components/settings/current-plan-card"
import { SubscriptionHistoryTable } from "@/components/settings/subscription-history-table"
import { getServerTRPC } from "@/trpc/server"

export const metadata = { title: "Оплата · Настройки" }

export default async function BillingSettingsPage() {
  const trpc = await getServerTRPC()
  const [current, history] = await Promise.all([
    trpc.subscription.getCurrent(),
    trpc.subscription.listHistory(),
  ])

  return (
    <Stack spacing={3}>
      <Stack spacing={0.5}>
        <Typography variant="h5" fontWeight={700}>
          Оплата
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Текущий тариф и история покупок
        </Typography>
      </Stack>
      <CurrentPlanCard plan={current.plan} subscription={current.subscription} />
      <Stack spacing={1}>
        <Typography variant="subtitle1" fontWeight={700}>
          История
        </Typography>
        <SubscriptionHistoryTable rows={history} />
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 20.4 — Verify and commit**

```bash
pnpm --filter web check-types
git add apps/web/src/app/\(protected\)/settings/billing/ apps/web/src/components/settings/current-plan-card.tsx apps/web/src/components/settings/subscription-history-table.tsx
git commit -m "feat(web): /settings/billing with current plan and history"
```

---

### Task 21: `/settings/integrations` — provider grid

**Files:**

- Create: `apps/web/src/app/(protected)/settings/integrations/page.tsx`
- Create: `apps/web/src/components/settings/integration-card.tsx`

- [ ] **Step 21.1 — `integration-card.tsx` (client)**

```tsx
"use client"

import Link from "next/link"

import { Box, Button, Chip, Stack, Typography } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type Provider = {
  id: string
  slug: string
  name: string
  description: string | null
  scope: "USER" | "WORKSPACE" | "BOTH"
}

type Integration = {
  id: string
  providerId: string
  status: "PENDING" | "CONNECTED" | "DISCONNECTED" | "ERROR"
}

type Props = {
  provider: Provider
  integration: Integration | null
  defaultWorkspaceId: string | null
}

const statusLabel: Record<Integration["status"], string> = {
  PENDING: "Ожидание OAuth",
  CONNECTED: "Подключено",
  DISCONNECTED: "Не подключено",
  ERROR: "Ошибка",
}

const statusColor: Record<Integration["status"], "default" | "success" | "warning" | "error"> = {
  PENDING: "warning",
  CONNECTED: "success",
  DISCONNECTED: "default",
  ERROR: "error",
}

export function IntegrationCard({ provider, integration, defaultWorkspaceId }: Props) {
  const connect = trpc.integration.connect.useMutation()
  const disconnect = trpc.integration.disconnect.useMutation()
  const utils = trpc.useUtils()

  const needsWorkspace = provider.scope === "WORKSPACE" && !defaultWorkspaceId
  const isConnected = integration?.status === "CONNECTED" || integration?.status === "PENDING"

  const handleConnect = async () => {
    if (needsWorkspace) return
    await connect.mutateAsync({
      providerId: provider.id,
      scope: provider.scope === "USER" ? "USER" : "WORKSPACE",
      workspaceId: provider.scope === "WORKSPACE" ? defaultWorkspaceId! : undefined,
    })
    utils.integration.listMine.invalidate()
  }

  const handleDisconnect = async () => {
    if (!integration) return
    await disconnect.mutateAsync({ integrationId: integration.id })
    utils.integration.listMine.invalidate()
  }

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        p: 2.5,
        backgroundColor: "background.paper",
        height: "100%",
      }}
    >
      <Stack spacing={1.5} sx={{ height: "100%" }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Stack spacing={0.5}>
            <Typography variant="subtitle1" fontWeight={700}>
              {provider.name}
            </Typography>
            <Chip
              size="small"
              label={provider.scope === "USER" ? "Личный аккаунт" : "Для workspace"}
            />
          </Stack>
          {integration && (
            <Chip
              size="small"
              label={statusLabel[integration.status]}
              color={statusColor[integration.status]}
            />
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {provider.description ?? "Без описания"}
        </Typography>
        {needsWorkspace ? (
          <Button component={Link} href="/workspaces/new" variant="outlined" size="small">
            Требуется рабочее пространство
          </Button>
        ) : isConnected ? (
          <Button
            variant="outlined"
            color="error"
            size="small"
            onClick={handleDisconnect}
            disabled={disconnect.isPending}
          >
            Отключить
          </Button>
        ) : (
          <Button
            variant="contained"
            size="small"
            onClick={handleConnect}
            disabled={connect.isPending}
          >
            Подключить
          </Button>
        )}
      </Stack>
    </Box>
  )
}
```

- [ ] **Step 21.2 — `settings/integrations/page.tsx`**

```tsx
import { Box, Stack, Typography } from "@repo/ui/components"

import { IntegrationCard } from "@/components/settings/integration-card"
import { getServerTRPC } from "@/trpc/server"

export const metadata = { title: "Интеграции · Настройки" }

export default async function IntegrationsSettingsPage() {
  const trpc = await getServerTRPC()
  const [providers, defaultWs] = await Promise.all([
    trpc.integration.listProviders(),
    trpc.workspace.getDefault(),
  ])
  const integrations = await trpc.integration.listMine({
    workspaceId: defaultWs?.id,
  })

  const integrationByProvider = new Map(integrations.map((i) => [i.providerId, i]))

  return (
    <Stack spacing={3}>
      <Stack spacing={0.5}>
        <Typography variant="h5" fontWeight={700}>
          Интеграции
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Подключите внешние сервисы к своему аккаунту или рабочему пространству
        </Typography>
      </Stack>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr", lg: "1fr 1fr 1fr" },
          gap: 2,
        }}
      >
        {providers.map((p) => (
          <IntegrationCard
            key={p.id}
            provider={p}
            integration={integrationByProvider.get(p.id) ?? null}
            defaultWorkspaceId={defaultWs?.id ?? null}
          />
        ))}
      </Box>
    </Stack>
  )
}
```

- [ ] **Step 21.3 — Verify and commit**

```bash
pnpm --filter web check-types
git add apps/web/src/app/\(protected\)/settings/integrations/ apps/web/src/components/settings/integration-card.tsx
git commit -m "feat(web): /settings/integrations with provider grid"
```

---

### Task 22: `/workspaces/new` — creation form

**Files:**

- Create: `apps/web/src/app/(protected)/workspaces/new/page.tsx`
- Create: `apps/web/src/components/workspace/new-workspace-form.tsx`

- [ ] **Step 22.1 — `new-workspace-form.tsx` (client)**

```tsx
"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Alert, Box, Button, Stack, TextField, Typography } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

export function NewWorkspaceForm() {
  const [name, setName] = useState("")
  const [icon, setIcon] = useState("📒")
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const create = trpc.workspace.create.useMutation({
    onSuccess: (workspace) => {
      router.push(`/workspaces/${workspace.id}`)
    },
    onError: (err) => {
      setError(err.message)
    },
  })

  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        create.mutate({ name: name.trim(), icon })
      }}
      sx={{ maxWidth: 480, mx: "auto", mt: { xs: 4, md: 8 } }}
    >
      <Stack spacing={3}>
        <Stack spacing={1} textAlign="center">
          <Typography variant="h4" fontWeight={800} letterSpacing="-0.02em">
            Создайте рабочее пространство
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Каждое пространство — это контейнер для ваших страниц, баз и медиа
          </Typography>
        </Stack>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="Название"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          inputProps={{ maxLength: 64 }}
          autoFocus
        />
        <TextField
          label="Иконка (эмодзи)"
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          inputProps={{ maxLength: 4 }}
          helperText="Один эмодзи для украшения сайдбара"
        />
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={create.isPending || !name.trim()}
        >
          Создать пространство
        </Button>
      </Stack>
    </Box>
  )
}
```

- [ ] **Step 22.2 — `workspaces/new/page.tsx`**

```tsx
import { Container } from "@repo/ui/components"

import { NewWorkspaceForm } from "@/components/workspace/new-workspace-form"

export const metadata = { title: "Новое пространство" }

export default function NewWorkspacePage() {
  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <NewWorkspaceForm />
    </Container>
  )
}
```

- [ ] **Step 22.3 — Verify**

```bash
pnpm --filter web check-types
```

Expected: exits 0.

- [ ] **Step 22.4 — Commit**

```bash
git add apps/web/src/app/\(protected\)/workspaces/new/ apps/web/src/components/workspace/new-workspace-form.tsx
git commit -m "feat(web): /workspaces/new creation form"
```

---

### Task 23: Workspace shell — layout + forced dark theme

**Files:**

- Create: `apps/web/src/app/(protected)/workspaces/[workspaceId]/layout.tsx`
- Create: `apps/web/src/components/workspace/workspace-shell.tsx`

- [ ] **Step 23.1 — `workspace-shell.tsx`**

```tsx
import type { ReactNode } from "react"

import { Box, CssBaseline, ThemeProvider } from "@repo/ui/components"
import { createAppTheme } from "@repo/ui/theme"

export function WorkspaceShell({ children }: { children: ReactNode }) {
  // Force dark theme for this route, ignoring user preference.
  const theme = createAppTheme("dark")
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "240px minmax(0, 1fr) 340px",
          height: "100vh",
          backgroundColor: "#0c0d10",
          color: "#e7e8ea",
          overflow: "hidden",
        }}
      >
        {children}
      </Box>
    </ThemeProvider>
  )
}
```

- [ ] **Step 23.2 — `workspaces/[workspaceId]/layout.tsx`**

```tsx
import { notFound } from "next/navigation"
import type { ReactNode } from "react"

import { WorkspaceShell } from "@/components/workspace/workspace-shell"
import { getServerTRPC } from "@/trpc/server"

export default async function WorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ workspaceId: string }>
  children: ReactNode
}) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()

  return <WorkspaceShell>{children}</WorkspaceShell>
}
```

- [ ] **Step 23.3 — Verify**

```bash
pnpm --filter web check-types
```

Expected: exits 0. `ThemeProvider`, `CssBaseline`, `createAppTheme` must be re-exported from `@repo/ui/components` and `@repo/ui/theme` respectively. Add them if missing.

- [ ] **Step 23.4 — Commit**

```bash
git add apps/web/src/app/\(protected\)/workspaces/\[workspaceId\]/layout.tsx apps/web/src/components/workspace/workspace-shell.tsx
git commit -m "feat(web): workspace shell layout with forced dark theme"
```

---

### Task 24: Workspace sidebar, toolbar, onboarding, AI panel, cookie banner

**Files:**

- Create: `apps/web/src/components/workspace/workspace-sidebar.tsx`
- Create: `apps/web/src/components/workspace/workspace-toolbar.tsx`
- Create: `apps/web/src/components/workspace/workspace-onboarding.tsx`
- Create: `apps/web/src/components/workspace/workspace-ai-panel.tsx`
- Create: `apps/web/src/components/workspace/cookie-banner.tsx`

- [ ] **Step 24.1 — `workspace-sidebar.tsx` (client)**

```tsx
"use client"

import Link from "next/link"

import { Box, Stack, Typography } from "@repo/ui/components"

type Props = {
  workspace: { id: string; name: string; icon: string | null }
  planName: string
}

export function WorkspaceSidebar({ workspace, planName }: Props) {
  return (
    <Box
      component="aside"
      sx={{
        borderRight: "1px solid #1e2024",
        display: "flex",
        flexDirection: "column",
        px: 1.25,
        py: 1.75,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1, pb: 1.75 }}>
        <Box
          sx={{
            width: 20,
            height: 20,
            borderRadius: 0.75,
            background: "linear-gradient(135deg,#4a9eff,#9c7bff)",
          }}
        />
        <Stack spacing={0}>
          <Typography variant="body2" fontWeight={600}>
            {workspace.icon ? `${workspace.icon} ` : ""}
            {workspace.name}
          </Typography>
          <Typography variant="caption" sx={{ color: "#6b6e75" }}>
            {planName} plan
          </Typography>
        </Stack>
      </Stack>

      <Stack spacing={0.25} sx={{ py: 0.75 }}>
        <NavItem icon="⌕" label="Поиск" href="#" />
        <NavItem icon="⌂" label="Главная" href={`/workspaces/${workspace.id}`} />
        <NavItem icon="⚙" label="Настройки" href="/settings/general" />
      </Stack>

      <Typography
        variant="overline"
        sx={{ color: "#6b6e75", px: 1, pt: 2, pb: 0.5, letterSpacing: "0.06em" }}
      >
        Страницы
      </Typography>
      <Stack spacing={0.25}>
        <NavItem icon="👋" label="Welcome to AnyNote" href={`/workspaces/${workspace.id}`} active />
        <NavItem icon="＋" label="Новая страница" href="#" muted />
      </Stack>

      <Box sx={{ flex: 1 }} />

      <Box sx={{ borderTop: "1px solid #1e2024", pt: 1.25 }}>
        <NavItem icon="🗑" label="Корзина" href="#" muted />
      </Box>
    </Box>
  )
}

function NavItem({
  icon,
  label,
  href,
  active,
  muted,
}: {
  icon: string
  label: string
  href: string
  active?: boolean
  muted?: boolean
}) {
  return (
    <Box
      component={Link}
      href={href}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1,
        py: 0.75,
        borderRadius: 0.75,
        textDecoration: "none",
        color: active ? "#f0f1f3" : muted ? "#6b6e75" : "#a7aab1",
        backgroundColor: active ? "#1a1c20" : "transparent",
        "&:hover": { backgroundColor: active ? "#1a1c20" : "#141619" },
        fontSize: 13,
      }}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </Box>
  )
}
```

- [ ] **Step 24.2 — `workspace-toolbar.tsx`**

```tsx
import { Box, Stack, Typography } from "@repo/ui/components"

type Props = {
  title: string
  editedRelative: string
}

export function WorkspaceToolbar({ title, editedRelative }: Props) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1.5}
      sx={{
        px: 2.25,
        py: 1.25,
        borderBottom: "1px solid #1a1c20",
      }}
    >
      <Typography variant="body2" sx={{ color: "#a7aab1" }}>
        👋 {title}
      </Typography>
      <Typography variant="body2" sx={{ color: "#6b6e75" }}>
        ·
      </Typography>
      <Typography variant="body2" sx={{ color: "#6b6e75" }}>
        Private
      </Typography>
      <Box sx={{ flex: 1 }} />
      <Typography variant="caption" sx={{ color: "#6b6e75" }}>
        {editedRelative}
      </Typography>
      <Typography variant="body2" sx={{ color: "#a7aab1", cursor: "default" }}>
        Share
      </Typography>
      <Typography variant="body2" sx={{ color: "#6b6e75" }}>
        ⋯
      </Typography>
      <Box
        sx={{
          px: 1.25,
          py: 0.5,
          borderRadius: 0.75,
          border: "1px solid #2a2d33",
          backgroundColor: "#1a1c20",
          fontSize: 12,
          color: "#a7aab1",
        }}
      >
        ＋ New AI chat
      </Box>
    </Stack>
  )
}
```

- [ ] **Step 24.3 — `workspace-onboarding.tsx`**

```tsx
import { Box, Stack, Typography } from "@repo/ui/components"

type Item =
  | { kind: "check"; done: boolean; text: React.ReactNode }
  | { kind: "toggle"; text: React.ReactNode }

const items: Item[] = [
  { kind: "check", done: true, text: "Create your first page" },
  { kind: "check", done: true, text: "Pick a workspace icon" },
  {
    kind: "check",
    done: false,
    text: (
      <>
        Try a slash command — type <SlashPill>/heading</SlashPill> on a blank line
      </>
    ),
  },
  { kind: "check", done: false, text: "Import notes from Notion or Obsidian" },
  { kind: "check", done: false, text: "Upload a file or image with drag-and-drop" },
  { kind: "check", done: false, text: "Connect an integration (GitHub, Telegram, AmoCRM)" },
  { kind: "toggle", text: "Advanced: databases, views, filters" },
  { kind: "check", done: false, text: "Share a page with a public link" },
  {
    kind: "check",
    done: false,
    text: (
      <>
        Ask AI about your docs — <SlashPill>/ask</SlashPill>
      </>
    ),
  },
  { kind: "check", done: false, text: "Invite a teammate" },
]

function SlashPill({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="span"
      sx={{
        color: "#9c7bff",
        backgroundColor: "#1a1824",
        px: 0.75,
        py: 0.25,
        borderRadius: 0.5,
        fontFamily: "monospace",
        fontSize: "0.9em",
      }}
    >
      {children}
    </Box>
  )
}

export function WorkspaceOnboarding() {
  return (
    <Box
      component="main"
      sx={{
        flex: 1,
        overflow: "auto",
        display: "flex",
        justifyContent: "center",
        pt: { xs: 6, md: 10 },
        px: { xs: 3, md: 6 },
        pb: 6,
      }}
    >
      <Box sx={{ maxWidth: 480, width: "100%" }}>
        <Typography sx={{ fontSize: 40, lineHeight: 1, mb: 2.25 }}>👋</Typography>
        <Typography
          variant="h3"
          fontWeight={700}
          letterSpacing="-0.02em"
          sx={{ mb: 2.5, color: "#f0f1f3" }}
        >
          Welcome to AnyNote
        </Typography>
        <Stack spacing={1.25}>
          {items.map((item, idx) => (
            <Stack key={idx} direction="row" spacing={1.25} alignItems="center">
              {item.kind === "check" && (
                <Box
                  component="span"
                  sx={{ color: item.done ? "#4a9eff" : "#4a4d55", fontSize: 16 }}
                >
                  {item.done ? "☑" : "☐"}
                </Box>
              )}
              {item.kind === "toggle" && (
                <Box component="span" sx={{ color: "#6b6e75", fontSize: 16 }}>
                  ▸
                </Box>
              )}
              <Typography
                variant="body2"
                sx={{
                  color: item.kind === "check" && item.done ? "#6b6e75" : "#e7e8ea",
                  textDecoration: item.kind === "check" && item.done ? "line-through" : "none",
                }}
              >
                {item.text}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </Box>
    </Box>
  )
}
```

- [ ] **Step 24.4 — `workspace-ai-panel.tsx` (client)**

```tsx
"use client"

import { Box, Stack, Typography } from "@repo/ui/components"

export function WorkspaceAiPanel() {
  return (
    <Box
      component="aside"
      sx={{
        borderLeft: "1px solid #1e2024",
        display: "flex",
        flexDirection: "column",
        p: 1.75,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="body2" sx={{ color: "#a7aab1" }}>
          ✨ AI assistant
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="body2" sx={{ color: "#6b6e75" }}>
          ⋯
        </Typography>
      </Stack>

      <Box sx={{ flex: 1 }} />

      <Stack alignItems="center" spacing={1} sx={{ textAlign: "center", pb: 1.25 }}>
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "linear-gradient(135deg,#9c7bff,#4a9eff)",
          }}
        />
        <Typography variant="body2" fontWeight={600} sx={{ color: "#f0f1f3" }}>
          Hi, I'm Ani
        </Typography>
        <Typography variant="caption" sx={{ color: "#6b6e75" }}>
          Your AnyNote research assistant
        </Typography>
      </Stack>

      <Box
        sx={{ border: "1px solid #2a2d33", borderRadius: 1, backgroundColor: "#121418", p: 1.25 }}
      >
        <Typography variant="body2" sx={{ color: "#6b6e75" }}>
          Summarize my notes from last week...
        </Typography>
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ pt: 1.25, mt: 1, borderTop: "1px solid #1e2024" }}
        >
          <Typography variant="caption" sx={{ color: "#a7aab1" }}>
            Auto mode ⌄
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Box
            sx={{
              width: 22,
              height: 22,
              borderRadius: 0.625,
              backgroundColor: "#4a9eff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
            }}
          >
            ↑
          </Box>
        </Stack>
      </Box>
    </Box>
  )
}
```

- [ ] **Step 24.5 — `cookie-banner.tsx` (client)**

```tsx
"use client"

import { useEffect, useState } from "react"

import { Box, Button, Stack, Typography } from "@repo/ui/components"

const STORAGE_KEY = "cookiesAccepted"

export function CookieBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    setVisible(window.localStorage.getItem(STORAGE_KEY) !== "true")
  }, [])

  const dismiss = (accept: boolean) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, accept ? "true" : "false")
    }
    setVisible(false)
  }

  if (!visible) return null
  return (
    <Box
      sx={{
        position: "fixed",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 1.75,
        backgroundColor: "#17191d",
        color: "#e7e8ea",
        border: "1px solid #2a2d33",
        borderRadius: 1.5,
        px: 1.75,
        py: 1.25,
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        zIndex: 1000,
        fontSize: 12,
      }}
    >
      <Typography variant="caption">We use cookies to improve your experience.</Typography>
      <Stack direction="row" spacing={1}>
        <Button size="small" variant="text" color="inherit" onClick={() => dismiss(false)}>
          Settings
        </Button>
        <Button size="small" variant="text" color="inherit" onClick={() => dismiss(false)}>
          Reject
        </Button>
        <Button size="small" variant="contained" onClick={() => dismiss(true)}>
          Accept all
        </Button>
      </Stack>
    </Box>
  )
}
```

- [ ] **Step 24.6 — Verify**

```bash
pnpm --filter web check-types
```

Expected: exits 0.

- [ ] **Step 24.7 — Commit**

```bash
git add apps/web/src/components/workspace/
git commit -m "feat(web): workspace sidebar, toolbar, onboarding, AI panel, cookie banner"
```

---

### Task 25: `/workspaces/[workspaceId]/page.tsx` — wire everything together

**Files:**

- Create: `apps/web/src/app/(protected)/workspaces/[workspaceId]/page.tsx`

- [ ] **Step 25.1 — Write the page**

```tsx
import { notFound } from "next/navigation"

import { Box } from "@repo/ui/components"

import { CookieBanner } from "@/components/workspace/cookie-banner"
import { WorkspaceAiPanel } from "@/components/workspace/workspace-ai-panel"
import { WorkspaceOnboarding } from "@/components/workspace/workspace-onboarding"
import { WorkspaceSidebar } from "@/components/workspace/workspace-sidebar"
import { WorkspaceToolbar } from "@/components/workspace/workspace-toolbar"
import { getServerTRPC } from "@/trpc/server"

function formatEditedRelative(updated: Date): string {
  const diff = Date.now() - new Date(updated).getTime()
  const minutes = Math.max(1, Math.floor(diff / 60000))
  if (minutes < 60) return `Edited ${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Edited ${hours}h ago`
  const days = Math.floor(hours / 24)
  return `Edited ${days}d ago`
}

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const [workspace, current] = await Promise.all([
    trpc.workspace.getById({ id: workspaceId }),
    trpc.subscription.getCurrent(),
  ])
  if (!workspace) notFound()

  return (
    <>
      <WorkspaceSidebar
        workspace={{ id: workspace.id, name: workspace.name, icon: workspace.icon }}
        planName={current.plan.name}
      />
      <Box sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <WorkspaceToolbar
          title="Welcome to AnyNote"
          editedRelative={formatEditedRelative(workspace.updatedAt)}
        />
        <WorkspaceOnboarding />
      </Box>
      <WorkspaceAiPanel />
      <CookieBanner />
    </>
  )
}
```

- [ ] **Step 25.2 — Verify types**

```bash
pnpm --filter web check-types
```

Expected: exits 0.

- [ ] **Step 25.3 — Commit**

```bash
git add apps/web/src/app/\(protected\)/workspaces/\[workspaceId\]/page.tsx
git commit -m "feat(web): /workspaces/[workspaceId] onboarding page"
```

---

### Task 26: Wire SSR theme reading into root layout

**Files:**

- Modify: `apps/web/src/app/layout.tsx`
- Modify: `packages/ui/src/providers/ui-provider.tsx`

- [ ] **Step 26.1 — Check and update `UiProvider` to accept a `mode` prop**

Open `packages/ui/src/providers/ui-provider.tsx`. It should accept an optional `mode?: "light" | "dark"` prop that it passes to `createAppTheme(mode)`. If it doesn't — add it. If it reads from client state / localStorage — make the initial state respect the passed-in `mode` prop.

Rough shape (adapt to whatever the file already does):

```tsx
"use client"

import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter"
import { ThemeProvider, CssBaseline } from "@mui/material"

import { createAppTheme } from "../theme"

type UiProviderProps = {
  children: React.ReactNode
  mode?: "light" | "dark"
}

export function UiProvider({ children, mode = "light" }: UiProviderProps) {
  const theme = createAppTheme(mode)
  return (
    <AppRouterCacheProvider>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </AppRouterCacheProvider>
  )
}
```

- [ ] **Step 26.2 — Read theme in `apps/web/src/app/layout.tsx`**

Replace the body of `RootLayout` to read cookie first, then (if session exists) read `user_preferences.theme`:

```tsx
import type { Metadata } from "next"
import { cookies } from "next/headers"
import localFont from "next/font/local"

import { UiProvider } from "@repo/ui/providers"

import { getSession } from "@/lib/get-session"
import { getServerTRPC } from "@/trpc/server"
import "./globals.css"

// ... existing font and metadata setup unchanged ...

async function resolveTheme(): Promise<"light" | "dark"> {
  const cookieStore = await cookies()
  const cookieTheme = cookieStore.get("theme")?.value as "light" | "dark" | "system" | undefined

  const session = await getSession()
  if (session) {
    try {
      const prefs = await (await getServerTRPC()).user.getPreferences()
      const stored = (prefs?.theme as "light" | "dark" | "system" | null) ?? cookieTheme ?? "system"
      if (stored !== "system") return stored
    } catch {
      /* fall through to cookie/default */
    }
  }

  if (cookieTheme && cookieTheme !== "system") return cookieTheme
  // "system" and unset both fall back to light for SSR.
  // The client can override via media query post-hydration if we add that later.
  return "light"
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const mode = await resolveTheme()
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <UiProvider mode={mode}>{children}</UiProvider>
      </body>
    </html>
  )
}
```

- [ ] **Step 26.3 — Verify types and the cookie-setting path**

```bash
pnpm --filter web check-types
pnpm --filter @repo/ui check-types
```

Expected: both exit 0.

- [ ] **Step 26.4 — Commit**

```bash
git add apps/web/src/app/layout.tsx packages/ui/src/providers/ui-provider.tsx
git commit -m "feat(web): SSR theme from user preferences with cookie fallback"
```

---

### Task 27: Playwright e2e — workspace flow

**Files:**

- Create: `apps/e2e/workspace-flow.spec.ts`

- [ ] **Step 27.1 — Write the spec**

```ts
import { test, expect } from "@playwright/test"

// This spec requires:
//   - docker compose up -d postgres   (a fresh DB is ideal)
//   - pnpm --filter @repo/db prisma migrate dev   (so migrations are applied)
//   - pnpm --filter web dev                        (in a separate terminal)
//
// To reset state: drop and recreate the database, re-run migration, then re-run this spec.

const email = `victor+${Date.now()}@example.com`
const password = "Password123!"

test("sign up → new workspace → default landing → settings nav", async ({ page }) => {
  // 1. Sign up
  await page.goto("/sign-up")
  await page.getByLabel(/имя/i).fill("Victor")
  await page.getByLabel(/фамилия/i).fill("Luferov")
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/пароль/i).fill(password)
  await page.getByRole("button", { name: /зарегистрироваться|sign ?up/i }).click()

  // 2. Without a default workspace, /app must redirect to /workspaces/new
  await page.goto("/app")
  await expect(page).toHaveURL(/\/workspaces\/new/)

  // 3. Create first workspace
  await page.getByLabel(/название/i).fill("My First Workspace")
  await page.getByRole("button", { name: /создать пространство/i }).click()
  await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]+/)
  await expect(page.getByRole("heading", { level: 3, name: "Welcome to AnyNote" })).toBeVisible()

  // 4. Sidebar navigation to settings
  await page.getByRole("link", { name: "Настройки" }).click()
  await expect(page).toHaveURL("/settings/general")
  await expect(page.getByRole("heading", { name: "Общее" })).toBeVisible()

  // 5. Settings nav to account
  await page.getByRole("link", { name: "Аккаунт" }).click()
  await expect(page).toHaveURL("/settings/account")
  await expect(page.getByRole("heading", { name: "Аккаунт" })).toBeVisible()

  // 6. Free plan limit: /app should redirect to the one workspace
  await page.goto("/app")
  await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]+/)

  // 7. Trying to create a second workspace as a free user must fail.
  await page.goto("/workspaces/new")
  await page.getByLabel(/название/i).fill("Second Workspace")
  await page.getByRole("button", { name: /создать пространство/i }).click()
  await expect(page.getByText(/Free.*пространств/i)).toBeVisible()
})
```

- [ ] **Step 27.2 — Commit (running the spec comes in Task 28)**

```bash
git add apps/e2e/workspace-flow.spec.ts
git commit -m "test(e2e): workspace creation, settings nav, and free-plan limit"
```

---

### Task 28: Full verification

**Files:** none — this task only runs verification commands.

- [ ] **Step 28.1 — Type and lint everywhere**

```bash
pnpm check-types
pnpm lint
```

Expected: both exit 0. Fix anything red before proceeding.

- [ ] **Step 28.2 — Build**

```bash
pnpm build
```

Expected: exits 0. All app and package builds green.

- [ ] **Step 28.3 — Dev server smoke**

In one terminal:

```bash
pnpm exec turbo run dev --filter=web
```

In another:

```bash
for path in / /pricing /sign-in /sign-up /app /settings/general /workspaces/new; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3000$path")
  echo "$code  $path"
done
```

Expected:

- `200 /`
- `200 /pricing`
- `200 /sign-in`
- `200 /sign-up`
- `307 /app` (redirects to /sign-in for an unauthenticated request)
- `307 /settings/general` (redirects to /sign-in)
- `307 /workspaces/new` (redirects to /sign-in)

Stop the dev server after verification.

- [ ] **Step 28.4 — Playwright**

```bash
pnpm exec playwright install chromium  # first run only
pnpm --filter web dev &  # dev server in background
PNPM_WEB_PID=$!
sleep 5
pnpm exec playwright test apps/e2e/workspace-flow.spec.ts
kill $PNPM_WEB_PID
```

Expected: the spec passes. If it fails on selector mismatches, the sign-up / workspace-new labels may not exactly match what the Russian UI uses — adjust selectors in the spec to match the actual rendered labels.

- [ ] **Step 28.5 — Commit any fixes**

If Steps 28.1–28.4 surfaced fixes, commit them as a single wrap-up:

```bash
git add -A
git commit -m "fix: post-verification adjustments for workspace and settings"
```

If nothing changed, skip.

---

## Post-implementation checklist

- [ ] All 28 tasks above have been completed and committed
- [ ] `pnpm lint`, `pnpm check-types`, `pnpm build` all green
- [ ] Playwright `workspace-flow.spec.ts` passing
- [ ] `docker compose exec postgres psql -U user -d anynote -c "\dt"` shows the new tables
- [ ] Dev-server smoke (Step 28.3) shows expected status codes
- [ ] Manual check: sign up a fresh user, create workspace, visit all 4 settings pages, verify theme toggle persists across hard refresh
- [ ] No TODO/FIXME/placeholder comments left in the new code
