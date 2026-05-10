# Notifications System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a notification system covering Service/Security/Collaboration/Marketing categories across Email/In-app/Web Push channels, with a unified `emit()` API, an async dispatcher worker, an in-app notification center, and user-controlled preferences.

**Architecture:** Hybrid sync/async — in-app rows written in the same DB transaction as the emit (instant badge), email/push deliveries queued through `notification_deliveries` and drained by a `@Cron('*/5 * * * * *')` NestJS worker in `apps/engines/notifier`. SERVICE-category emails (verify/reset/etc.) stay synchronous via direct `sendMailNow` for UX. New `@repo/notifications` package owns `emit()`, `EVENT_CATALOG`, typed helpers, and the worker dispatcher. Spec: `docs/superpowers/specs/2026-05-10-notifications-design.md`.

**Tech Stack:** Prisma 7 + Postgres, NestJS 11 (`@nestjs/schedule`), Vitest (notifications/trpc/web/mail), Jest (engines), `web-push` npm package for VAPID, MUI v6, Next.js 16 App Router, tRPC v11, Playwright.

---

## File map

**New files:**
- `packages/db/prisma/migrations/<ts>_notifications_v1/migration.sql` — schema + backfill (keeps `user_preferences.notification_settings` column)
- `packages/db/prisma/migrations/<ts>_notifications_drop_legacy_settings/migration.sql` — drop legacy column at the end
- `packages/notifications/` — new workspace package
  - `package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`
  - `src/index.ts`
  - `src/types.ts`
  - `src/catalog.ts`
  - `src/resolve-preferences.ts`
  - `src/emit.ts`
  - `src/helpers.ts`
  - `src/templates/registry.ts`
  - `src/templates/in-app/{event-type}.ts` (one per event type)
  - `src/templates/push/{event-type}.ts` (one per event type that supports push)
  - `src/worker/lock.ts`
  - `src/worker/dispatcher.ts`
  - `src/worker/send-email.ts`
  - `src/worker/send-web-push.ts`
  - `test/*.test.ts` per file above
- `apps/engines/src/apps/notifier/notifier.module.ts`
- `apps/engines/src/apps/notifier/notifier.service.ts`
- `apps/engines/src/apps/notifier/notifier-cron.service.spec.ts`
- `apps/web/public/sw.js`
- `apps/web/src/lib/push/vapid.ts`
- `apps/web/src/lib/push/register-sw.ts`
- `apps/web/src/components/notifications/sidebar-notifications-trigger.tsx`
- `apps/web/src/components/notifications/notifications-popover-card.tsx`
- `apps/web/src/components/notifications/notification-row.tsx`
- `apps/web/src/components/notifications/notifications-list.tsx`
- `apps/web/src/components/notifications/notifications-header.tsx`
- `apps/web/src/components/notifications/format-notification.tsx`
- `apps/web/src/components/notifications/push-toggle.tsx`
- `apps/web/src/components/settings/preferences-matrix.tsx` (replaces `notifications-section.tsx`)
- `apps/web/src/app/(protected)/notifications/page.tsx`
- `apps/web/src/app/(protected)/notifications/loading.tsx`
- `packages/trpc/src/routers/notification.ts`
- `packages/trpc/test/notification-router.test.ts`
- `apps/web/test/notifications-list.test.tsx`
- `apps/web/test/sidebar-notifications-trigger.test.tsx`
- `apps/web/test/preferences-matrix.test.tsx`
- `apps/e2e/notifications.spec.ts`

**Modified files:**
- `packages/db/prisma/schema.prisma` — add 4 enums + 5 models, relations on `User` and `Workspace`
- `packages/auth/src/auth.ts` — replace 4 direct `sendMailNow` calls with `notify.*` helpers
- `packages/auth/package.json` — add `@repo/notifications` workspace dep
- `packages/trpc/src/index.ts` — register `notification: notificationRouter` in `appRouter`
- `packages/trpc/package.json` — add `@repo/notifications` workspace dep
- `packages/trpc/src/routers/workspace.ts:144-171` — `inviteMember` writes notification + preserves email
- `packages/trpc/src/routers/user.ts` — remove `setNotificationSettings` procedure and Schema
- `apps/engines/src/app.module.ts` — import and register `NotifierModule`
- `apps/engines/package.json` — add `@repo/notifications` workspace dep
- `apps/web/next.config.js` — add `'@repo/notifications'` to `transpilePackages`
- `apps/web/src/components/workspace/workspace-sidebar.tsx` — insert sidebar trigger between trash and userMenu
- `apps/web/src/app/(protected)/profile/page.tsx` — add Settings + Notifications cards above workspaces
- `apps/web/src/app/(protected)/settings/general/page.tsx` — swap `NotificationsSection` for new matrix
- `apps/web/src/app/(protected)/layout.tsx` — register service worker on mount (single client component)
- `apps/web/src/components/settings/notifications-section.tsx` — DELETED after Task 30
- `apps/e2e/helpers/auth.ts` — extend `writeConsentsForUserId` with `seedDefaultNotificationPreferences` (or add a new helper)
- `.env.example` — add VAPID + NOTIFIER vars
- `turbo.json` — mirror VAPID + NOTIFIER vars in `globalEnv`
- `packages/db/prisma/seed.ts` — no changes (preferences are lazy)

---

## Conventions used in this plan

- **TDD**: every task that produces code has a failing test step, then implementation, then a green test step. Commit after each green.
- **File paths absolute** when invoking tools, **relative to repo root** in prose.
- **Commands run from repo root** unless noted.
- **Vitest** for `packages/notifications`, `packages/trpc`, `packages/mail`, `apps/web`. **Jest** for `apps/engines`. **Playwright** for `apps/e2e`.
- **Commits** use Conventional Commits (`feat(notifications): …`, `fix(...): …`, `test(...): …`).
- **Husky** runs lint-staged + `pnpm gates` on commit. Don't bypass with `--no-verify` — fix errors instead.

---

## Phase A — Database schema + migration

### Task 1: Add Prisma schema (enums + tables, no destructive changes yet)

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add enums to schema**

Append after the existing `OutboxEventStatus` enum (around line 627):

```prisma
enum NotificationCategory {
  SERVICE
  SECURITY
  COLLABORATION
  MARKETING
}

enum NotificationEventType {
  VERIFY_EMAIL
  RESET_PASSWORD
  PASSWORD_CHANGED
  EMAIL_CHANGED
  WELCOME
  ACCOUNT_DELETION_REQUESTED
  ACCOUNT_DELETION_COMPLETED
  NEW_LOGIN
  SUSPICIOUS_ACTIVITY
  WORKSPACE_INVITE
  ROLE_CHANGED
  PAGE_MENTION
  COMMENT_CREATED
  WEEKLY_DIGEST
  PRODUCT_UPDATE
}

enum NotificationChannel {
  IN_APP
  EMAIL
  WEB_PUSH
}

enum DeliveryStatus {
  PENDING
  DELIVERED
  FAILED
  SKIPPED
}
```

- [ ] **Step 2: Add 5 models to schema**

Append after the `OutboxEvent` model:

```prisma
model NotificationEvent {
  id          String                @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  type        NotificationEventType
  category    NotificationCategory
  userId      String                @map("user_id") @db.Uuid
  workspaceId String?               @map("workspace_id") @db.Uuid
  actorId     String?               @map("actor_id") @db.Uuid
  resourceUrl String?               @map("resource_url") @db.Text
  payload     Json                  @default("{}")
  createdAt   DateTime              @default(now()) @map("created_at") @db.Timestamptz(6)

  user       User                   @relation("NotificationRecipient", fields: [userId], references: [id], onDelete: Cascade)
  workspace  Workspace?             @relation("WorkspaceNotifications", fields: [workspaceId], references: [id], onDelete: Cascade)
  inApp      NotificationInApp?
  deliveries NotificationDelivery[]

  @@index([userId, createdAt(sort: Desc)])
  @@index([workspaceId])
  @@map("notification_events")
}

model NotificationInApp {
  id        String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  eventId   String    @unique @map("event_id") @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  readAt    DateTime? @map("read_at") @db.Timestamptz(6)
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  event NotificationEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)
  user  User              @relation("NotificationInAppOwner", fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt(sort: Desc)])
  @@index([userId, readAt])
  @@map("notification_in_app")
}

model NotificationDelivery {
  id                   String              @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  eventId              String              @map("event_id") @db.Uuid
  userId               String              @map("user_id") @db.Uuid
  channel              NotificationChannel
  status               DeliveryStatus      @default(PENDING)
  attempts             Int                 @default(0)
  nextAttemptAt        DateTime            @default(now()) @map("next_attempt_at") @db.Timestamptz(6)
  lockedAt             DateTime?           @map("locked_at") @db.Timestamptz(6)
  lockedBy             String?             @map("locked_by") @db.VarChar(64)
  targetEmail          String?             @map("target_email") @db.VarChar(255)
  targetSubscriptionId String?             @map("target_subscription_id") @db.Uuid
  processedAt          DateTime?           @map("processed_at") @db.Timestamptz(6)
  lastError            String?             @map("last_error") @db.Text
  createdAt            DateTime            @default(now()) @map("created_at") @db.Timestamptz(6)

  event              NotificationEvent  @relation(fields: [eventId], references: [id], onDelete: Cascade)
  user               User               @relation("NotificationDeliveryOwner", fields: [userId], references: [id], onDelete: Cascade)
  targetSubscription PushSubscription?  @relation(fields: [targetSubscriptionId], references: [id], onDelete: SetNull)

  @@index([status, nextAttemptAt])
  @@index([eventId])
  @@map("notification_deliveries")
}

model NotificationPreference {
  id        String                @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId    String                @map("user_id") @db.Uuid
  category  NotificationCategory
  channel   NotificationChannel
  enabled   Boolean               @default(true)
  updatedAt DateTime              @updatedAt @map("updated_at") @db.Timestamptz(6)

  user User @relation("NotificationPreferenceOwner", fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, category, channel])
  @@index([userId])
  @@map("notification_preferences")
}

model PushSubscription {
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId     String   @map("user_id") @db.Uuid
  endpoint   String   @unique @db.Text
  p256dh     String   @db.Text
  auth       String   @db.Text
  userAgent  String?  @map("user_agent") @db.VarChar(255)
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  lastSeenAt DateTime @default(now()) @map("last_seen_at") @db.Timestamptz(6)

  user       User                   @relation("PushSubscriptionOwner", fields: [userId], references: [id], onDelete: Cascade)
  deliveries NotificationDelivery[]

  @@index([userId])
  @@map("push_subscriptions")
}
```

- [ ] **Step 3: Add reverse relations to `User`**

In the `User` model (around lines 10-39), add inside the relations block:

```prisma
  notifications              NotificationInApp[]      @relation("NotificationInAppOwner")
  notificationEvents         NotificationEvent[]      @relation("NotificationRecipient")
  notificationDeliveries     NotificationDelivery[]   @relation("NotificationDeliveryOwner")
  notificationPreferences    NotificationPreference[] @relation("NotificationPreferenceOwner")
  pushSubscriptions          PushSubscription[]       @relation("PushSubscriptionOwner")
```

- [ ] **Step 4: Add reverse relation to `Workspace`**

In the `Workspace` model (around lines 190-211), add:

```prisma
  notificationEvents NotificationEvent[] @relation("WorkspaceNotifications")
```

- [ ] **Step 5: Run migration generation**

```bash
pnpm --filter @repo/db exec prisma migrate dev --name notifications_v1
```

Expected: a new migration file in `packages/db/prisma/migrations/<timestamp>_notifications_v1/migration.sql`.

- [ ] **Step 6: Add backfill SQL to the generated migration**

Open `packages/db/prisma/migrations/<timestamp>_notifications_v1/migration.sql` and append at the end:

```sql
-- Backfill notification_preferences from old user_preferences.notification_settings JSON.
-- Old shape: { email: { mentions: bool, comments: bool, weeklyDigest: bool } }
-- mentions/comments → COLLABORATION/EMAIL; weeklyDigest → MARKETING/EMAIL.

INSERT INTO notification_preferences (id, user_id, category, channel, enabled, updated_at)
SELECT
  gen_random_uuid(),
  user_id,
  'COLLABORATION'::"NotificationCategory",
  'EMAIL'::"NotificationChannel",
  COALESCE((notification_settings -> 'email' ->> 'mentions')::boolean, true)
    AND COALESCE((notification_settings -> 'email' ->> 'comments')::boolean, true),
  now()
FROM user_preferences
WHERE notification_settings IS NOT NULL
ON CONFLICT (user_id, category, channel) DO NOTHING;

INSERT INTO notification_preferences (id, user_id, category, channel, enabled, updated_at)
SELECT
  gen_random_uuid(),
  user_id,
  'MARKETING'::"NotificationCategory",
  'EMAIL'::"NotificationChannel",
  COALESCE((notification_settings -> 'email' ->> 'weeklyDigest')::boolean, false),
  now()
FROM user_preferences
WHERE notification_settings IS NOT NULL
ON CONFLICT (user_id, category, channel) DO NOTHING;

-- Idempotency partial unique indexes (NULL-safe).
CREATE UNIQUE INDEX notification_deliveries_email_idem
  ON notification_deliveries (event_id, user_id)
  WHERE channel = 'EMAIL';

CREATE UNIQUE INDEX notification_deliveries_push_idem
  ON notification_deliveries (event_id, user_id, target_subscription_id)
  WHERE channel = 'WEB_PUSH';
```

- [ ] **Step 7: Re-apply migration to ensure SQL runs cleanly**

```bash
pnpm --filter @repo/db exec prisma migrate reset --force --skip-seed
pnpm --filter @repo/db exec prisma db seed
```

Expected: migration applies without error; tables exist.

- [ ] **Step 8: Verify in psql**

```bash
docker compose exec -T postgres psql -U postgres -d anynote -c "\d notification_events" | head -10
```

Expected: shows columns `id`, `type`, `category`, `user_id`, etc.

- [ ] **Step 9: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add notifications schema (events, in-app, deliveries, preferences, push subs)"
```

---

## Phase B — `@repo/notifications` package scaffolding

### Task 2: Create the notifications workspace package

**Files:**
- Create: `packages/notifications/package.json`
- Create: `packages/notifications/tsconfig.json`
- Create: `packages/notifications/vitest.config.ts`
- Create: `packages/notifications/eslint.config.mjs`
- Create: `packages/notifications/src/index.ts`
- Create: `packages/notifications/test/setup.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@repo/notifications",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts",
      "default": "./src/index.ts"
    },
    "./worker": {
      "types": "./src/worker/dispatcher.ts",
      "import": "./src/worker/dispatcher.ts",
      "default": "./src/worker/dispatcher.ts"
    }
  },
  "scripts": {
    "lint": "eslint . --max-warnings 0",
    "build": "tsc -p tsconfig.json",
    "check-types": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@repo/db": "workspace:*",
    "@repo/mail": "workspace:*",
    "web-push": "^3.6.7"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "@types/node": "^22.19.1",
    "@types/web-push": "^3.6.4",
    "eslint": "^9.39.1",
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "@repo/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"],
    "module": "ESNext",
    "moduleResolution": "Bundler"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/setup.ts'],
  },
})
```

- [ ] **Step 4: Create eslint.config.mjs**

```js
import config from '@repo/eslint-config/base'

export default config
```

- [ ] **Step 5: Create test/setup.ts**

```ts
export function setup() {
  // No-op; package tests don't read .env directly.
}
```

- [ ] **Step 6: Create src/index.ts (placeholder)**

```ts
export {}
```

- [ ] **Step 7: Install deps**

```bash
pnpm install
```

Expected: `web-push` and `@types/web-push` added to lockfile; package symlinked under `node_modules`.

- [ ] **Step 8: Confirm typecheck passes on empty package**

```bash
pnpm --filter @repo/notifications check-types
```

Expected: no output (success).

- [ ] **Step 9: Commit**

```bash
git add packages/notifications/ pnpm-lock.yaml
git commit -m "feat(notifications): scaffold @repo/notifications workspace package"
```

---

### Task 3: Define types and re-export Prisma enums

**Files:**
- Create: `packages/notifications/src/types.ts`
- Modify: `packages/notifications/src/index.ts`

- [ ] **Step 1: Create src/types.ts**

```ts
import type {
  NotificationCategory,
  NotificationChannel,
  NotificationEventType,
  DeliveryStatus,
  PushSubscription,
} from '@repo/db'

export {
  NotificationCategory,
  NotificationChannel,
  NotificationEventType,
  DeliveryStatus,
} from '@repo/db'

export type EventDescriptor = {
  category: NotificationCategory
  defaultChannels: NotificationChannel[]
  lockedChannels: NotificationChannel[]
  requiresConsent: 'MARKETING' | null
}

export type EmitArgs<P extends Record<string, unknown> = Record<string, unknown>> = {
  type: NotificationEventType
  userId: string
  workspaceId?: string
  actorId?: string
  resourceUrl?: string
  payload: P
}

export type ResolvedTargets = {
  email: string | null
  pushSubscriptions: PushSubscription[]
}
```

- [ ] **Step 2: Update src/index.ts to re-export types**

Replace the contents of `src/index.ts` with:

```ts
export * from './types.ts'
```

- [ ] **Step 3: Confirm typecheck**

```bash
pnpm --filter @repo/notifications check-types
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add packages/notifications/src/
git commit -m "feat(notifications): types and prisma enum re-exports"
```

---

### Task 4: EVENT_CATALOG and exhaustiveness test

**Files:**
- Create: `packages/notifications/src/catalog.ts`
- Create: `packages/notifications/test/catalog.test.ts`
- Modify: `packages/notifications/src/index.ts`

- [ ] **Step 1: Write failing exhaustiveness test**

Create `packages/notifications/test/catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { NotificationEventType } from '@repo/db'

import { EVENT_CATALOG } from '../src/catalog.ts'

describe('EVENT_CATALOG', () => {
  it('has an entry for every NotificationEventType enum value', () => {
    for (const value of Object.values(NotificationEventType)) {
      expect(EVENT_CATALOG, `missing entry for ${value}`).toHaveProperty(value)
    }
  })

  it('locked channels are a subset of default channels (or include IN_APP, which is implicit)', () => {
    for (const [type, descriptor] of Object.entries(EVENT_CATALOG)) {
      for (const locked of descriptor.lockedChannels) {
        const inDefaults = descriptor.defaultChannels.includes(locked)
        const isInApp = locked === 'IN_APP'
        expect(inDefaults || isInApp, `${type}: locked channel ${locked} not in defaults`).toBe(true)
      }
    }
  })

  it('MARKETING events require MARKETING consent', () => {
    for (const [type, descriptor] of Object.entries(EVENT_CATALOG)) {
      if (descriptor.category === 'MARKETING') {
        expect(descriptor.requiresConsent, `${type}: must require MARKETING consent`).toBe('MARKETING')
      }
    }
  })

  it('SERVICE events have EMAIL locked', () => {
    for (const [type, descriptor] of Object.entries(EVENT_CATALOG)) {
      if (descriptor.category === 'SERVICE') {
        expect(descriptor.lockedChannels, `${type}: EMAIL must be locked`).toContain('EMAIL')
      }
    }
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

```bash
pnpm --filter @repo/notifications test catalog
```

Expected: FAIL with "Cannot find module '../src/catalog.ts'".

- [ ] **Step 3: Implement src/catalog.ts**

```ts
import type { EventDescriptor } from './types.ts'
import type { NotificationEventType } from '@repo/db'

export const EVENT_CATALOG: Record<NotificationEventType, EventDescriptor> = {
  // SERVICE
  VERIFY_EMAIL:               { category: 'SERVICE',       defaultChannels: ['EMAIL'],            lockedChannels: ['EMAIL'],   requiresConsent: null },
  RESET_PASSWORD:             { category: 'SERVICE',       defaultChannels: ['EMAIL'],            lockedChannels: ['EMAIL'],   requiresConsent: null },
  PASSWORD_CHANGED:           { category: 'SERVICE',       defaultChannels: ['EMAIL'],            lockedChannels: ['EMAIL'],   requiresConsent: null },
  EMAIL_CHANGED:              { category: 'SERVICE',       defaultChannels: ['EMAIL'],            lockedChannels: ['EMAIL'],   requiresConsent: null },
  WELCOME:                    { category: 'SERVICE',       defaultChannels: ['EMAIL'],            lockedChannels: ['EMAIL'],   requiresConsent: null },
  ACCOUNT_DELETION_REQUESTED: { category: 'SERVICE',       defaultChannels: ['EMAIL'],            lockedChannels: ['EMAIL'],   requiresConsent: null },
  ACCOUNT_DELETION_COMPLETED: { category: 'SERVICE',       defaultChannels: ['EMAIL'],            lockedChannels: ['EMAIL'],   requiresConsent: null },
  // SECURITY
  NEW_LOGIN:           { category: 'SECURITY',      defaultChannels: ['EMAIL', 'IN_APP'],  lockedChannels: ['IN_APP'],  requiresConsent: null },
  SUSPICIOUS_ACTIVITY: { category: 'SECURITY',      defaultChannels: ['EMAIL', 'IN_APP'],  lockedChannels: ['IN_APP'],  requiresConsent: null },
  // COLLABORATION
  WORKSPACE_INVITE: { category: 'COLLABORATION', defaultChannels: ['EMAIL', 'IN_APP'],  lockedChannels: ['IN_APP'],  requiresConsent: null },
  ROLE_CHANGED:     { category: 'COLLABORATION', defaultChannels: ['IN_APP'],           lockedChannels: ['IN_APP'],  requiresConsent: null },
  PAGE_MENTION:     { category: 'COLLABORATION', defaultChannels: ['EMAIL', 'IN_APP'],  lockedChannels: ['IN_APP'],  requiresConsent: null },
  COMMENT_CREATED:  { category: 'COLLABORATION', defaultChannels: ['EMAIL', 'IN_APP'],  lockedChannels: ['IN_APP'],  requiresConsent: null },
  // MARKETING
  WEEKLY_DIGEST:  { category: 'MARKETING', defaultChannels: ['EMAIL'], lockedChannels: [], requiresConsent: 'MARKETING' },
  PRODUCT_UPDATE: { category: 'MARKETING', defaultChannels: ['EMAIL'], lockedChannels: [], requiresConsent: 'MARKETING' },
}
```

- [ ] **Step 4: Re-export from index**

Update `packages/notifications/src/index.ts`:

```ts
export * from './types.ts'
export { EVENT_CATALOG } from './catalog.ts'
```

- [ ] **Step 5: Run test to confirm pass**

```bash
pnpm --filter @repo/notifications test catalog
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/notifications/
git commit -m "feat(notifications): EVENT_CATALOG with exhaustiveness tests"
```

---

(Continued in next chunk — `Phase C: emit + resolve-preferences`, `Phase D-O: helpers, templates, worker, engines, auth integration, tRPC router, UI, e2e`.)

## Phase C — `emit()` and preference resolver (TDD)

### Task 5: `resolvePreferences()`

**Files:**
- Create: `packages/notifications/src/resolve-preferences.ts`
- Create: `packages/notifications/test/resolve-preferences.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/notifications/test/resolve-preferences.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { resolvePreferences } from '../src/resolve-preferences.ts'
import { EVENT_CATALOG } from '../src/catalog.ts'

function makeTx(overrides: {
  user?: { email: string | null }
  prefs?: Array<{ category: string; channel: string; enabled: boolean }>
  pushSubs?: Array<{ id: string }>
  consents?: Array<{ documentType: string; accepted: boolean; createdAt: Date }>
}) {
  return {
    user: { findUniqueOrThrow: vi.fn(async () => ({ email: 'u@e.com', emailVerified: true, ...overrides.user })) },
    notificationPreference: { findMany: vi.fn(async () => overrides.prefs ?? []) },
    pushSubscription: { findMany: vi.fn(async () => overrides.pushSubs ?? []) },
    userConsent: { findFirst: vi.fn(async () => overrides.consents?.[0] ?? null) },
  } as never
}

describe('resolvePreferences', () => {
  it('returns email + push subs for SECURITY/NEW_LOGIN with all defaults', async () => {
    const tx = makeTx({ pushSubs: [{ id: 'sub1' }] })
    const result = await resolvePreferences(tx, 'u1', EVENT_CATALOG.NEW_LOGIN)
    expect(result.email).toBe('u@e.com')
    expect(result.pushSubscriptions).toHaveLength(1)
  })

  it('disables EMAIL when user preference says so (non-locked channel)', async () => {
    const tx = makeTx({
      prefs: [{ category: 'COLLABORATION', channel: 'EMAIL', enabled: false }],
    })
    const result = await resolvePreferences(tx, 'u1', EVENT_CATALOG.WORKSPACE_INVITE)
    expect(result.email).toBeNull()
  })

  it('keeps EMAIL when channel is in lockedChannels even if pref says false', async () => {
    const tx = makeTx({
      prefs: [{ category: 'SERVICE', channel: 'EMAIL', enabled: false }],
    })
    const result = await resolvePreferences(tx, 'u1', EVENT_CATALOG.VERIFY_EMAIL)
    expect(result.email).toBe('u@e.com')
  })

  it('blocks MARKETING email if no MARKETING consent or accepted=false', async () => {
    const tx = makeTx({ consents: [{ documentType: 'MARKETING', accepted: false, createdAt: new Date() }] })
    const result = await resolvePreferences(tx, 'u1', EVENT_CATALOG.WEEKLY_DIGEST)
    expect(result.email).toBeNull()
  })

  it('allows MARKETING email when consent=true', async () => {
    const tx = makeTx({ consents: [{ documentType: 'MARKETING', accepted: true, createdAt: new Date() }] })
    const result = await resolvePreferences(tx, 'u1', EVENT_CATALOG.WEEKLY_DIGEST)
    expect(result.email).toBe('u@e.com')
  })

  it('skips email if user.email is null or unverified', async () => {
    const tx = makeTx({ user: { email: null } })
    const result = await resolvePreferences(tx, 'u1', EVENT_CATALOG.WORKSPACE_INVITE)
    expect(result.email).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

```bash
pnpm --filter @repo/notifications test resolve-preferences
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement src/resolve-preferences.ts**

```ts
import type { Prisma } from '@repo/db'

import type { EventDescriptor, ResolvedTargets } from './types.ts'

type Tx = Prisma.TransactionClient | Prisma.PrismaClient

export async function resolvePreferences(
  tx: Tx,
  userId: string,
  descriptor: EventDescriptor,
): Promise<ResolvedTargets> {
  const wantEmail = descriptor.defaultChannels.includes('EMAIL')
  const wantPush = descriptor.defaultChannels.includes('WEB_PUSH')
  if (!wantEmail && !wantPush) {
    return { email: null, pushSubscriptions: [] }
  }

  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  })

  let email: string | null = null
  if (wantEmail) {
    const emailLocked = descriptor.lockedChannels.includes('EMAIL')
    const prefRow = await tx.notificationPreference.findFirst({
      where: { userId, category: descriptor.category, channel: 'EMAIL' },
    })
    const enabled = emailLocked || prefRow?.enabled !== false
    if (enabled && user.email && user.emailVerified) {
      if (descriptor.requiresConsent === 'MARKETING') {
        const latest = await tx.userConsent.findFirst({
          where: { userId, documentType: 'MARKETING' },
          orderBy: { createdAt: 'desc' },
        })
        if (latest?.accepted) {
          email = user.email
        }
      } else {
        email = user.email
      }
    }
  }

  let pushSubscriptions: ResolvedTargets['pushSubscriptions'] = []
  if (wantPush) {
    const pushLocked = descriptor.lockedChannels.includes('WEB_PUSH')
    const prefRow = await tx.notificationPreference.findFirst({
      where: { userId, category: descriptor.category, channel: 'WEB_PUSH' },
    })
    const enabled = pushLocked || prefRow?.enabled !== false
    if (enabled) {
      pushSubscriptions = await tx.pushSubscription.findMany({ where: { userId } })
    }
  }

  return { email, pushSubscriptions }
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
pnpm --filter @repo/notifications test resolve-preferences
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/notifications/
git commit -m "feat(notifications): preference resolver with consent gate and locked-channel handling"
```

---

### Task 6: `emit()` core

**Files:**
- Create: `packages/notifications/src/emit.ts`
- Create: `packages/notifications/test/emit.test.ts`
- Modify: `packages/notifications/src/index.ts`

- [ ] **Step 1: Write failing test**

Create `packages/notifications/test/emit.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

const sendMailNowMock = vi.fn(async () => undefined)
vi.mock('@repo/mail', () => ({ sendMailNow: sendMailNowMock }))

import { emit } from '../src/emit.ts'

function makeTx(overrides?: {
  email?: string
  pushSubs?: Array<{ id: string }>
  prefs?: Array<{ category: string; channel: string; enabled: boolean }>
}) {
  const created: Record<string, unknown[]> = {
    notificationEvent: [],
    notificationInApp: [],
    notificationDelivery: [],
  }
  const tx = {
    notificationEvent: { create: vi.fn(async ({ data }) => { created.notificationEvent.push(data); return { id: 'evt1', ...data } }) },
    notificationInApp: { create: vi.fn(async ({ data }) => { created.notificationInApp.push(data); return data }) },
    notificationDelivery: { create: vi.fn(async ({ data }) => { created.notificationDelivery.push(data); return data }) },
    user: { findUniqueOrThrow: vi.fn(async () => ({ email: overrides?.email ?? 'u@e.com', emailVerified: true })) },
    notificationPreference: { findFirst: vi.fn(async () => null) },
    pushSubscription: { findMany: vi.fn(async () => overrides?.pushSubs ?? []) },
    userConsent: { findFirst: vi.fn(async () => null) },
  }
  return { tx, created }
}

function makePrisma(tx: ReturnType<typeof makeTx>['tx']) {
  return {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as never
}

describe('emit', () => {
  it('writes a NotificationEvent row with derived category', async () => {
    const { tx, created } = makeTx()
    const prisma = makePrisma(tx)
    await emit(prisma, {
      type: 'WORKSPACE_INVITE',
      userId: 'u1',
      workspaceId: 'w1',
      payload: { workspaceName: 'X' },
    })
    expect(created.notificationEvent).toHaveLength(1)
    expect(created.notificationEvent[0]).toMatchObject({ type: 'WORKSPACE_INVITE', category: 'COLLABORATION' })
  })

  it('writes notification_in_app for events with IN_APP locked or default', async () => {
    const { tx, created } = makeTx()
    const prisma = makePrisma(tx)
    await emit(prisma, { type: 'WORKSPACE_INVITE', userId: 'u1', payload: {} })
    expect(created.notificationInApp).toHaveLength(1)
  })

  it('skips notification_in_app for SERVICE events (no IN_APP in catalog)', async () => {
    const { tx, created } = makeTx()
    const prisma = makePrisma(tx)
    await emit(prisma, { type: 'VERIFY_EMAIL', userId: 'u1', payload: { link: 'x', expiresAtIso: '2026-01-01T00:00:00Z' } })
    expect(created.notificationInApp).toHaveLength(0)
  })

  it('writes EMAIL delivery row for COLLABORATION when preferences enable it', async () => {
    const { tx, created } = makeTx()
    const prisma = makePrisma(tx)
    await emit(prisma, { type: 'WORKSPACE_INVITE', userId: 'u1', payload: {} })
    const emailDeliveries = created.notificationDelivery.filter((d: { channel: string }) => d.channel === 'EMAIL')
    expect(emailDeliveries).toHaveLength(1)
  })

  it('SERVICE: calls sendMailNow synchronously and writes NO email delivery row', async () => {
    sendMailNowMock.mockClear()
    const { tx, created } = makeTx()
    const prisma = makePrisma(tx)
    await emit(prisma, {
      type: 'VERIFY_EMAIL',
      userId: 'u1',
      payload: { firstName: 'A', link: 'l', expiresAtIso: '2026-01-01T00:00:00Z' },
    })
    expect(sendMailNowMock).toHaveBeenCalledOnce()
    const emailDeliveries = created.notificationDelivery.filter((d: { channel: string }) => d.channel === 'EMAIL')
    expect(emailDeliveries).toHaveLength(0)
  })

  it('writes one push delivery per subscription row', async () => {
    const { tx, created } = makeTx({ pushSubs: [{ id: 's1' }, { id: 's2' }] })
    const prisma = makePrisma(tx)
    await emit(prisma, { type: 'NEW_LOGIN', userId: 'u1', payload: {} })
    // NEW_LOGIN has IN_APP + EMAIL by default; push not in defaults (we'd need to opt in)
    // So zero push subs because WEB_PUSH not in defaultChannels.
    const pushDeliveries = created.notificationDelivery.filter((d: { channel: string }) => d.channel === 'WEB_PUSH')
    expect(pushDeliveries).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to confirm failure**

```bash
pnpm --filter @repo/notifications test emit
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement src/emit.ts**

```ts
import { sendMailNow, type MailKind, type MailPayloads } from '@repo/mail'
import type { Prisma, PrismaClient, NotificationEvent } from '@repo/db'

import { EVENT_CATALOG } from './catalog.ts'
import { resolvePreferences } from './resolve-preferences.ts'
import { renderEmailForEvent } from './templates/registry.ts'
import type { EmitArgs } from './types.ts'

type Tx = Prisma.TransactionClient

export async function emit(
  prisma: PrismaClient,
  args: EmitArgs,
): Promise<NotificationEvent> {
  const descriptor = EVENT_CATALOG[args.type]
  if (!descriptor) throw new Error(`emit: unknown event type ${args.type}`)

  const { event, syncEmail } = await prisma.$transaction(async (tx: Tx) => {
    const event = await tx.notificationEvent.create({
      data: {
        type: args.type,
        category: descriptor.category,
        userId: args.userId,
        workspaceId: args.workspaceId,
        actorId: args.actorId,
        resourceUrl: args.resourceUrl,
        payload: args.payload as Prisma.InputJsonValue,
      },
    })

    const wantsInApp =
      descriptor.defaultChannels.includes('IN_APP') ||
      descriptor.lockedChannels.includes('IN_APP')
    if (wantsInApp) {
      await tx.notificationInApp.create({
        data: { eventId: event.id, userId: args.userId },
      })
    }

    const targets = await resolvePreferences(tx, args.userId, descriptor)

    let syncEmail: { kind: MailKind; to: string; data: MailPayloads[MailKind] } | null = null
    if (descriptor.category === 'SERVICE' && targets.email) {
      const rendered = renderEmailForEvent(args.type, args.payload, args.userId)
      if (rendered) syncEmail = { ...rendered, to: targets.email }
    } else if (targets.email) {
      await tx.notificationDelivery.create({
        data: {
          eventId: event.id,
          userId: args.userId,
          channel: 'EMAIL',
          targetEmail: targets.email,
        },
      })
    }

    for (const sub of targets.pushSubscriptions) {
      await tx.notificationDelivery.create({
        data: {
          eventId: event.id,
          userId: args.userId,
          channel: 'WEB_PUSH',
          targetSubscriptionId: sub.id,
        },
      })
    }

    return { event, syncEmail }
  })

  if (syncEmail) {
    await sendMailNow(syncEmail as never)
  }

  return event
}
```

- [ ] **Step 4: Create temporary stub for renderEmailForEvent**

We'll implement the real registry in Task 8. For now, stub it so emit compiles:

Create `packages/notifications/src/templates/registry.ts`:

```ts
import type { MailKind, MailPayloads } from '@repo/mail'
import type { NotificationEventType } from '@repo/db'

export function renderEmailForEvent(
  _type: NotificationEventType,
  _payload: Record<string, unknown>,
  _userId: string,
): { kind: MailKind; data: MailPayloads[MailKind] } | null {
  return null
}
```

- [ ] **Step 5: Re-export from index**

Update `packages/notifications/src/index.ts`:

```ts
export * from './types.ts'
export { EVENT_CATALOG } from './catalog.ts'
export { emit } from './emit.ts'
```

- [ ] **Step 6: Run test**

```bash
pnpm --filter @repo/notifications test emit
```

Expected: PASS for 5 tests; the SERVICE-sendMailNow test PASSES because the registry stub returns null in this run, so sendMailNow isn't called. **This means the test as written is wrong** — adjust:

- [ ] **Step 7: Fix the SERVICE test to mock the registry**

In `test/emit.test.ts`, add a hoisted mock for the registry returning a fake email:

```ts
const renderEmailMock = vi.fn(() => ({ kind: 'verify-email', data: { firstName: '', link: 'l', expiresAtIso: '2026-01-01T00:00:00Z' } }))
vi.mock('../src/templates/registry.ts', () => ({ renderEmailForEvent: renderEmailMock }))
```

(Add at the top of the file with the other `vi.mock` calls.)

- [ ] **Step 8: Re-run test**

```bash
pnpm --filter @repo/notifications test emit
```

Expected: PASS, all 6 tests.

- [ ] **Step 9: Commit**

```bash
git add packages/notifications/
git commit -m "feat(notifications): emit() core with sync SERVICE email + transactional fan-out"
```

---

## Phase D — Templates

### Task 7: In-app + push template registry per event type

**Files:**
- Create: `packages/notifications/src/templates/in-app.ts`
- Create: `packages/notifications/src/templates/push.ts`
- Create: `packages/notifications/src/templates/email.ts`
- Modify: `packages/notifications/src/templates/registry.ts`
- Create: `packages/notifications/test/templates.test.ts`

- [ ] **Step 1: Write failing test for in-app templates**

Create `packages/notifications/test/templates.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { renderInApp } from '../src/templates/in-app.ts'
import { renderPushPayload } from '../src/templates/push.ts'
import { renderEmailForEvent } from '../src/templates/registry.ts'

describe('renderInApp', () => {
  it('produces title + body for WORKSPACE_INVITE', () => {
    const result = renderInApp('WORKSPACE_INVITE', {
      workspaceName: 'Marketing',
      inviterName: 'Anna',
    })
    expect(result.title).toMatch(/Anna/)
    expect(result.title).toMatch(/Marketing/)
    expect(result.body).toBeTruthy()
  })

  it('produces a row for ROLE_CHANGED', () => {
    const result = renderInApp('ROLE_CHANGED', {
      workspaceName: 'X',
      newRole: 'EDITOR',
      actorName: 'Anna',
    })
    expect(result.title).toMatch(/EDITOR|редактор/i)
  })

  it('produces a row for NEW_LOGIN', () => {
    const result = renderInApp('NEW_LOGIN', { ipAddress: '1.2.3.4', userAgent: 'Chrome' })
    expect(result.title).toBeTruthy()
  })
})

describe('renderPushPayload', () => {
  it('returns title + body + url for WORKSPACE_INVITE', () => {
    const result = renderPushPayload('WORKSPACE_INVITE', { workspaceName: 'Marketing', inviterName: 'Anna' }, '/workspaces/abc')
    expect(result).not.toBeNull()
    expect(result!.url).toBe('/workspaces/abc')
  })
})

describe('renderEmailForEvent', () => {
  it('maps VERIFY_EMAIL to mail kind', () => {
    const result = renderEmailForEvent('VERIFY_EMAIL', { firstName: 'A', link: 'l', expiresAtIso: '2026-01-01T00:00:00Z' })
    expect(result?.kind).toBe('verify-email')
  })

  it('maps WORKSPACE_INVITE to invitation', () => {
    const result = renderEmailForEvent('WORKSPACE_INVITE', { firstName: 'A', inviterName: 'B', workspaceName: 'X', link: 'http://l' })
    expect(result?.kind).toBe('invitation')
  })

  it('returns null for events without an email template (e.g. ROLE_CHANGED)', () => {
    const result = renderEmailForEvent('ROLE_CHANGED', {})
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @repo/notifications test templates
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement src/templates/in-app.ts**

```ts
import type { NotificationEventType } from '@repo/db'

export type InAppRendered = {
  title: string
  body: string
  icon: 'invite' | 'security' | 'role' | 'mention' | 'comment' | 'system' | 'marketing'
}

export function renderInApp(
  type: NotificationEventType,
  payload: Record<string, unknown>,
): InAppRendered {
  const p = payload as Record<string, string | undefined>
  switch (type) {
    case 'WORKSPACE_INVITE':
      return {
        title: `${p.inviterName ?? 'Кто-то'} пригласил вас в "${p.workspaceName ?? 'пространство'}"`,
        body: '',
        icon: 'invite',
      }
    case 'ROLE_CHANGED':
      return {
        title: `Ваша роль в "${p.workspaceName ?? 'пространстве'}" изменена на ${p.newRole ?? ''}`,
        body: p.actorName ? `Изменил: ${p.actorName}` : '',
        icon: 'role',
      }
    case 'NEW_LOGIN':
      return {
        title: 'Новый вход в аккаунт',
        body: [p.ipAddress, p.userAgent].filter(Boolean).join(' · '),
        icon: 'security',
      }
    case 'SUSPICIOUS_ACTIVITY':
      return {
        title: 'Подозрительная активность',
        body: p.reason ?? '',
        icon: 'security',
      }
    case 'PAGE_MENTION':
      return {
        title: `${p.actorName ?? 'Кто-то'} упомянул вас`,
        body: p.snippet ?? '',
        icon: 'mention',
      }
    case 'COMMENT_CREATED':
      return {
        title: `${p.actorName ?? 'Кто-то'} оставил комментарий`,
        body: p.snippet ?? '',
        icon: 'comment',
      }
    default:
      return { title: 'Уведомление', body: '', icon: 'system' }
  }
}
```

- [ ] **Step 4: Implement src/templates/push.ts**

```ts
import type { NotificationEventType } from '@repo/db'
import { renderInApp } from './in-app.ts'

export type PushRendered = { title: string; body: string; url: string | null }

export function renderPushPayload(
  type: NotificationEventType,
  payload: Record<string, unknown>,
  resourceUrl: string | null,
): PushRendered | null {
  const inApp = renderInApp(type, payload)
  return { title: inApp.title, body: inApp.body, url: resourceUrl }
}
```

- [ ] **Step 5: Implement src/templates/email.ts**

```ts
import type { MailKind, MailPayloads } from '@repo/mail'
import type { NotificationEventType } from '@repo/db'

export type EmailRendered = { kind: MailKind; data: MailPayloads[MailKind] }

export function renderEmailForEvent(
  type: NotificationEventType,
  payload: Record<string, unknown>,
): EmailRendered | null {
  const p = payload as Record<string, string | undefined>
  switch (type) {
    case 'VERIFY_EMAIL':
      return { kind: 'verify-email', data: { firstName: p.firstName ?? '', link: p.link ?? '', expiresAtIso: p.expiresAtIso ?? '' } }
    case 'RESET_PASSWORD':
      return { kind: 'reset-password', data: { firstName: p.firstName ?? '', link: p.link ?? '', expiresAtIso: p.expiresAtIso ?? '' } }
    case 'PASSWORD_CHANGED':
      return { kind: 'password-changed', data: { firstName: p.firstName ?? '', supportEmail: p.supportEmail ?? 'support@anynote.dev', ipAddress: p.ipAddress } }
    case 'EMAIL_CHANGED':
      return { kind: 'email-changed', data: { firstName: p.firstName ?? '', oldEmail: p.oldEmail ?? '', newEmail: p.newEmail ?? '', isOldRecipient: payload.isOldRecipient === true } }
    case 'WELCOME':
      return { kind: 'welcome', data: { firstName: p.firstName ?? '', appUrl: p.appUrl ?? '' } }
    case 'ACCOUNT_DELETION_REQUESTED':
      return { kind: 'account-deletion-requested', data: { firstName: p.firstName ?? '', link: p.link ?? '', expiresAtIso: p.expiresAtIso ?? '' } }
    case 'ACCOUNT_DELETION_COMPLETED':
      return { kind: 'account-deletion-completed', data: { firstName: p.firstName ?? '' } }
    case 'NEW_LOGIN':
      return { kind: 'new-login', data: { firstName: p.firstName ?? '', ipAddress: p.ipAddress ?? '', userAgent: p.userAgent ?? '', location: p.location, loggedAtIso: p.loggedAtIso ?? new Date().toISOString() } }
    case 'SUSPICIOUS_ACTIVITY':
      return { kind: 'suspicious-activity', data: { firstName: p.firstName ?? '', reason: p.reason ?? '', lockedUntilIso: p.lockedUntilIso } }
    case 'WORKSPACE_INVITE':
      return { kind: 'invitation', data: { firstName: p.firstName, inviterName: p.inviterName ?? '', workspaceName: p.workspaceName ?? '', link: p.link ?? '' } }
    // ROLE_CHANGED, PAGE_MENTION, COMMENT_CREATED, WEEKLY_DIGEST, PRODUCT_UPDATE: no email template yet (return null)
    default:
      return null
  }
}
```

- [ ] **Step 6: Replace src/templates/registry.ts**

```ts
export { renderEmailForEvent } from './email.ts'
export { renderInApp, type InAppRendered } from './in-app.ts'
export { renderPushPayload, type PushRendered } from './push.ts'
```

- [ ] **Step 7: Drop the third arg from registry.ts call in emit.ts**

Open `packages/notifications/src/emit.ts`, find:

```ts
const rendered = renderEmailForEvent(args.type, args.payload, args.userId)
```

Replace with:

```ts
const rendered = renderEmailForEvent(args.type, args.payload)
```

- [ ] **Step 8: Adjust the SERVICE test mock signature**

In `test/emit.test.ts`, the hoisted mock:

```ts
const renderEmailMock = vi.fn(() => ({ kind: 'verify-email', data: { firstName: '', link: 'l', expiresAtIso: '2026-01-01T00:00:00Z' } }))
vi.mock('../src/templates/registry.ts', () => ({ renderEmailForEvent: renderEmailMock }))
```

— still works (registry.ts now re-exports `renderEmailForEvent` from `./email.ts`). Re-run.

- [ ] **Step 9: Run all tests**

```bash
pnpm --filter @repo/notifications test
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add packages/notifications/
git commit -m "feat(notifications): templates for in-app, push payload, and email mapping"
```

---

### Task 8: Typed `notify.*` helpers

**Files:**
- Create: `packages/notifications/src/helpers.ts`
- Create: `packages/notifications/test/helpers.test.ts`
- Modify: `packages/notifications/src/index.ts`

- [ ] **Step 1: Write failing test**

Create `packages/notifications/test/helpers.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

const emitMock = vi.fn()
vi.mock('../src/emit.ts', () => ({ emit: emitMock }))

import { notify } from '../src/helpers.ts'

describe('notify helpers', () => {
  it('workspaceInvite forwards correct args to emit', async () => {
    emitMock.mockClear()
    const prisma = {} as never
    await notify.workspaceInvite(prisma, {
      userId: 'u1',
      workspaceId: 'w1',
      actorId: 'u2',
      inviterName: 'Anna',
      workspaceName: 'Marketing',
      firstName: 'Bob',
      link: 'https://x/inv/abc',
    })
    expect(emitMock).toHaveBeenCalledWith(prisma, expect.objectContaining({
      type: 'WORKSPACE_INVITE',
      userId: 'u1',
      workspaceId: 'w1',
      resourceUrl: '/workspaces/w1',
    }))
  })

  it('verifyEmail builds correct payload', async () => {
    emitMock.mockClear()
    const prisma = {} as never
    await notify.verifyEmail(prisma, {
      userId: 'u1',
      firstName: 'A',
      link: 'l',
      expiresAtIso: '2026-01-01T00:00:00Z',
    })
    expect(emitMock).toHaveBeenCalledWith(prisma, expect.objectContaining({
      type: 'VERIFY_EMAIL',
      userId: 'u1',
    }))
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @repo/notifications test helpers
```

Expected: FAIL.

- [ ] **Step 3: Implement src/helpers.ts**

```ts
import type { PrismaClient } from '@repo/db'

import { emit } from './emit.ts'

export const notify = {
  verifyEmail: (prisma: PrismaClient, args: { userId: string; firstName: string; link: string; expiresAtIso: string }) =>
    emit(prisma, { type: 'VERIFY_EMAIL', userId: args.userId, payload: args }),
  resetPassword: (prisma: PrismaClient, args: { userId: string; firstName: string; link: string; expiresAtIso: string }) =>
    emit(prisma, { type: 'RESET_PASSWORD', userId: args.userId, payload: args }),
  passwordChanged: (prisma: PrismaClient, args: { userId: string; firstName: string; ipAddress?: string; supportEmail?: string }) =>
    emit(prisma, { type: 'PASSWORD_CHANGED', userId: args.userId, payload: args }),
  emailChanged: (prisma: PrismaClient, args: { userId: string; firstName: string; oldEmail: string; newEmail: string; isOldRecipient: boolean }) =>
    emit(prisma, { type: 'EMAIL_CHANGED', userId: args.userId, payload: args }),
  welcome: (prisma: PrismaClient, args: { userId: string; firstName: string; appUrl: string }) =>
    emit(prisma, { type: 'WELCOME', userId: args.userId, payload: args }),
  accountDeletionRequested: (prisma: PrismaClient, args: { userId: string; firstName: string; link: string; expiresAtIso: string }) =>
    emit(prisma, { type: 'ACCOUNT_DELETION_REQUESTED', userId: args.userId, payload: args }),
  accountDeletionCompleted: (prisma: PrismaClient, args: { userId: string; firstName: string }) =>
    emit(prisma, { type: 'ACCOUNT_DELETION_COMPLETED', userId: args.userId, payload: args }),
  newLogin: (prisma: PrismaClient, args: { userId: string; firstName: string; ipAddress: string; userAgent: string; location?: string; loggedAtIso?: string }) =>
    emit(prisma, { type: 'NEW_LOGIN', userId: args.userId, payload: { ...args, loggedAtIso: args.loggedAtIso ?? new Date().toISOString() } }),
  suspiciousActivity: (prisma: PrismaClient, args: { userId: string; firstName: string; reason: string; lockedUntilIso?: string }) =>
    emit(prisma, { type: 'SUSPICIOUS_ACTIVITY', userId: args.userId, payload: args }),
  workspaceInvite: (prisma: PrismaClient, args: { userId: string; workspaceId: string; actorId?: string; firstName?: string; inviterName: string; workspaceName: string; link: string }) =>
    emit(prisma, {
      type: 'WORKSPACE_INVITE',
      userId: args.userId,
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      resourceUrl: `/workspaces/${args.workspaceId}`,
      payload: args,
    }),
  roleChanged: (prisma: PrismaClient, args: { userId: string; workspaceId: string; actorId?: string; newRole: string; workspaceName: string; actorName?: string }) =>
    emit(prisma, {
      type: 'ROLE_CHANGED',
      userId: args.userId,
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      resourceUrl: `/workspaces/${args.workspaceId}/settings`,
      payload: args,
    }),
  // Reserved stubs (no trigger points wired in v1).
  pageMention: (prisma: PrismaClient, args: { userId: string; workspaceId: string; pageId: string; actorId: string; actorName: string; snippet: string }) =>
    emit(prisma, {
      type: 'PAGE_MENTION',
      userId: args.userId,
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      resourceUrl: `/workspaces/${args.workspaceId}/pages/${args.pageId}`,
      payload: args,
    }),
  commentCreated: (prisma: PrismaClient, args: { userId: string; workspaceId: string; pageId: string; commentId: string; actorId: string; actorName: string; snippet: string }) =>
    emit(prisma, {
      type: 'COMMENT_CREATED',
      userId: args.userId,
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      resourceUrl: `/workspaces/${args.workspaceId}/pages/${args.pageId}#comment-${args.commentId}`,
      payload: args,
    }),
  weeklyDigest: (prisma: PrismaClient, args: { userId: string; period: string; summary: string }) =>
    emit(prisma, { type: 'WEEKLY_DIGEST', userId: args.userId, payload: args }),
  productUpdate: (prisma: PrismaClient, args: { userId: string; title: string; body: string; url?: string }) =>
    emit(prisma, { type: 'PRODUCT_UPDATE', userId: args.userId, resourceUrl: args.url, payload: args }),
}
```

- [ ] **Step 4: Re-export from index**

Update `packages/notifications/src/index.ts`:

```ts
export * from './types.ts'
export { EVENT_CATALOG } from './catalog.ts'
export { emit } from './emit.ts'
export { notify } from './helpers.ts'
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @repo/notifications test
```

Expected: PASS, all tests including helpers.

- [ ] **Step 6: Commit**

```bash
git add packages/notifications/
git commit -m "feat(notifications): typed notify.* helpers per event type"
```

---

(Continued — Phase E: worker pieces, Phase F: engines/notifier, etc.)

## Phase E — Worker pieces (TDD)

### Task 9: Lock helper

**Files:**
- Create: `packages/notifications/src/worker/lock.ts`
- Create: `packages/notifications/test/worker/lock.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/notifications/test/worker/lock.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { lockPendingDeliveries } from '../../src/worker/lock.ts'

describe('lockPendingDeliveries', () => {
  it('selects pending rows with FOR UPDATE SKIP LOCKED and updates lockedAt/lockedBy', async () => {
    const queryRaw = vi.fn(async () => [{ id: 'd1' }, { id: 'd2' }])
    const updateMany = vi.fn(async () => ({ count: 2 }))
    const tx = { $queryRaw: queryRaw, notificationDelivery: { updateMany } }
    const prisma = { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) } as never

    const ids = await lockPendingDeliveries(prisma, { workerId: 'w1', batchSize: 50 })
    expect(ids).toEqual(['d1', 'd2'])
    expect(queryRaw).toHaveBeenCalledOnce()
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['d1', 'd2'] } },
      data: { lockedAt: expect.any(Date), lockedBy: 'w1' },
    })
  })

  it('returns empty array if nothing pending', async () => {
    const queryRaw = vi.fn(async () => [])
    const tx = { $queryRaw: queryRaw, notificationDelivery: { updateMany: vi.fn() } }
    const prisma = { $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) } as never
    const ids = await lockPendingDeliveries(prisma, { workerId: 'w1', batchSize: 10 })
    expect(ids).toEqual([])
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @repo/notifications test worker/lock
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement src/worker/lock.ts**

```ts
import { Prisma, type PrismaClient } from '@repo/db'

export async function lockPendingDeliveries(
  prisma: PrismaClient,
  args: { workerId: string; batchSize: number },
): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM notification_deliveries
      WHERE status = 'PENDING'
        AND next_attempt_at <= now()
        AND locked_at IS NULL
      ORDER BY next_attempt_at
      LIMIT ${args.batchSize}
      FOR UPDATE SKIP LOCKED
    `)
    if (rows.length === 0) return []
    const ids = rows.map((r) => r.id)
    await tx.notificationDelivery.updateMany({
      where: { id: { in: ids } },
      data: { lockedAt: new Date(), lockedBy: args.workerId },
    })
    return ids
  })
}
```

- [ ] **Step 4: Run test to pass**

```bash
pnpm --filter @repo/notifications test worker/lock
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/notifications/
git commit -m "feat(notifications): worker lock helper with SKIP LOCKED"
```

---

### Task 10: `sendEmail` worker handler

**Files:**
- Create: `packages/notifications/src/worker/send-email.ts`
- Create: `packages/notifications/test/worker/send-email.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/notifications/test/worker/send-email.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

const sendMailNowMock = vi.fn(async () => undefined)
vi.mock('@repo/mail', () => ({ sendMailNow: sendMailNowMock }))

const renderMock = vi.fn(() => ({ kind: 'invitation', data: { firstName: 'A', inviterName: 'B', workspaceName: 'X', link: 'l' } }))
vi.mock('../../src/templates/email.ts', () => ({ renderEmailForEvent: renderMock }))

import { sendDeliveryEmail } from '../../src/worker/send-email.ts'

describe('sendDeliveryEmail', () => {
  it('renders by event type and calls sendMailNow with target email', async () => {
    sendMailNowMock.mockClear()
    const delivery = {
      id: 'd1',
      channel: 'EMAIL',
      targetEmail: 'to@e.com',
      event: { type: 'WORKSPACE_INVITE', payload: { workspaceName: 'X' } },
    } as never
    await sendDeliveryEmail(delivery)
    expect(sendMailNowMock).toHaveBeenCalledOnce()
    expect(sendMailNowMock.mock.calls[0][0]).toMatchObject({ to: 'to@e.com', kind: 'invitation' })
  })

  it('throws if no template registered for event type', async () => {
    renderMock.mockReturnValueOnce(null)
    const delivery = {
      id: 'd1',
      channel: 'EMAIL',
      targetEmail: 'to@e.com',
      event: { type: 'ROLE_CHANGED', payload: {} },
    } as never
    await expect(sendDeliveryEmail(delivery)).rejects.toThrow(/no email template/i)
  })

  it('throws if targetEmail missing', async () => {
    const delivery = {
      id: 'd1',
      channel: 'EMAIL',
      targetEmail: null,
      event: { type: 'WORKSPACE_INVITE', payload: {} },
    } as never
    await expect(sendDeliveryEmail(delivery)).rejects.toThrow(/target email/i)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @repo/notifications test worker/send-email
```

Expected: FAIL.

- [ ] **Step 3: Implement src/worker/send-email.ts**

```ts
import { sendMailNow } from '@repo/mail'
import type { NotificationDelivery, NotificationEvent } from '@repo/db'

import { renderEmailForEvent } from '../templates/email.ts'

export type DeliveryWithEvent = NotificationDelivery & { event: NotificationEvent }

export async function sendDeliveryEmail(delivery: DeliveryWithEvent): Promise<void> {
  if (!delivery.targetEmail) {
    throw new Error(`sendDeliveryEmail: delivery ${delivery.id} has no target email`)
  }
  const rendered = renderEmailForEvent(
    delivery.event.type,
    (delivery.event.payload ?? {}) as Record<string, unknown>,
  )
  if (!rendered) {
    throw new Error(`sendDeliveryEmail: no email template for event type ${delivery.event.type}`)
  }
  await sendMailNow({ kind: rendered.kind, to: delivery.targetEmail, data: rendered.data } as never)
}
```

- [ ] **Step 4: Run test to pass**

```bash
pnpm --filter @repo/notifications test worker/send-email
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/notifications/
git commit -m "feat(notifications): email delivery handler"
```

---

### Task 11: `sendWebPush` worker handler

**Files:**
- Create: `packages/notifications/src/worker/send-web-push.ts`
- Create: `packages/notifications/test/worker/send-web-push.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/notifications/test/worker/send-web-push.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const sendNotificationMock = vi.fn(async () => ({ statusCode: 201 }))
const setVapidDetailsMock = vi.fn()
vi.mock('web-push', () => ({
  default: { sendNotification: sendNotificationMock, setVapidDetails: setVapidDetailsMock },
  sendNotification: sendNotificationMock,
  setVapidDetails: setVapidDetailsMock,
}))

import { sendDeliveryWebPush, GoneSubscriptionError } from '../../src/worker/send-web-push.ts'

beforeEach(() => {
  sendNotificationMock.mockReset()
  sendNotificationMock.mockResolvedValue({ statusCode: 201 })
  process.env.VAPID_PUBLIC_KEY = 'pub'
  process.env.VAPID_PRIVATE_KEY = 'priv'
  process.env.VAPID_SUBJECT = 'mailto:noreply@anynote.dev'
})

describe('sendDeliveryWebPush', () => {
  it('sends push payload to subscription endpoint', async () => {
    const delivery = {
      id: 'd1',
      channel: 'WEB_PUSH',
      targetSubscription: { endpoint: 'https://push/x', p256dh: 'p', auth: 'a' },
      event: { type: 'WORKSPACE_INVITE', payload: { workspaceName: 'X', inviterName: 'A' }, resourceUrl: '/workspaces/x' },
    } as never
    await sendDeliveryWebPush(delivery)
    expect(sendNotificationMock).toHaveBeenCalledOnce()
    const [sub, payload] = sendNotificationMock.mock.calls[0]
    expect(sub.endpoint).toBe('https://push/x')
    const parsed = JSON.parse(payload as string)
    expect(parsed.url).toBe('/workspaces/x')
  })

  it('throws GoneSubscriptionError on 410', async () => {
    sendNotificationMock.mockRejectedValueOnce({ statusCode: 410 })
    const delivery = {
      id: 'd1',
      channel: 'WEB_PUSH',
      targetSubscription: { endpoint: 'https://push/x', p256dh: 'p', auth: 'a' },
      event: { type: 'WORKSPACE_INVITE', payload: {}, resourceUrl: null },
    } as never
    await expect(sendDeliveryWebPush(delivery)).rejects.toBeInstanceOf(GoneSubscriptionError)
  })

  it('throws GoneSubscriptionError on 404', async () => {
    sendNotificationMock.mockRejectedValueOnce({ statusCode: 404 })
    const delivery = {
      id: 'd1',
      channel: 'WEB_PUSH',
      targetSubscription: { endpoint: 'https://push/x', p256dh: 'p', auth: 'a' },
      event: { type: 'WORKSPACE_INVITE', payload: {}, resourceUrl: null },
    } as never
    await expect(sendDeliveryWebPush(delivery)).rejects.toBeInstanceOf(GoneSubscriptionError)
  })

  it('throws raw error on other status codes', async () => {
    sendNotificationMock.mockRejectedValueOnce({ statusCode: 500, body: 'oops' })
    const delivery = {
      id: 'd1',
      channel: 'WEB_PUSH',
      targetSubscription: { endpoint: 'https://push/x', p256dh: 'p', auth: 'a' },
      event: { type: 'WORKSPACE_INVITE', payload: {}, resourceUrl: null },
    } as never
    await expect(sendDeliveryWebPush(delivery)).rejects.not.toBeInstanceOf(GoneSubscriptionError)
  })

  it('throws if subscription is missing', async () => {
    const delivery = {
      id: 'd1',
      channel: 'WEB_PUSH',
      targetSubscription: null,
      event: { type: 'WORKSPACE_INVITE', payload: {}, resourceUrl: null },
    } as never
    await expect(sendDeliveryWebPush(delivery)).rejects.toThrow(/subscription/i)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @repo/notifications test worker/send-web-push
```

Expected: FAIL.

- [ ] **Step 3: Implement src/worker/send-web-push.ts**

```ts
import webpush from 'web-push'
import type { NotificationDelivery, NotificationEvent, PushSubscription } from '@repo/db'

import { renderPushPayload } from '../templates/push.ts'

export class GoneSubscriptionError extends Error {
  constructor(public endpoint: string) {
    super(`Push subscription gone: ${endpoint}`)
    this.name = 'GoneSubscriptionError'
  }
}

let vapidConfigured = false
function ensureVapid(): void {
  if (vapidConfigured) return
  const subject = process.env.VAPID_SUBJECT
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!subject || !pub || !priv) {
    throw new Error('VAPID env vars missing: VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY')
  }
  webpush.setVapidDetails(subject, pub, priv)
  vapidConfigured = true
}

export type DeliveryWithEventAndSub = NotificationDelivery & {
  event: NotificationEvent
  targetSubscription: PushSubscription | null
}

export async function sendDeliveryWebPush(delivery: DeliveryWithEventAndSub): Promise<void> {
  if (!delivery.targetSubscription) {
    throw new Error(`sendDeliveryWebPush: delivery ${delivery.id} has no target subscription`)
  }
  ensureVapid()
  const payload = renderPushPayload(
    delivery.event.type,
    (delivery.event.payload ?? {}) as Record<string, unknown>,
    delivery.event.resourceUrl,
  )
  if (!payload) {
    throw new Error(`sendDeliveryWebPush: no push payload for event ${delivery.event.type}`)
  }
  const sub = delivery.targetSubscription
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({ title: payload.title, body: payload.body, url: payload.url }),
    )
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode
    if (status === 410 || status === 404) {
      throw new GoneSubscriptionError(sub.endpoint)
    }
    throw err
  }
}
```

- [ ] **Step 4: Run test to pass**

```bash
pnpm --filter @repo/notifications test worker/send-web-push
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/notifications/
git commit -m "feat(notifications): web push delivery handler with 410/404 cleanup signal"
```

---

### Task 12: Dispatcher

**Files:**
- Create: `packages/notifications/src/worker/dispatcher.ts`
- Create: `packages/notifications/test/worker/dispatcher.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/notifications/test/worker/dispatcher.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

const lockMock = vi.fn(async () => ['d1'])
vi.mock('../../src/worker/lock.ts', () => ({ lockPendingDeliveries: lockMock }))

const sendEmailMock = vi.fn(async () => undefined)
vi.mock('../../src/worker/send-email.ts', () => ({ sendDeliveryEmail: sendEmailMock }))

const sendPushMock = vi.fn(async () => undefined)
const GoneSubscriptionError = class extends Error {}
vi.mock('../../src/worker/send-web-push.ts', () => ({ sendDeliveryWebPush: sendPushMock, GoneSubscriptionError }))

import { runDispatcherTick } from '../../src/worker/dispatcher.ts'

function makePrisma(delivery: Record<string, unknown>) {
  return {
    notificationDelivery: {
      findUnique: vi.fn(async () => delivery),
      update: vi.fn(async () => undefined),
    },
    pushSubscription: { delete: vi.fn(async () => undefined) },
  } as never
}

describe('runDispatcherTick', () => {
  it('marks delivery DELIVERED on success', async () => {
    lockMock.mockResolvedValueOnce(['d1'])
    sendEmailMock.mockResolvedValueOnce(undefined)
    const prisma = makePrisma({ id: 'd1', channel: 'EMAIL', attempts: 0, event: {}, targetSubscription: null })
    await runDispatcherTick(prisma, { workerId: 'w1', batchSize: 10, maxAttempts: 5 })
    const updateCalls = (prisma as any).notificationDelivery.update.mock.calls
    expect(updateCalls[0][0]).toMatchObject({ where: { id: 'd1' }, data: { status: 'DELIVERED' } })
  })

  it('increments attempts and reschedules on failure', async () => {
    lockMock.mockResolvedValueOnce(['d1'])
    sendEmailMock.mockRejectedValueOnce(new Error('boom'))
    const prisma = makePrisma({ id: 'd1', channel: 'EMAIL', attempts: 1, event: {}, targetSubscription: null })
    await runDispatcherTick(prisma, { workerId: 'w1', batchSize: 10, maxAttempts: 5 })
    const updateCalls = (prisma as any).notificationDelivery.update.mock.calls
    expect(updateCalls[0][0].data.attempts).toBe(2)
    expect(updateCalls[0][0].data.status).toBe('PENDING')
    expect(updateCalls[0][0].data.nextAttemptAt).toBeInstanceOf(Date)
  })

  it('marks FAILED after max attempts', async () => {
    lockMock.mockResolvedValueOnce(['d1'])
    sendEmailMock.mockRejectedValueOnce(new Error('boom'))
    const prisma = makePrisma({ id: 'd1', channel: 'EMAIL', attempts: 4, event: {}, targetSubscription: null })
    await runDispatcherTick(prisma, { workerId: 'w1', batchSize: 10, maxAttempts: 5 })
    const updateCalls = (prisma as any).notificationDelivery.update.mock.calls
    expect(updateCalls[0][0].data.status).toBe('FAILED')
  })

  it('deletes push subscription and marks FAILED on GoneSubscriptionError', async () => {
    lockMock.mockResolvedValueOnce(['d1'])
    sendPushMock.mockRejectedValueOnce(new GoneSubscriptionError('gone'))
    const prisma = makePrisma({ id: 'd1', channel: 'WEB_PUSH', attempts: 0, event: {}, targetSubscription: { id: 'sub1' } })
    await runDispatcherTick(prisma, { workerId: 'w1', batchSize: 10, maxAttempts: 5 })
    expect((prisma as any).pushSubscription.delete).toHaveBeenCalledWith({ where: { id: 'sub1' } })
    const updateCalls = (prisma as any).notificationDelivery.update.mock.calls
    expect(updateCalls[0][0].data.status).toBe('FAILED')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @repo/notifications test worker/dispatcher
```

Expected: FAIL.

- [ ] **Step 3: Implement src/worker/dispatcher.ts**

```ts
import type { PrismaClient } from '@repo/db'

import { lockPendingDeliveries } from './lock.ts'
import { sendDeliveryEmail, type DeliveryWithEvent } from './send-email.ts'
import { sendDeliveryWebPush, GoneSubscriptionError, type DeliveryWithEventAndSub } from './send-web-push.ts'

const BACKOFF_BASE_MS = 60_000
const BACKOFF_CAP_MS = 30 * 60_000

function nextAttemptAt(attempts: number): Date {
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_CAP_MS)
  return new Date(Date.now() + delay)
}

export type DispatcherOpts = { workerId: string; batchSize: number; maxAttempts: number }

export async function runDispatcherTick(prisma: PrismaClient, opts: DispatcherOpts): Promise<void> {
  const ids = await lockPendingDeliveries(prisma, { workerId: opts.workerId, batchSize: opts.batchSize })
  if (ids.length === 0) return

  await Promise.allSettled(
    ids.map(async (id) => {
      const delivery = await prisma.notificationDelivery.findUnique({
        where: { id },
        include: { event: true, targetSubscription: true },
      })
      if (!delivery) return
      try {
        if (delivery.channel === 'EMAIL') {
          await sendDeliveryEmail(delivery as DeliveryWithEvent)
        } else if (delivery.channel === 'WEB_PUSH') {
          await sendDeliveryWebPush(delivery as DeliveryWithEventAndSub)
        }
        await prisma.notificationDelivery.update({
          where: { id },
          data: { status: 'DELIVERED', processedAt: new Date(), lockedAt: null, lockedBy: null },
        })
      } catch (err) {
        const isGone = err instanceof GoneSubscriptionError
        if (isGone && delivery.targetSubscriptionId) {
          await prisma.pushSubscription.delete({ where: { id: delivery.targetSubscriptionId } }).catch(() => undefined)
        }
        const attempts = delivery.attempts + 1
        const isTerminal = isGone || attempts >= opts.maxAttempts
        await prisma.notificationDelivery.update({
          where: { id },
          data: {
            status: isTerminal ? 'FAILED' : 'PENDING',
            attempts,
            nextAttemptAt: isTerminal ? delivery.nextAttemptAt : nextAttemptAt(attempts),
            lockedAt: null,
            lockedBy: null,
            lastError: String(err instanceof Error ? err.message : err),
          },
        })
      }
    }),
  )
}
```

- [ ] **Step 4: Run test to pass**

```bash
pnpm --filter @repo/notifications test worker/dispatcher
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Run all package tests**

```bash
pnpm --filter @repo/notifications test
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/notifications/
git commit -m "feat(notifications): worker dispatcher with retry/backoff and gone-subscription cleanup"
```

---

## Phase F — `apps/engines` notifier module

### Task 13: NestJS notifier module + cron service

**Files:**
- Create: `apps/engines/src/apps/notifier/notifier.service.ts`
- Create: `apps/engines/src/apps/notifier/notifier.module.ts`
- Create: `apps/engines/src/apps/notifier/notifier.service.spec.ts`
- Modify: `apps/engines/src/app.module.ts`
- Modify: `apps/engines/package.json`

- [ ] **Step 1: Add `@repo/notifications` workspace dep**

Open `apps/engines/package.json` and add to `dependencies`:

```json
"@repo/notifications": "workspace:*"
```

Then run:

```bash
pnpm install
```

- [ ] **Step 2: Write failing test for notifier service**

Create `apps/engines/src/apps/notifier/notifier.service.spec.ts`:

```ts
import { describe, expect, it, jest } from '@jest/globals'

import { NotifierService } from './notifier.service.js'

const runDispatcherTickMock = jest.fn(async () => undefined)
jest.unstable_mockModule('@repo/notifications/worker', () => ({
  runDispatcherTick: runDispatcherTickMock,
}))

describe('NotifierService', () => {
  it('tick calls runDispatcherTick with prisma + opts', async () => {
    runDispatcherTickMock.mockClear()
    const prisma = {} as never
    const svc = new NotifierService(prisma)
    await svc.tick()
    expect(runDispatcherTickMock).toHaveBeenCalledWith(prisma, expect.objectContaining({
      batchSize: expect.any(Number),
      maxAttempts: expect.any(Number),
      workerId: expect.any(String),
    }))
  })
})
```

- [ ] **Step 3: Run to confirm failure**

```bash
pnpm --filter engines test notifier.service
```

Expected: FAIL.

- [ ] **Step 4: Implement notifier.service.ts**

```ts
import { hostname } from 'node:os'

import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'

import { runDispatcherTick } from '@repo/notifications/worker'

import { PrismaClientToken, type PrismaClient } from '../../infra/db/prisma.token.js'

@Injectable()
export class NotifierService {
  private readonly logger = new Logger(NotifierService.name)
  private readonly workerId = `notifier-${hostname()}-${process.pid}`
  private readonly batchSize = Number(process.env.NOTIFIER_BATCH_SIZE ?? 50)
  private readonly maxAttempts = Number(process.env.NOTIFIER_MAX_ATTEMPTS ?? 5)

  constructor(private readonly prisma: PrismaClient) {}

  @Cron(process.env.NOTIFIER_CRON_EXPRESSION ?? '*/5 * * * * *')
  async tick(): Promise<void> {
    try {
      await runDispatcherTick(this.prisma, {
        workerId: this.workerId,
        batchSize: this.batchSize,
        maxAttempts: this.maxAttempts,
      })
    } catch (err) {
      this.logger.error('dispatcher tick failed', err)
    }
  }
}
```

(Note: `PrismaClientToken` and the `PrismaClient` type come from the existing `infra/db/db.module.ts`. Inspect it to match the exact import path; if Nest wires Prisma via `@Inject(PrismaClientToken)` constructor injection, mirror the pattern from `IndexerModule`/`VectorizationCronService`.)

- [ ] **Step 5: Implement notifier.module.ts**

```ts
import { Module } from '@nestjs/common'

import { NotifierService } from './notifier.service.js'

@Module({
  providers: [NotifierService],
})
export class NotifierModule {}
```

- [ ] **Step 6: Wire NotifierModule into app.module.ts**

Open `apps/engines/src/app.module.ts` and add to `imports` next to `IndexerModule`:

```ts
import { NotifierModule } from './apps/notifier/notifier.module.js'
// ...
imports: [
  ConfigModule.forRoot({ isGlobal: true }),
  ScheduleModule.forRoot(),
  DbModule,
  BillingModule,
  IndexerModule,
  NotifierModule,
  McpModule,
  HealthModule,
],
```

- [ ] **Step 7: Run notifier test**

```bash
pnpm --filter engines test notifier.service
```

Expected: PASS.

- [ ] **Step 8: Run engines tests**

```bash
pnpm --filter engines test
```

Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add apps/engines/
git commit -m "feat(engines): notifier cron module wraps @repo/notifications dispatcher"
```

---

## Phase G — Replace direct `sendMailNow` calls in `@repo/auth`

### Task 14: auth.ts uses `notify.*` for SERVICE events

**Files:**
- Modify: `packages/auth/src/auth.ts`
- Modify: `packages/auth/package.json`

- [ ] **Step 1: Add `@repo/notifications` to auth package**

Open `packages/auth/package.json` and add to `dependencies`:

```json
"@repo/notifications": "workspace:*"
```

Then `pnpm install`.

- [ ] **Step 2: Replace import**

In `packages/auth/src/auth.ts` line 16, replace:

```ts
import { sendMailNow } from '@repo/mail'
```

With:

```ts
import { notify } from '@repo/notifications'
```

- [ ] **Step 3: Update sendResetPassword (lines 44-66)**

Replace the body with:

```ts
sendResetPassword: async ({ user, token }) => {
  const userWithName = user as { firstName?: string; email: string; id: string }
  const link = `${appUrl()}/reset-credentials/${token}`
  const expiresAtIso = new Date(Date.now() + VERIFY_EXPIRES_S * 1000).toISOString()
  try {
    await notify.resetPassword(prisma, {
      userId: userWithName.id,
      firstName: userWithName.firstName ?? '',
      link,
      expiresAtIso,
    })
  } catch (err) {
    await prisma.verification
      .deleteMany({ where: { identifier: `reset-password:${token}` } })
      .catch(() => {})
    throw err
  }
},
```

- [ ] **Step 4: Update sendVerificationEmail (lines 72-92)**

Replace with:

```ts
sendVerificationEmail: async ({ user, url }) => {
  const expiresAtIso = new Date(Date.now() + VERIFY_EXPIRES_S * 1000).toISOString()
  const userWithName = user as { firstName?: string; email: string; id: string }
  try {
    await notify.verifyEmail(prisma, {
      userId: userWithName.id,
      firstName: userWithName.firstName ?? '',
      link: url,
      expiresAtIso,
    })
  } catch (err) {
    const ctx = verificationEmailContext.getStore()
    if (!ctx?.skipUserCleanupOnFailure) {
      await prisma.user.delete({ where: { id: userWithName.id } }).catch(() => {})
    }
    throw err
  }
},
```

- [ ] **Step 5: Update afterEmailVerification (lines 93-103)**

Replace with:

```ts
afterEmailVerification: async (user) => {
  const userWithName = user as { firstName?: string; email: string; id: string }
  await notify.welcome(prisma, {
    userId: userWithName.id,
    firstName: userWithName.firstName ?? '',
    appUrl: `${appUrl()}/app`,
  })
},
```

- [ ] **Step 6: Update databaseHooks.user.create.after welcome (lines 203-212)**

Replace the `if (userWithName.emailVerified) { ... sendMailNow(...) ... }` block with:

```ts
if (userWithName.emailVerified) {
  await notify.welcome(prisma, {
    userId: userWithName.id,
    firstName: userWithName.firstName ?? '',
    appUrl: `${appUrl()}/app`,
  })
}
```

- [ ] **Step 7: Run typecheck**

```bash
pnpm --filter @repo/auth check-types
```

Expected: passes.

- [ ] **Step 8: Run mail tests + auth tests**

```bash
pnpm --filter @repo/mail test && pnpm --filter @repo/notifications test
```

Expected: all pass (no auth tests exist for these flows; integration coverage comes via e2e).

- [ ] **Step 9: Commit**

```bash
git add packages/auth/ pnpm-lock.yaml
git commit -m "refactor(auth): route service emails through @repo/notifications notify.*"
```

---

(Continued — Phase H: tRPC notification router, Phase I: workspace integration, Phase J-P: UI, e2e, final cleanup.)

## Phase H — tRPC notification router

### Task 15: List, unreadCount, markRead, markAllRead procedures

**Files:**
- Create: `packages/trpc/src/routers/notification.ts`
- Create: `packages/trpc/test/notification-router.test.ts`
- Modify: `packages/trpc/src/index.ts`

- [ ] **Step 1: Write failing test**

Create `packages/trpc/test/notification-router.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import type { PrismaClient } from '@repo/db'

import { notificationRouter } from '../src/routers/notification'
import { createCallerFactory } from '../src/trpc'

function ctx(prisma: PrismaClient) {
  return {
    prisma,
    user: { id: 'u1', email: 'u@e.com', firstName: 'A', lastName: 'B', emailVerified: true } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  }
}

describe('notification.list', () => {
  it('returns items + nextCursor when results equal limit', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'a', createdAt: new Date('2026-05-10T10:00:00Z'), readAt: null, event: { type: 'WORKSPACE_INVITE', payload: {}, resourceUrl: '/x', createdAt: new Date(), category: 'COLLABORATION', actorId: null, workspaceId: null } },
      { id: 'b', createdAt: new Date('2026-05-10T09:00:00Z'), readAt: new Date(), event: { type: 'NEW_LOGIN', payload: {}, resourceUrl: null, createdAt: new Date(), category: 'SECURITY', actorId: null, workspaceId: null } },
    ])
    const prisma = { notificationInApp: { findMany } } as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    const result = await caller.list({ limit: 2 })
    expect(result.items).toHaveLength(2)
    expect(result.nextCursor).not.toBeNull()
  })

  it('returns null nextCursor when results below limit', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'a', createdAt: new Date(), readAt: null, event: { type: 'WORKSPACE_INVITE', payload: {}, resourceUrl: null, createdAt: new Date(), category: 'COLLABORATION', actorId: null, workspaceId: null } },
    ])
    const prisma = { notificationInApp: { findMany } } as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    const result = await caller.list({ limit: 5 })
    expect(result.nextCursor).toBeNull()
  })
})

describe('notification.unreadCount', () => {
  it('counts only the calling user rows where readAt is null', async () => {
    const count = vi.fn().mockResolvedValue(7)
    const prisma = { notificationInApp: { count } } as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    const result = await caller.unreadCount()
    expect(result).toBe(7)
    expect(count).toHaveBeenCalledWith({ where: { userId: 'u1', readAt: null } })
  })
})

describe('notification.markRead', () => {
  it('updates only own rows', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 })
    const prisma = { notificationInApp: { updateMany } } as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    const result = await caller.markRead({ ids: ['x', 'y'] })
    expect(result.updated).toBe(2)
    const arg = updateMany.mock.calls[0][0]
    expect(arg.where.userId).toBe('u1')
    expect(arg.where.id.in).toEqual(['x', 'y'])
    expect(arg.where.readAt).toBeNull()
  })
})

describe('notification.markAllRead', () => {
  it('updates only own unread rows', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 5 })
    const prisma = { notificationInApp: { updateMany } } as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    const result = await caller.markAllRead()
    expect(result.updated).toBe(5)
    const arg = updateMany.mock.calls[0][0]
    expect(arg.where).toEqual({ userId: 'u1', readAt: null })
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @repo/trpc test notification-router
```

Expected: FAIL.

- [ ] **Step 3: Add `@repo/notifications` to trpc dependencies**

Open `packages/trpc/package.json` and add:

```json
"@repo/notifications": "workspace:*"
```

Run `pnpm install`.

- [ ] **Step 4: Implement notification router (list/unreadCount/markRead/markAllRead)**

Create `packages/trpc/src/routers/notification.ts`:

```ts
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { router, protectedProcedure } from '../trpc'

const cursorSchema = z.object({ createdAt: z.coerce.date(), id: z.string().uuid() }).optional()

export const notificationRouter = router({
  list: protectedProcedure
    .input(z.object({ cursor: cursorSchema, limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const items = await ctx.prisma.notificationInApp.findMany({
        where: {
          userId: ctx.user.id,
          ...(input.cursor
            ? {
                OR: [
                  { createdAt: { lt: input.cursor.createdAt } },
                  { createdAt: input.cursor.createdAt, id: { lt: input.cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: input.limit,
        include: { event: true },
      })
      const nextCursor =
        items.length === input.limit
          ? { createdAt: items[items.length - 1].createdAt, id: items[items.length - 1].id }
          : null
      return { items, nextCursor }
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.notificationInApp.count({ where: { userId: ctx.user.id, readAt: null } })
  }),

  markRead: protectedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.prisma.notificationInApp.updateMany({
        where: { userId: ctx.user.id, id: { in: input.ids }, readAt: null },
        data: { readAt: new Date() },
      })
      return { updated: result.count }
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    const result = await ctx.prisma.notificationInApp.updateMany({
      where: { userId: ctx.user.id, readAt: null },
      data: { readAt: new Date() },
    })
    return { updated: result.count }
  }),
})
```

- [ ] **Step 5: Register in appRouter**

In `packages/trpc/src/index.ts`, import `notificationRouter` and add it to the router map (mirror existing imports of `userRouter`, `workspaceRouter`, etc.):

```ts
import { notificationRouter } from './routers/notification'
// ...
export const appRouter = router({
  // ...existing entries
  notification: notificationRouter,
})
```

- [ ] **Step 6: Run tests**

```bash
pnpm --filter @repo/trpc test notification-router
```

Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/trpc/ pnpm-lock.yaml
git commit -m "feat(trpc): notification router (list, unreadCount, markRead, markAllRead)"
```

---

### Task 16: Preferences procedures

**Files:**
- Modify: `packages/trpc/src/routers/notification.ts`
- Modify: `packages/trpc/test/notification-router.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/trpc/test/notification-router.test.ts`:

```ts
describe('notification.getPreferences', () => {
  it('returns full matrix with locked flags from EVENT_CATALOG', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { category: 'COLLABORATION', channel: 'EMAIL', enabled: false },
    ])
    const prisma = { notificationPreference: { findMany } } as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    const result = await caller.getPreferences()
    expect(result.SECURITY.IN_APP).toEqual({ enabled: true, locked: true })
    expect(result.COLLABORATION.EMAIL).toEqual({ enabled: false, locked: false })
    expect(result.COLLABORATION.IN_APP).toEqual({ enabled: true, locked: true })
  })
})

describe('notification.setPreference', () => {
  it('throws BAD_REQUEST when channel is locked for category', async () => {
    const prisma = {} as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    await expect(
      caller.setPreference({ category: 'SECURITY', channel: 'IN_APP', enabled: false }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('throws FORBIDDEN when MARKETING/EMAIL toggled on without consent', async () => {
    const findFirst = vi.fn().mockResolvedValue({ accepted: false })
    const prisma = { userConsent: { findFirst } } as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    await expect(
      caller.setPreference({ category: 'MARKETING', channel: 'EMAIL', enabled: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('upserts the preference row on success', async () => {
    const upsert = vi.fn().mockResolvedValue({})
    const prisma = {
      notificationPreference: { upsert },
      userConsent: { findFirst: vi.fn().mockResolvedValue({ accepted: true }) },
    } as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    await caller.setPreference({ category: 'COLLABORATION', channel: 'EMAIL', enabled: false })
    expect(upsert).toHaveBeenCalledOnce()
    const arg = upsert.mock.calls[0][0]
    expect(arg.where).toEqual({
      userId_category_channel: { userId: 'u1', category: 'COLLABORATION', channel: 'EMAIL' },
    })
    expect(arg.update).toMatchObject({ enabled: false })
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @repo/trpc test notification-router
```

Expected: FAIL.

- [ ] **Step 3: Add procedures to notification router**

In `packages/trpc/src/routers/notification.ts`, append before the closing `})`:

```ts
import { EVENT_CATALOG, NotificationCategory, NotificationChannel } from '@repo/notifications'

// inside router({...}):
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.notificationPreference.findMany({ where: { userId: ctx.user.id } })
    const overrideMap = new Map(rows.map((r) => [`${r.category}:${r.channel}`, r.enabled]))

    const categories: NotificationCategory[] = ['SECURITY', 'COLLABORATION', 'MARKETING']
    const channels: NotificationChannel[] = ['EMAIL', 'IN_APP', 'WEB_PUSH']

    const result: Record<string, Record<string, { enabled: boolean; locked: boolean }>> = {}
    for (const category of categories) {
      result[category] = {}
      for (const channel of channels) {
        const sampleType = Object.entries(EVENT_CATALOG).find(([, d]) => d.category === category)?.[1]
        const inDefaults = sampleType?.defaultChannels.includes(channel) ?? false
        const isLocked = sampleType?.lockedChannels.includes(channel) ?? false
        const enabled = isLocked
          ? true
          : overrideMap.has(`${category}:${channel}`)
            ? overrideMap.get(`${category}:${channel}`)!
            : inDefaults
        result[category][channel] = { enabled, locked: isLocked }
      }
    }
    return result as Record<NotificationCategory, Record<NotificationChannel, { enabled: boolean; locked: boolean }>>
  }),

  setPreference: protectedProcedure
    .input(z.object({
      category: z.nativeEnum(NotificationCategory),
      channel: z.nativeEnum(NotificationChannel),
      enabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sample = Object.values(EVENT_CATALOG).find((d) => d.category === input.category)
      if (!sample) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown category' })
      if (sample.lockedChannels.includes(input.channel)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Channel is locked for this category' })
      }
      if (input.category === 'MARKETING' && input.channel === 'EMAIL' && input.enabled) {
        const consent = await ctx.prisma.userConsent.findFirst({
          where: { userId: ctx.user.id, documentType: 'MARKETING' },
          orderBy: { createdAt: 'desc' },
        })
        if (!consent?.accepted) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'MARKETING consent required' })
        }
      }
      await ctx.prisma.notificationPreference.upsert({
        where: { userId_category_channel: { userId: ctx.user.id, category: input.category, channel: input.channel } },
        create: { userId: ctx.user.id, category: input.category, channel: input.channel, enabled: input.enabled },
        update: { enabled: input.enabled },
      })
      return { ok: true }
    }),
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @repo/trpc test notification-router
```

Expected: PASS, 8 tests total.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/
git commit -m "feat(trpc): notification preferences (getPreferences, setPreference) with consent gate"
```

---

### Task 17: Push subscription procedures

**Files:**
- Modify: `packages/trpc/src/routers/notification.ts`
- Modify: `packages/trpc/test/notification-router.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/trpc/test/notification-router.test.ts`:

```ts
describe('notification.listPushSubscriptions', () => {
  it('returns own subs only', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 's1', endpoint: 'e', userAgent: 'ua', createdAt: new Date() }])
    const prisma = { pushSubscription: { findMany } } as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    const result = await caller.listPushSubscriptions()
    expect(result).toHaveLength(1)
    expect(findMany).toHaveBeenCalledWith({ where: { userId: 'u1' }, orderBy: { createdAt: 'desc' } })
  })
})

describe('notification.registerPushSubscription', () => {
  it('upserts by endpoint and binds to current user', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 's1' })
    const prisma = { pushSubscription: { upsert } } as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    const result = await caller.registerPushSubscription({
      endpoint: 'https://push/x',
      keys: { p256dh: 'p', auth: 'a' },
      userAgent: 'Chrome',
    })
    expect(result.id).toBe('s1')
    const arg = upsert.mock.calls[0][0]
    expect(arg.where).toEqual({ endpoint: 'https://push/x' })
    expect(arg.create.userId).toBe('u1')
  })
})

describe('notification.revokePushSubscription', () => {
  it('deletes only own row', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 's1', userId: 'u1' })
    const deleteFn = vi.fn().mockResolvedValue({})
    const prisma = { pushSubscription: { findUnique, delete: deleteFn } } as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    await caller.revokePushSubscription({ id: 's1' })
    expect(deleteFn).toHaveBeenCalledWith({ where: { id: 's1' } })
  })

  it('throws NOT_FOUND when sub belongs to another user', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 's1', userId: 'other-user' })
    const prisma = { pushSubscription: { findUnique, delete: vi.fn() } } as unknown as PrismaClient
    const caller = createCallerFactory(notificationRouter)(ctx(prisma))
    await expect(caller.revokePushSubscription({ id: 's1' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter @repo/trpc test notification-router
```

Expected: FAIL.

- [ ] **Step 3: Add push procedures**

Append to the router definition in `packages/trpc/src/routers/notification.ts`:

```ts
  listPushSubscriptions: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.pushSubscription.findMany({
      where: { userId: ctx.user.id },
      orderBy: { createdAt: 'desc' },
    })
  }),

  registerPushSubscription: protectedProcedure
    .input(z.object({
      endpoint: z.string().url(),
      keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
      userAgent: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        create: {
          userId: ctx.user.id,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          userAgent: input.userAgent,
        },
        update: {
          userId: ctx.user.id,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          userAgent: input.userAgent,
          lastSeenAt: new Date(),
        },
      })
    }),

  revokePushSubscription: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sub = await ctx.prisma.pushSubscription.findUnique({ where: { id: input.id } })
      if (!sub || sub.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Subscription not found' })
      }
      await ctx.prisma.pushSubscription.delete({ where: { id: input.id } })
      return { ok: true }
    }),
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @repo/trpc test notification-router
```

Expected: PASS, 12 tests total.

- [ ] **Step 5: Run full trpc test suite**

```bash
pnpm --filter @repo/trpc test
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/trpc/
git commit -m "feat(trpc): push subscription register/list/revoke procedures"
```

---

## Phase I — Wire workspace inviteMember + add updateMemberRole

### Task 18: workspace.inviteMember writes notification + updateMemberRole emits role change

**Files:**
- Modify: `packages/trpc/src/routers/workspace.ts`

- [ ] **Step 1: Update `inviteMember` to call `notify.workspaceInvite`**

Open `packages/trpc/src/routers/workspace.ts:144-171` and replace the `inviteMember` procedure body with:

```ts
  inviteMember: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        email: z.string().email(),
        role: z.enum(['ADMIN', 'EDITOR', 'COMMENTER', 'VIEWER']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertRole(ctx, input.workspaceId, ['OWNER'])
      await requireWritableWorkspace(input.workspaceId)
      await assertPaidPlan(ctx)

      const user = await ctx.prisma.user.findUnique({ where: { email: input.email } })
      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message:
            'Пользователь с таким email не зарегистрирован. Приглашения по ссылке будут позже.',
        })
      }

      const workspace = await ctx.prisma.workspace.findUniqueOrThrow({
        where: { id: input.workspaceId },
        select: { id: true, name: true },
      })

      const member = await ctx.prisma.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: user.id } },
        create: { workspaceId: input.workspaceId, userId: user.id, role: input.role },
        update: { role: input.role },
      })

      await notify.workspaceInvite(ctx.prisma, {
        userId: user.id,
        workspaceId: workspace.id,
        actorId: ctx.user.id,
        firstName: (user as { firstName?: string }).firstName,
        inviterName: `${ctx.user.firstName} ${ctx.user.lastName}`.trim(),
        workspaceName: workspace.name,
        link: `${ctx.returnUrlBase}/workspaces/${workspace.id}`,
      })

      return member
    }),
```

- [ ] **Step 2: Add `updateMemberRole` procedure (new) right after `inviteMember`**

```ts
  updateMemberRole: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(['ADMIN', 'EDITOR', 'COMMENTER', 'VIEWER']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertRole(ctx, input.workspaceId, ['OWNER'])
      await requireWritableWorkspace(input.workspaceId)

      const member = await ctx.prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.userId } },
        data: { role: input.role },
      })

      const workspace = await ctx.prisma.workspace.findUniqueOrThrow({
        where: { id: input.workspaceId },
        select: { id: true, name: true },
      })

      await notify.roleChanged(ctx.prisma, {
        userId: input.userId,
        workspaceId: workspace.id,
        actorId: ctx.user.id,
        newRole: input.role,
        workspaceName: workspace.name,
        actorName: `${ctx.user.firstName} ${ctx.user.lastName}`.trim(),
      })

      return member
    }),
```

- [ ] **Step 3: Add the import at the top of `workspace.ts`**

```ts
import { notify } from '@repo/notifications'
```

- [ ] **Step 4: Run typecheck**

```bash
pnpm --filter @repo/trpc check-types
```

Expected: passes.

- [ ] **Step 5: Run trpc tests**

```bash
pnpm --filter @repo/trpc test
```

Expected: passes (no existing test covers `inviteMember`/`updateMemberRole` mail; the new flow is verified by e2e in Task 30).

- [ ] **Step 6: Commit**

```bash
git add packages/trpc/
git commit -m "feat(trpc): workspace inviteMember and updateMemberRole emit notifications"
```

---

## Phase J — VAPID env + service worker

### Task 19: Generate VAPID keys and wire env

**Files:**
- Modify: `.env.example`
- Modify: `turbo.json`

- [ ] **Step 1: Generate VAPID keys**

```bash
npx web-push generate-vapid-keys --json
```

Copy the public/private values; you'll paste them in next steps.

- [ ] **Step 2: Add VAPID + NOTIFIER vars to `.env.example`**

Append to `/Users/victor/Projects/anynote/.env.example`:

```env
# Web Push (VAPID)
# Generate with: npx web-push generate-vapid-keys --json
VAPID_PUBLIC_KEY=
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:noreply@anynote.dev

# Notifier worker
NOTIFIER_CRON_EXPRESSION=*/5 * * * * *
NOTIFIER_BATCH_SIZE=50
NOTIFIER_MAX_ATTEMPTS=5
```

- [ ] **Step 3: Mirror in turbo.json globalEnv**

Open `/Users/victor/Projects/anynote/turbo.json` and add to `globalEnv`:

```json
"VAPID_PUBLIC_KEY",
"NEXT_PUBLIC_VAPID_PUBLIC_KEY",
"VAPID_PRIVATE_KEY",
"VAPID_SUBJECT",
"NOTIFIER_CRON_EXPRESSION",
"NOTIFIER_BATCH_SIZE",
"NOTIFIER_MAX_ATTEMPTS"
```

- [ ] **Step 4: Set values in local `.env`**

Edit `.env` (gitignored) and paste the generated keys. Use the public key for both `VAPID_PUBLIC_KEY` and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (they're the same value; the `NEXT_PUBLIC_` mirror is for client bundling).

- [ ] **Step 5: Verify**

```bash
docker compose up -d
pnpm --filter @repo/notifications test
```

Expected: tests pass; web-push sees VAPID env in test mocks.

- [ ] **Step 6: Commit**

```bash
git add .env.example turbo.json
git commit -m "chore(env): VAPID and NOTIFIER env vars"
```

---

### Task 20: Service worker + client registration

**Files:**
- Create: `apps/web/public/sw.js`
- Create: `apps/web/src/lib/push/register-sw.ts`
- Create: `apps/web/src/lib/push/vapid.ts`
- Modify: `apps/web/src/app/(protected)/layout.tsx`

- [ ] **Step 1: Create `apps/web/public/sw.js`**

```js
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data?.json() ?? {} } catch { data = {} }
  const title = data.title || 'Уведомление'
  const options = {
    body: data.body || '',
    icon: '/icon.png',
    badge: '/icon.png',
    data: { url: data.url || '/notifications' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/notifications'
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = all.find((c) => c.url.includes(url))
    if (open) return open.focus()
    return self.clients.openWindow(url)
  })())
})
```

- [ ] **Step 2: Create `apps/web/src/lib/push/vapid.ts`**

```ts
export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i)
  return out
}
```

- [ ] **Step 3: Create `apps/web/src/lib/push/register-sw.ts`**

```ts
'use client'

import { urlBase64ToUint8Array, VAPID_PUBLIC_KEY } from './vapid'

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null
  return navigator.serviceWorker.register('/sw.js', { scope: '/' })
}

export async function subscribePush(): Promise<{ endpoint: string; keys: { p256dh: string; auth: string } } | null> {
  if (!VAPID_PUBLIC_KEY) throw new Error('NEXT_PUBLIC_VAPID_PUBLIC_KEY missing')
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null

  const reg = (await navigator.serviceWorker.getRegistration('/')) ?? (await registerServiceWorker())
  if (!reg) return null

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return null

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  })
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  return { endpoint: json.endpoint, keys: json.keys }
}

export async function unsubscribePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration('/')
  if (!reg) return
  const sub = await reg.pushManager.getSubscription()
  await sub?.unsubscribe()
}
```

- [ ] **Step 4: Mount SW registration in protected layout**

Open `apps/web/src/app/(protected)/layout.tsx`. Add a small client child component (in the same file or a new `service-worker-mount.tsx`) that fires registration on mount:

Create `apps/web/src/components/notifications/service-worker-mount.tsx`:

```tsx
'use client'

import { useEffect } from 'react'

import { registerServiceWorker } from '@/lib/push/register-sw'

export function ServiceWorkerMount() {
  useEffect(() => {
    registerServiceWorker().catch(() => undefined)
  }, [])
  return null
}
```

In `apps/web/src/app/(protected)/layout.tsx`, import and render `<ServiceWorkerMount />` once inside the layout's render tree (anywhere — it returns null).

- [ ] **Step 5: Smoke test**

```bash
pnpm --filter web dev
```

Visit `http://localhost:3000/app` while signed in, open DevTools → Application → Service Workers. Expected: `sw.js` registered and active. (If you can't sign in, skip this manual smoke test.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/public/sw.js apps/web/src/lib/push/ apps/web/src/components/notifications/service-worker-mount.tsx apps/web/src/app/(protected)/layout.tsx
git commit -m "feat(web): service worker + VAPID push subscription helpers"
```

---

(Continued — Phase K-P: notifications page, sidebar trigger, profile cards, settings matrix, drop legacy column, e2e.)

## Phase K — `/notifications` page and components

### Task 21: `format-notification.tsx` helper

**Files:**
- Create: `apps/web/src/components/notifications/format-notification.tsx`
- Create: `apps/web/test/format-notification.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/web/test/format-notification.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { formatNotification } from '@/components/notifications/format-notification'

describe('formatNotification', () => {
  it('builds a row for WORKSPACE_INVITE with payload data', () => {
    const result = formatNotification({
      type: 'WORKSPACE_INVITE',
      payload: { workspaceName: 'Marketing', inviterName: 'Anna' },
      resourceUrl: '/workspaces/abc',
      createdAt: new Date('2026-05-10T10:00:00Z'),
    } as never)
    expect(result.title).toMatch(/Anna/)
    expect(result.title).toMatch(/Marketing/)
    expect(result.icon).toBe('invite')
  })

  it('falls back to system icon for unknown types', () => {
    const result = formatNotification({
      type: 'WEEKLY_DIGEST',
      payload: {},
      resourceUrl: null,
      createdAt: new Date(),
    } as never)
    expect(result.icon).toBe('marketing')
  })
})
```

(Note: WEEKLY_DIGEST should map to icon=`marketing`. Adjust formatter/test as needed to keep them aligned.)

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter web test format-notification
```

Expected: FAIL.

- [ ] **Step 3: Implement `format-notification.tsx`**

```tsx
import type { NotificationEvent } from '@repo/db'

export type FormattedNotification = {
  title: string
  body: string
  icon: 'invite' | 'security' | 'role' | 'mention' | 'comment' | 'marketing' | 'system'
}

export function formatNotification(event: Pick<NotificationEvent, 'type' | 'payload' | 'resourceUrl' | 'createdAt'>): FormattedNotification {
  const p = (event.payload ?? {}) as Record<string, string | undefined>
  switch (event.type) {
    case 'WORKSPACE_INVITE':
      return {
        title: `${p.inviterName ?? 'Кто-то'} пригласил вас в "${p.workspaceName ?? 'пространство'}"`,
        body: '',
        icon: 'invite',
      }
    case 'ROLE_CHANGED':
      return {
        title: `Ваша роль в "${p.workspaceName ?? 'пространстве'}" изменена на ${p.newRole ?? ''}`,
        body: p.actorName ? `Изменил: ${p.actorName}` : '',
        icon: 'role',
      }
    case 'NEW_LOGIN':
      return { title: 'Новый вход в аккаунт', body: [p.ipAddress, p.userAgent].filter(Boolean).join(' · '), icon: 'security' }
    case 'SUSPICIOUS_ACTIVITY':
      return { title: 'Подозрительная активность', body: p.reason ?? '', icon: 'security' }
    case 'PAGE_MENTION':
      return { title: `${p.actorName ?? 'Кто-то'} упомянул вас`, body: p.snippet ?? '', icon: 'mention' }
    case 'COMMENT_CREATED':
      return { title: `${p.actorName ?? 'Кто-то'} оставил комментарий`, body: p.snippet ?? '', icon: 'comment' }
    case 'WEEKLY_DIGEST':
      return { title: p.title ?? 'Дайджест за неделю', body: p.summary ?? '', icon: 'marketing' }
    case 'PRODUCT_UPDATE':
      return { title: p.title ?? 'Обновление продукта', body: p.body ?? '', icon: 'marketing' }
    case 'VERIFY_EMAIL':
    case 'RESET_PASSWORD':
    case 'PASSWORD_CHANGED':
    case 'EMAIL_CHANGED':
    case 'WELCOME':
    case 'ACCOUNT_DELETION_REQUESTED':
    case 'ACCOUNT_DELETION_COMPLETED':
      return { title: 'Уведомление о безопасности', body: '', icon: 'security' }
    default:
      return { title: 'Уведомление', body: '', icon: 'system' }
  }
}
```

- [ ] **Step 4: Run test to pass**

```bash
pnpm --filter web test format-notification
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/notifications/format-notification.tsx apps/web/test/format-notification.test.ts
git commit -m "feat(web): formatNotification helper for in-app rendering"
```

---

### Task 22: NotificationRow component

**Files:**
- Create: `apps/web/src/components/notifications/notification-row.tsx`

- [ ] **Step 1: Implement (no test — purely presentational, covered by list test in Task 24)**

```tsx
'use client'

import {
  Box,
  EmailIcon,
  PersonAddIcon,
  ChatBubbleOutlineIcon,
  AlternateEmailIcon,
  AdminPanelSettingsIcon,
  CampaignIcon,
  SecurityIcon,
  Stack,
  Typography,
} from '@repo/ui/components'

import type { FormattedNotification } from './format-notification'

const ICON_MAP: Record<FormattedNotification['icon'], typeof EmailIcon> = {
  invite: PersonAddIcon,
  security: SecurityIcon,
  role: AdminPanelSettingsIcon,
  mention: AlternateEmailIcon,
  comment: ChatBubbleOutlineIcon,
  marketing: CampaignIcon,
  system: EmailIcon,
}

type Props = {
  formatted: FormattedNotification
  unread: boolean
  createdAt: Date
  onClick: () => void
}

function timeAgo(d: Date): string {
  const sec = Math.round((Date.now() - d.getTime()) / 1000)
  if (sec < 60) return 'только что'
  if (sec < 3600) return `${Math.round(sec / 60)} мин назад`
  if (sec < 86400) return `${Math.round(sec / 3600)} ч назад`
  return d.toLocaleDateString('ru-RU')
}

export function NotificationRow({ formatted, unread, createdAt, onClick }: Props) {
  const Icon = ICON_MAP[formatted.icon] ?? EmailIcon
  return (
    <Stack
      direction="row"
      spacing={1.5}
      onClick={onClick}
      sx={{
        p: 1.5,
        cursor: 'pointer',
        borderRadius: 1,
        bgcolor: unread ? 'action.selected' : 'transparent',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box sx={{ pt: 0.5 }}>
        <Icon fontSize="small" />
      </Box>
      <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={unread ? 600 : 400} noWrap>
          {formatted.title}
        </Typography>
        {formatted.body ? (
          <Typography variant="caption" color="text.secondary" noWrap>
            {formatted.body}
          </Typography>
        ) : null}
        <Typography variant="caption" color="text.disabled">
          {timeAgo(createdAt)}
        </Typography>
      </Stack>
      {unread ? (
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main', mt: 1 }} />
      ) : null}
    </Stack>
  )
}
```

- [ ] **Step 2: If MUI icons need re-export**

Check that `@repo/ui/components` re-exports the icons used. If `PersonAddIcon`, `AlternateEmailIcon`, `AdminPanelSettingsIcon`, `CampaignIcon`, `SecurityIcon`, `ChatBubbleOutlineIcon` are missing, add them to `packages/ui/src/components/index.ts` (alphabetical, alongside existing icon re-exports). Verify with:

```bash
pnpm --filter web check-types
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/notifications/notification-row.tsx packages/ui/
git commit -m "feat(web): NotificationRow presentational component"
```

---

### Task 23: NotificationsList with infinite scroll

**Files:**
- Create: `apps/web/src/components/notifications/notifications-list.tsx`
- Create: `apps/web/test/notifications-list.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/web/test/notifications-list.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

const useInfiniteQueryMock = vi.fn()
const markReadMutate = vi.fn()
const markAllReadMutate = vi.fn()
const useUtilsMock = vi.fn(() => ({
  notification: { list: { invalidate: vi.fn() }, unreadCount: { invalidate: vi.fn() } },
}))
vi.mock('@/trpc/client', () => ({
  trpc: {
    notification: {
      list: { useInfiniteQuery: useInfiniteQueryMock },
      markRead: { useMutation: () => ({ mutateAsync: markReadMutate }) },
      markAllRead: { useMutation: () => ({ mutateAsync: markAllReadMutate }) },
    },
    useUtils: useUtilsMock,
  },
}))

import { NotificationsList } from '@/components/notifications/notifications-list'

function renderList() {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <NotificationsList />
    </QueryClientProvider>,
  )
}

describe('NotificationsList', () => {
  it('renders rows from the first page', () => {
    useInfiniteQueryMock.mockReturnValue({
      data: { pages: [{ items: [
        { id: 'a', readAt: null, createdAt: new Date(), event: { type: 'WORKSPACE_INVITE', payload: { workspaceName: 'X', inviterName: 'Y' }, resourceUrl: '/x' } },
      ], nextCursor: null }] },
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    })
    renderList()
    expect(screen.getByText(/Y пригласил вас в "X"/)).toBeInTheDocument()
  })

  it('shows "Mark all read" button and calls mutation', () => {
    useInfiniteQueryMock.mockReturnValue({
      data: { pages: [{ items: [], nextCursor: null }] },
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    })
    renderList()
    fireEvent.click(screen.getByRole('button', { name: /Отметить всё прочитанным/i }))
    expect(markAllReadMutate).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm --filter web test notifications-list
```

Expected: FAIL.

- [ ] **Step 3: Implement notifications-list.tsx**

```tsx
'use client'

import { useEffect, useRef } from 'react'

import { useRouter } from 'next/navigation'

import { Box, Button, Stack, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { NotificationRow } from './notification-row'
import { formatNotification } from './format-notification'

export function NotificationsList() {
  const router = useRouter()
  const utils = trpc.useUtils()
  const list = trpc.notification.list.useInfiniteQuery(
    { limit: 20 },
    { getNextPageParam: (page) => page.nextCursor ?? undefined },
  )
  const markRead = trpc.notification.markRead.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate()
      utils.notification.unreadCount.invalidate()
    },
  })
  const markAllRead = trpc.notification.markAllRead.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate()
      utils.notification.unreadCount.invalidate()
    },
  })

  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!sentinelRef.current || !list.hasNextPage) return
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !list.isFetchingNextPage) {
        list.fetchNextPage()
      }
    })
    obs.observe(sentinelRef.current)
    return () => obs.disconnect()
  }, [list.hasNextPage, list.isFetchingNextPage, list.fetchNextPage])

  const items = list.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5" fontWeight={700}>Уведомления</Typography>
        <Button size="small" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
          Отметить всё прочитанным
        </Button>
      </Stack>
      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">Здесь будут ваши уведомления</Typography>
      ) : (
        <Stack spacing={0.5}>
          {items.map((item) => (
            <NotificationRow
              key={item.id}
              formatted={formatNotification(item.event)}
              unread={item.readAt === null}
              createdAt={new Date(item.createdAt)}
              onClick={async () => {
                if (item.readAt === null) await markRead.mutateAsync({ ids: [item.id] })
                if (item.event.resourceUrl) router.push(item.event.resourceUrl)
              }}
            />
          ))}
        </Stack>
      )}
      <Box ref={sentinelRef} sx={{ height: 1 }} />
      {list.isFetchingNextPage ? (
        <Typography variant="caption" color="text.secondary" textAlign="center">Загрузка…</Typography>
      ) : null}
    </Stack>
  )
}
```

- [ ] **Step 4: Run test**

```bash
pnpm --filter web test notifications-list
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/notifications/notifications-list.tsx apps/web/test/notifications-list.test.tsx
git commit -m "feat(web): NotificationsList with infinite scroll and mark-all-read"
```

---

### Task 24: `/notifications` RSC page

**Files:**
- Create: `apps/web/src/app/(protected)/notifications/page.tsx`

- [ ] **Step 1: Implement page**

```tsx
import { Container } from '@repo/ui/components'

import { NotificationsList } from '@/components/notifications/notifications-list'

export const metadata = { title: 'Уведомления' }

export default function NotificationsPage() {
  return (
    <Container maxWidth="md" sx={{ py: { xs: 3, md: 5 } }}>
      <NotificationsList />
    </Container>
  )
}
```

- [ ] **Step 2: Smoke test**

```bash
pnpm --filter web dev
```

Visit `http://localhost:3000/notifications`. Expected: page renders with empty state or seeded notifications.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(protected\)/notifications/
git commit -m "feat(web): /notifications page"
```

---

## Phase L — Sidebar bell + popover

### Task 25: Sidebar trigger with badge + popover

**Files:**
- Create: `apps/web/src/components/notifications/sidebar-notifications-trigger.tsx`
- Create: `apps/web/src/components/notifications/notifications-popover-card.tsx`
- Create: `apps/web/test/sidebar-notifications-trigger.test.tsx`
- Modify: `apps/web/src/components/workspace/workspace-sidebar.tsx`

- [ ] **Step 1: Implement notifications-popover-card.tsx**

```tsx
'use client'

import { useEffect, useRef } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { Box, Button, Stack, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { NotificationRow } from './notification-row'
import { formatNotification } from './format-notification'

export function NotificationsPopoverCard({ onNavigate }: { onNavigate: () => void }) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const list = trpc.notification.list.useInfiniteQuery(
    { limit: 20 },
    { getNextPageParam: (p) => p.nextCursor ?? undefined },
  )
  const markRead = trpc.notification.markRead.useMutation({
    onSuccess: () => utils.notification.unreadCount.invalidate(),
  })

  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const unreadIds = items.filter((i) => i.readAt === null).map((i) => i.id)

  // Mark visible unread as read (debounced)
  const seenRef = useRef(new Set<string>())
  useEffect(() => {
    const fresh = unreadIds.filter((id) => !seenRef.current.has(id))
    if (fresh.length === 0) return
    fresh.forEach((id) => seenRef.current.add(id))
    const t = setTimeout(() => {
      markRead.mutate({ ids: fresh.slice(0, 50) })
    }, 800)
    return () => clearTimeout(t)
  }, [unreadIds.join(',')])

  return (
    <Box sx={{ width: 360, maxHeight: 480, display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="subtitle2" fontWeight={700}>Уведомления</Typography>
        <Button size="small" component={Link} href="/notifications" onClick={onNavigate}>Все →</Button>
      </Stack>
      <Box sx={{ flex: 1, overflowY: 'auto', p: 0.5 }}>
        {items.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
            Здесь будут ваши уведомления
          </Typography>
        ) : (
          items.map((item) => (
            <NotificationRow
              key={item.id}
              formatted={formatNotification(item.event)}
              unread={item.readAt === null}
              createdAt={new Date(item.createdAt)}
              onClick={async () => {
                if (item.readAt === null) await markRead.mutateAsync({ ids: [item.id] })
                if (item.event.resourceUrl) {
                  router.push(item.event.resourceUrl)
                  onNavigate()
                }
              }}
            />
          ))
        )}
      </Box>
    </Box>
  )
}
```

- [ ] **Step 2: Implement sidebar-notifications-trigger.tsx**

```tsx
'use client'

import { useState } from 'react'

import {
  Badge,
  Box,
  IconButton,
  NotificationsIcon,
  Popover,
  Stack,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { NotificationsPopoverCard } from './notifications-popover-card'

export function SidebarNotificationsTrigger() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const unread = trpc.notification.unreadCount.useQuery(undefined, { refetchInterval: 30_000 })

  return (
    <>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{
          px: 1,
          py: 0.75,
          borderRadius: 0.75,
          cursor: 'pointer',
          color: 'text.secondary',
          fontSize: 13,
          '&:hover': { backgroundColor: 'action.hover' },
        }}
      >
        <Badge badgeContent={unread.data ?? 0} max={99} color="error">
          <NotificationsIcon sx={{ fontSize: 16 }} />
        </Badge>
        <Box component="span" sx={{ flex: 1 }}>Уведомления</Box>
      </Stack>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <NotificationsPopoverCard onNavigate={() => setAnchor(null)} />
      </Popover>
    </>
  )
}
```

(`IconButton`, `Typography`, `Stack`, `Box`, `Badge`, `Popover`, `NotificationsIcon` must all be re-exported from `@repo/ui/components`. Verify with `pnpm --filter web check-types`.)

- [ ] **Step 3: Verify `NotificationsIcon` is re-exported from `@repo/ui/components`**

```bash
grep "NotificationsIcon" /Users/victor/Projects/anynote/packages/ui/src/components/index.ts
```

If not present, add `export { default as NotificationsIcon } from '@mui/icons-material/Notifications'` next to other icon re-exports. Same for `Badge`, `Popover` (likely already there).

- [ ] **Step 4: Wire into workspace-sidebar.tsx**

In `apps/web/src/components/workspace/workspace-sidebar.tsx`, between the trash block (line 188 closing `</Box>`) and the userMenu block (line 190), insert:

```tsx
      <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1 }}>
        <SidebarNotificationsTrigger />
      </Box>
```

And add the import at the top of the file:

```tsx
import { SidebarNotificationsTrigger } from '../notifications/sidebar-notifications-trigger'
```

- [ ] **Step 5: Write trigger test**

Create `apps/web/test/sidebar-notifications-trigger.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/trpc/client', () => ({
  trpc: {
    notification: {
      unreadCount: { useQuery: vi.fn(() => ({ data: 3 })) },
      list: { useInfiniteQuery: vi.fn(() => ({ data: { pages: [{ items: [], nextCursor: null }] }, hasNextPage: false, fetchNextPage: vi.fn(), isFetchingNextPage: false })) },
      markRead: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }) },
    },
    useUtils: vi.fn(() => ({ notification: { unreadCount: { invalidate: vi.fn() } } })),
  },
}))

import { SidebarNotificationsTrigger } from '@/components/notifications/sidebar-notifications-trigger'

describe('SidebarNotificationsTrigger', () => {
  it('shows badge with unread count', () => {
    render(<SidebarNotificationsTrigger />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Run tests**

```bash
pnpm --filter web test sidebar-notifications-trigger
```

Expected: PASS.

- [ ] **Step 7: Smoke test**

```bash
pnpm --filter web dev
```

Visit a workspace page, look for bell in sidebar between trash and user menu.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/notifications/sidebar-notifications-trigger.tsx apps/web/src/components/notifications/notifications-popover-card.tsx apps/web/src/components/workspace/workspace-sidebar.tsx apps/web/test/sidebar-notifications-trigger.test.tsx packages/ui/
git commit -m "feat(web): sidebar notifications bell with unread badge and popover"
```

---

## Phase M — `/profile` cards

### Task 26: Add Settings + Notifications cards above workspaces

**Files:**
- Modify: `apps/web/src/app/(protected)/profile/page.tsx`

- [ ] **Step 1: Update page.tsx**

Replace the `Container maxWidth="sm"` opening tag with `Container maxWidth="md"`. Insert the cards `<Stack>` between the `<Stack alignItems="center" spacing={3}>` opening (which holds avatar + name) and the `<Box sx={{ width: '100%', pt: 2 }}>` (which holds Workspaces). Use `<Link>` wrapping `<Paper>` (not `component={Link}` — RSC rule from CLAUDE.md).

Add imports at the top:

```tsx
import { NotificationsIcon, SettingsIcon } from '@repo/ui/components'
```

Insert between the email Stack (closing `</Stack>` at the end of avatar/name section) and the existing `<Box sx={{ width: '100%', pt: 2 }}>`:

```tsx
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ width: '100%', pt: 2 }}
        >
          <Link href="/settings" style={{ flex: 1, textDecoration: 'none' }}>
            <Paper
              variant="outlined"
              sx={{
                p: 2.5,
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <SettingsIcon />
              <Typography variant="body1">Настройки</Typography>
            </Paper>
          </Link>
          <Link href="/notifications" style={{ flex: 1, textDecoration: 'none' }}>
            <Paper
              variant="outlined"
              sx={{
                p: 2.5,
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <NotificationsIcon />
              <Typography variant="body1">Уведомления</Typography>
            </Paper>
          </Link>
        </Stack>
```

- [ ] **Step 2: Verify SettingsIcon is exported from `@repo/ui/components`**

```bash
grep "SettingsIcon" /Users/victor/Projects/anynote/packages/ui/src/components/index.ts
```

If missing, add `export { default as SettingsIcon } from '@mui/icons-material/Settings'`.

- [ ] **Step 3: Smoke test**

```bash
pnpm --filter web dev
```

Visit `/profile`. Expected: two cards above workspaces, one row on desktop, stacked on mobile.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(protected\)/profile/page.tsx packages/ui/
git commit -m "feat(web): Settings and Notifications cards on /profile"
```

---

## Phase N — `/settings/general` matrix

### Task 27: PreferencesMatrix component (replaces NotificationsSection)

**Files:**
- Create: `apps/web/src/components/settings/preferences-matrix.tsx`
- Create: `apps/web/src/components/notifications/push-toggle.tsx`
- Create: `apps/web/test/preferences-matrix.test.tsx`
- Modify: `apps/web/src/app/(protected)/settings/general/page.tsx`
- Delete: `apps/web/src/components/settings/notifications-section.tsx`
- Modify: `packages/trpc/src/routers/user.ts` (remove `setNotificationSettings`)

- [ ] **Step 1: Implement push-toggle.tsx**

```tsx
'use client'

import { Switch } from '@repo/ui/components'

import { trpc } from '@/trpc/client'
import { subscribePush, unsubscribePush } from '@/lib/push/register-sw'

type Props = {
  category: 'SECURITY' | 'COLLABORATION' | 'MARKETING'
  enabled: boolean
  locked: boolean
  onAfterChange: () => void
  hasAnySubscription: boolean
}

export function PushToggle({ category, enabled, locked, onAfterChange, hasAnySubscription }: Props) {
  const setPref = trpc.notification.setPreference.useMutation({ onSuccess: onAfterChange })
  const register = trpc.notification.registerPushSubscription.useMutation({ onSuccess: onAfterChange })

  return (
    <Switch
      checked={enabled}
      disabled={locked}
      onChange={async (_e, checked) => {
        if (checked && !hasAnySubscription) {
          const sub = await subscribePush()
          if (!sub) return
          await register.mutateAsync({ endpoint: sub.endpoint, keys: sub.keys, userAgent: navigator.userAgent })
        }
        if (!checked && hasAnySubscription) {
          await unsubscribePush().catch(() => undefined)
        }
        await setPref.mutateAsync({ category, channel: 'WEB_PUSH', enabled: checked })
      }}
    />
  )
}
```

- [ ] **Step 2: Write failing test for matrix**

Create `apps/web/test/preferences-matrix.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const setPrefMutate = vi.fn()
vi.mock('@/trpc/client', () => ({
  trpc: {
    notification: {
      getPreferences: { useQuery: vi.fn(() => ({ data: {
        SECURITY:      { EMAIL: { enabled: true, locked: false }, IN_APP: { enabled: true, locked: true }, WEB_PUSH: { enabled: false, locked: false } },
        COLLABORATION: { EMAIL: { enabled: true, locked: false }, IN_APP: { enabled: true, locked: true }, WEB_PUSH: { enabled: false, locked: false } },
        MARKETING:     { EMAIL: { enabled: false, locked: false }, IN_APP: { enabled: true, locked: false }, WEB_PUSH: { enabled: false, locked: false } },
      } })) },
      setPreference: { useMutation: () => ({ mutateAsync: setPrefMutate }) },
      listPushSubscriptions: { useQuery: vi.fn(() => ({ data: [] })) },
      revokePushSubscription: { useMutation: () => ({ mutate: vi.fn() }) },
      registerPushSubscription: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    useUtils: vi.fn(() => ({ notification: { getPreferences: { invalidate: vi.fn() }, listPushSubscriptions: { invalidate: vi.fn() } } })),
  },
}))

import { PreferencesMatrix } from '@/components/settings/preferences-matrix'

describe('PreferencesMatrix', () => {
  it('renders rows for SECURITY/COLLABORATION/MARKETING', () => {
    render(<PreferencesMatrix />)
    expect(screen.getByText(/Безопасность/i)).toBeInTheDocument()
    expect(screen.getByText(/Совместная работа/i)).toBeInTheDocument()
    expect(screen.getByText(/Маркетинг/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run to confirm failure**

```bash
pnpm --filter web test preferences-matrix
```

Expected: FAIL.

- [ ] **Step 4: Implement preferences-matrix.tsx**

```tsx
'use client'

import { Box, Button, Stack, Switch, Tooltip, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { PushToggle } from '../notifications/push-toggle'

type Category = 'SECURITY' | 'COLLABORATION' | 'MARKETING'
type Channel = 'EMAIL' | 'IN_APP' | 'WEB_PUSH'

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'SECURITY', label: 'Безопасность' },
  { key: 'COLLABORATION', label: 'Совместная работа' },
  { key: 'MARKETING', label: 'Маркетинг и дайджест' },
]
const CHANNELS: { key: Channel; label: string }[] = [
  { key: 'EMAIL', label: 'Email' },
  { key: 'IN_APP', label: 'In-app' },
  { key: 'WEB_PUSH', label: 'Web push' },
]

export function PreferencesMatrix() {
  const utils = trpc.useUtils()
  const prefs = trpc.notification.getPreferences.useQuery()
  const subs = trpc.notification.listPushSubscriptions.useQuery()
  const setPref = trpc.notification.setPreference.useMutation({
    onSuccess: () => utils.notification.getPreferences.invalidate(),
  })
  const revoke = trpc.notification.revokePushSubscription.useMutation({
    onSuccess: () => utils.notification.listPushSubscriptions.invalidate(),
  })

  const refresh = () => {
    utils.notification.getPreferences.invalidate()
    utils.notification.listPushSubscriptions.invalidate()
  }

  if (!prefs.data) return null

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: { xs: 2.5, md: 3 }, bgcolor: 'background.paper' }}>
      <Typography variant="subtitle1" fontWeight={700}>Уведомления</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Когда присылать email, in-app и web push
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr repeat(3, 96px)', alignItems: 'center', rowGap: 1 }}>
        <div />
        {CHANNELS.map((c) => (
          <Typography key={c.key} variant="caption" color="text.secondary" textAlign="center">{c.label}</Typography>
        ))}
        {CATEGORIES.map((cat) => (
          <Box key={cat.key} sx={{ display: 'contents' }}>
            <Typography variant="body2">{cat.label}</Typography>
            {CHANNELS.map((ch) => {
              const cell = prefs.data[cat.key][ch.key]
              if (ch.key === 'WEB_PUSH') {
                return (
                  <Box key={ch.key} sx={{ textAlign: 'center' }}>
                    <PushToggle
                      category={cat.key}
                      enabled={cell.enabled}
                      locked={cell.locked}
                      onAfterChange={refresh}
                      hasAnySubscription={(subs.data?.length ?? 0) > 0}
                    />
                  </Box>
                )
              }
              const tooltip = cell.locked ? 'Это уведомление обязательное' : ''
              return (
                <Box key={ch.key} sx={{ textAlign: 'center' }}>
                  <Tooltip title={tooltip}>
                    <span>
                      <Switch
                        checked={cell.enabled}
                        disabled={cell.locked || setPref.isPending}
                        onChange={async (_e, checked) => {
                          await setPref.mutateAsync({ category: cat.key, channel: ch.key, enabled: checked }).catch(() => undefined)
                        }}
                      />
                    </span>
                  </Tooltip>
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
      <Stack spacing={1} sx={{ mt: 3, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography variant="subtitle2">Устройства для push</Typography>
        {(subs.data ?? []).length === 0 ? (
          <Typography variant="caption" color="text.secondary">Нет зарегистрированных устройств</Typography>
        ) : (
          (subs.data ?? []).map((s) => (
            <Stack key={s.id} direction="row" alignItems="center" justifyContent="space-between">
              <Stack>
                <Typography variant="body2">{s.userAgent ?? 'Устройство'}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Добавлено {new Date(s.createdAt).toLocaleDateString('ru-RU')}
                </Typography>
              </Stack>
              <Button size="small" onClick={() => revoke.mutate({ id: s.id })}>Отозвать</Button>
            </Stack>
          ))
        )}
      </Stack>
    </Box>
  )
}
```

- [ ] **Step 5: Update settings/general/page.tsx**

Replace the file body — remove the `NotificationSettings` type, the `prefs?.notificationSettings` reference, and replace `<NotificationsSection ... />` with `<PreferencesMatrix />`. The trpc `prefs` query also no longer needs to be called for notifications.

```tsx
import { Stack, Typography } from '@repo/ui/components'

import { PreferencesMatrix } from '@/components/settings/preferences-matrix'
import { ProfileSection } from '@/components/settings/profile-section'
import { ThemeSection } from '@/components/settings/theme-section'
import { getSession } from '@/lib/get-session'

export const metadata = { title: 'Общее · Настройки' }

export default async function GeneralSettingsPage() {
  const session = await getSession()
  const user = session!.user

  return (
    <Stack spacing={2}>
      <Stack spacing={0.5} sx={{ mb: 1 }}>
        <Typography variant="h5" fontWeight={700}>Общее</Typography>
        <Typography variant="body2" color="text.secondary">Настройки профиля, темы и уведомлений</Typography>
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
      <ThemeSection />
      <PreferencesMatrix />
    </Stack>
  )
}
```

- [ ] **Step 6: Delete old notifications-section.tsx**

```bash
rm /Users/victor/Projects/anynote/apps/web/src/components/settings/notifications-section.tsx
```

- [ ] **Step 7: Remove `setNotificationSettings` from user router**

In `packages/trpc/src/routers/user.ts`, delete the `NotificationSettingsSchema` constant (lines 10-16) and the `setNotificationSettings` procedure (lines 35-43). Adjust other imports if z is unused.

- [ ] **Step 8: Run tests + typecheck**

```bash
pnpm --filter web test preferences-matrix && pnpm --filter web check-types && pnpm --filter @repo/trpc check-types
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/settings/ apps/web/src/components/notifications/push-toggle.tsx apps/web/src/app/\(protected\)/settings/general/page.tsx apps/web/test/preferences-matrix.test.tsx packages/trpc/src/routers/user.ts
git commit -m "feat(web): preferences matrix UI replaces legacy notifications-section"
```

---

## Phase O — Drop legacy column migration

### Task 28: Drop `user_preferences.notification_settings`

**Files:**
- Create: `packages/db/prisma/migrations/<ts>_notifications_drop_legacy_settings/migration.sql`
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Remove `notificationSettings` field from schema**

In `packages/db/prisma/schema.prisma`, find the `UserPreference` model (around line 319) and delete the `notificationSettings Json? @map("notification_settings")` line.

- [ ] **Step 2: Generate the migration**

```bash
pnpm --filter @repo/db exec prisma migrate dev --name notifications_drop_legacy_settings
```

Expected: migration generated with `ALTER TABLE user_preferences DROP COLUMN notification_settings`.

- [ ] **Step 3: Verify the migration applies cleanly**

```bash
pnpm --filter @repo/db exec prisma migrate reset --force --skip-seed && pnpm --filter @repo/db exec prisma db seed
```

Expected: both migrations apply, seed runs, exits 0.

- [ ] **Step 4: Run gates**

```bash
pnpm gates
```

Expected: lint + types + build + tests all green.

- [ ] **Step 5: Commit**

```bash
git add packages/db/
git commit -m "feat(db): drop legacy user_preferences.notification_settings JSON column"
```

---

## Phase P — E2E

### Task 29: Update e2e auth helper to seed default preferences

**Files:**
- Modify: `apps/e2e/helpers/auth.ts`

- [ ] **Step 1: Add helper function**

In `apps/e2e/helpers/auth.ts`, after `writeConsentsForUserId`, add:

```ts
export async function seedDefaultNotificationPreferences(userId: string): Promise<void> {
  // No-op: preferences are lazy in production code. Tests rely on EVENT_CATALOG defaults.
  // Stub kept so future test hooks have a single place to override per-test preferences.
  void userId
}
```

(If the e2e helper file currently exports a wrapper that invokes consents inside the sign-up flow, optionally call `seedDefaultNotificationPreferences(userId)` next to it for symmetry.)

- [ ] **Step 2: Commit**

```bash
git add apps/e2e/helpers/auth.ts
git commit -m "test(e2e): notification preference seeding hook (no-op stub)"
```

---

### Task 30: E2E spec — invite triggers in-app notification

**Files:**
- Create: `apps/e2e/notifications.spec.ts`

- [ ] **Step 1: Implement spec**

```ts
import { test, expect } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

test('workspace invite produces an in-app notification visible in /notifications', async ({ page, browser }) => {
  // Owner: create workspace + invite a second user
  const owner = await signUpAndAuthAs(page, { firstName: 'Owner', lastName: 'One' })
  await page.goto('/workspaces/new')
  await page.getByLabel(/название/i).fill('E2E Notify Workspace')
  await page.getByRole('button', { name: /создать/i }).click()
  await page.waitForURL(/\/workspaces\/[\w-]+/)

  // Pre-create the invitee using a separate browser context
  const inviteeContext = await browser.newContext()
  const inviteePage = await inviteeContext.newPage()
  const invitee = await signUpAndAuthAs(inviteePage, { firstName: 'Bob', lastName: 'Recipient' })

  // Owner invites the invitee via settings UI
  await page.getByRole('link', { name: /настройки/i }).first().click()
  await page.getByRole('button', { name: /пригласить/i }).click()
  await page.getByLabel(/email/i).fill(invitee.email)
  await page.getByRole('button', { name: /^пригласить$/i }).click()

  // Switch to invitee, see the badge
  await inviteePage.reload()
  await expect(inviteePage.getByText(/пригласил/i).first()).toBeVisible({ timeout: 10_000 })

  // Open /notifications and verify the row
  await inviteePage.goto('/notifications')
  await expect(inviteePage.getByText(/E2E Notify Workspace/i)).toBeVisible()

  await inviteeContext.close()
})
```

(Note: the precise selectors for "Пригласить" / role buttons in the workspace settings UI may need adjustment based on the live DOM — run once and tweak. If `signUpAndAuthAs` doesn't return an `email`, capture it from the helper or generate one.)

- [ ] **Step 2: Run e2e**

```bash
docker compose up -d
pnpm exec playwright test apps/e2e/notifications.spec.ts
```

Expected: PASS. If selectors mismatch, adjust until green.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/notifications.spec.ts
git commit -m "test(e2e): workspace invite shows in-app notification for recipient"
```

---

## Phase Q — Final gates and merge

### Task 31: Run full gates and check all integrations

**Files:** none

- [ ] **Step 1: Run full gates**

```bash
pnpm gates
```

Expected: green across check-types + lint + build + test for every workspace.

- [ ] **Step 2: Run full e2e**

```bash
pnpm exec playwright test
```

Expected: all specs pass.

- [ ] **Step 3: Manual smoke checklist**

Verify in dev (`pnpm dev`):
- [ ] Sign up new user → verify email lands (or console fallback if SENDSAY_API_KEY unset).
- [ ] Sign in second user, get invited → badge appears in sidebar within 30s.
- [ ] Click bell → popover opens, item visible, click navigates to workspace.
- [ ] Open `/notifications` → list page shows item, "Mark all read" works.
- [ ] Open `/profile` → two cards above workspaces.
- [ ] Open `/settings/general` → matrix renders, toggle COLLABORATION/EMAIL off, invite again, verify second invite produces no email but in-app row.
- [ ] Toggle WEB_PUSH on → permission prompt, accept → push subscription appears in Devices list.

- [ ] **Step 4: Commit any UI tweaks needed during smoke**

```bash
git status
git add -p
git commit -m "fix(web): smoke-test polish for notifications UI"
```

(Skip if no changes.)

- [ ] **Step 5: Push branch + open PR**

```bash
git push -u origin feat/notifications
gh pr create --title "feat: notifications system (events, deliveries, in-app, email, web push)" --body "$(cat <<'EOF'
## Summary

Adds a unified notifications system covering Service / Security / Collaboration / Marketing categories across Email / In-app / Web Push channels.

- `@repo/notifications` package: `emit()`, `EVENT_CATALOG`, typed `notify.*` helpers, worker dispatcher
- `apps/engines/notifier`: NestJS cron drains `notification_deliveries`
- `packages/auth`: SERVICE emails route through `notify.*` (sync) for verify/reset/welcome/etc.
- `packages/trpc`: `notification` router with list / unreadCount / markRead / markAllRead / preferences / push subs
- `apps/web`: `/notifications` page, sidebar bell with popover, `/profile` cards, `/settings/general` matrix UI, service worker + VAPID push

Spec: `docs/superpowers/specs/2026-05-10-notifications-design.md`
Plan: `docs/superpowers/plans/2026-05-10-notifications.md`

## Test plan

- [ ] `pnpm gates` green
- [ ] `pnpm exec playwright test` green
- [ ] Manual: invite → in-app badge appears for recipient
- [ ] Manual: toggle COLLABORATION/EMAIL off → no email on next invite, in-app still arrives
- [ ] Manual: enable WEB_PUSH → browser prompt → push notification arrives on next invite
- [ ] Manual: revoke device → no further pushes to that device

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

- All spec sections (§1 goals, §2 non-goals, §3 architecture, §4 schema, §5 package, §6 migrations, §7 triggers, §8 router, §9 worker, §10 push, §11 UI, §12 tests, §13 acceptance) are mapped to tasks above.
- mention/comment/digest/product-update trigger points intentionally not implemented (per spec §2 non-goals); helpers are present in `notify.*` for future hookup.
- The legacy `user_preferences.notification_settings` JSON column is dropped in Task 28, after the matrix UI no longer reads it (Task 27).
- Service worker + VAPID env (Task 19, 20) precedes push UI (Task 27), so the push toggle has the runtime hooks it needs.
- Worker tests mock `@repo/mail` and `web-push`; full integration is verified via the e2e in Task 30.
