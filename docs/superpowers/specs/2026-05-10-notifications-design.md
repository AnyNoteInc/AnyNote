# Notifications System — Design Spec

**Date:** 2026-05-10
**Status:** Approved for planning
**Owner:** Anynote core

## 1. Goal

Build a unified notification system covering:

- **Service** — transactional auth (verify-email, reset-password, password-changed, email-changed, welcome, account-deletion-\*).
- **Security** — new-login, suspicious-activity.
- **Collaboration** — workspace-invite, role-changed (in v1); page-mention, comment-created (helpers reserved, no trigger points).
- **Marketing/Digest** — weekly-digest, product-update (helpers reserved, no trigger points). Gated by `MARKETING` user consent.

Each event delivered through a configurable matrix of channels: **Email** (Sendsay), **In-app** (notification center), **Web Push** (VAPID + Web Push Protocol).

User controls preferences in `/settings/general` as a category × channel matrix.

## 2. Non-goals (explicit)

- No mention/comment trigger points — features don't exist yet; helpers exist as stubs to ease future hookup.
- No weekly-digest cron — only enum + helper stub.
- No batching/throttling (e.g. "max 1 email/hour during comment storms").
- No email open tracking through Sendsay.
- No mobile push (APNs/FCM); web push only.
- No notification grouping ("3 new comments from Anna" → 3 separate rows).
- No cleanup cron for read in-app notifications (unlimited retention chosen).
- No staged rollout of legacy `userPreference.notificationSettings` removal — backfill and column drop happen in the same migration with the deploy.

## 3. Architecture

```
                   ┌─────────────────────────────────────────────┐
                   │  apps/web (RSC + tRPC)                      │
                   │                                             │
trigger ───────────┼─▶ notify.<eventType>(prisma, args)          │
(auth, invite,     │                                             │
 role change,      │  prisma.$transaction:                       │
 etc.)             │   1. INSERT notification_events             │
                   │   2. INSERT notification_in_app             │
                   │      (only if IN_APP in defaultChannels)    │
                   │   3. resolve preferences for recipient      │
                   │   4. INSERT notification_deliveries         │
                   │      for EMAIL/WEB_PUSH only when opted-in  │
                   │                                             │
                   │  SERVICE category exception:                │
                   │   sendMailNow() called synchronously inside │
                   │   the same transaction for UX (no worker    │
                   │   delay). No EMAIL delivery row created.    │
                   │                                             │
                   │  tRPC: notification.list / unreadCount /    │
                   │        markRead / markAllRead / preferences │
                   │        / push subscription CRUD             │
                   └─────────────────────────────────────────────┘
                                       │
                                       │ shared Postgres
                                       ▼
                   ┌─────────────────────────────────────────────┐
                   │  apps/engines/src/apps/notifier  (NestJS)   │
                   │                                             │
                   │  @Cron */5s → SELECT FOR UPDATE SKIP LOCKED │
                   │   notification_deliveries                   │
                   │   WHERE status='PENDING'                    │
                   │     AND next_attempt_at <= now()            │
                   │   LIMIT NOTIFIER_BATCH_SIZE                 │
                   │                                             │
                   │  per row → channel router:                  │
                   │    EMAIL    → @repo/mail.sendMailNow        │
                   │    WEB_PUSH → web-push.sendNotification     │
                   │                                             │
                   │  on success: status=DELIVERED               │
                   │  on failure: attempts++,                    │
                   │              backoff = min(60s·2^a, 30min), │
                   │              status=FAILED after 5 attempts │
                   │                                             │
                   │  HTTP 410/404 from push endpoint            │
                   │   → DELETE push_subscriptions row           │
                   └─────────────────────────────────────────────┘
```

### Delivery semantics

- **In-app**: synchronous, written in the same transaction as the event. Badge and list reflect immediately.
- **Email/Push**: asynchronous via `notification_deliveries` rows. External API failures don't block the user-facing mutation. Worker retries with exponential backoff.
- **Service email** (verify/reset/etc.): synchronous via `sendMailNow` in the trigger transaction so password-reset UX stays instant. The event row is still written for audit; no EMAIL delivery row is created (worker doesn't double-send).

## 4. Database schema

All tables are snake_case, IDs are UUID v7 via `dbgenerated("gen_random_uuid()")` (consistent with existing schema).

### 4.1 Enums

```prisma
enum NotificationCategory {
  SERVICE        // verify-email, reset-password, password-changed, email-changed,
                 // welcome, account-deletion-*
  SECURITY       // new-login, suspicious-activity
  COLLABORATION  // workspace-invite, role-changed [+ stubs: page-mention, comment-created]
  MARKETING      // weekly-digest, product-update [requires MARKETING consent]
}

enum NotificationEventType {
  // SERVICE
  VERIFY_EMAIL
  RESET_PASSWORD
  PASSWORD_CHANGED
  EMAIL_CHANGED
  WELCOME
  ACCOUNT_DELETION_REQUESTED
  ACCOUNT_DELETION_COMPLETED
  // SECURITY
  NEW_LOGIN
  SUSPICIOUS_ACTIVITY
  // COLLABORATION
  WORKSPACE_INVITE
  ROLE_CHANGED
  PAGE_MENTION              // reserved, no trigger point in v1
  COMMENT_CREATED           // reserved, no trigger point in v1
  // MARKETING
  WEEKLY_DIGEST             // reserved, no trigger point in v1
  PRODUCT_UPDATE            // reserved, no trigger point in v1
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
  SKIPPED   // preference toggled off after row created (race) or consent revoked
}
```

### 4.2 Tables

```prisma
model NotificationEvent {
  id          String                @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  type        NotificationEventType
  category    NotificationCategory
  userId      String                @map("user_id") @db.Uuid           // recipient
  workspaceId String?               @map("workspace_id") @db.Uuid
  actorId     String?               @map("actor_id") @db.Uuid          // who caused it
  resourceUrl String?               @map("resource_url") @db.Text      // navigation target on click
  payload     Json                  @default("{}")                     // template-specific data
  createdAt   DateTime              @default(now()) @map("created_at") @db.Timestamptz(6)

  user      User                   @relation(fields: [userId], references: [id], onDelete: Cascade)
  workspace Workspace?             @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  inApp     NotificationInApp?
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
  user  User              @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt(sort: Desc)])     // list page hot path
  @@index([userId, readAt])                    // unread count hot path
  @@map("notification_in_app")
}

model NotificationDelivery {
  id            String              @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  eventId       String              @map("event_id") @db.Uuid
  userId        String              @map("user_id") @db.Uuid
  channel       NotificationChannel
  status        DeliveryStatus      @default(PENDING)
  attempts      Int                 @default(0)
  nextAttemptAt DateTime            @default(now()) @map("next_attempt_at") @db.Timestamptz(6)
  lockedAt      DateTime?           @map("locked_at") @db.Timestamptz(6)
  lockedBy      String?             @map("locked_by") @db.VarChar(64)
  targetEmail            String? @map("target_email") @db.VarChar(255)
  targetSubscriptionId   String? @map("target_subscription_id") @db.Uuid
  processedAt   DateTime? @map("processed_at") @db.Timestamptz(6)
  lastError     String?   @map("last_error") @db.Text
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  event              NotificationEvent  @relation(fields: [eventId], references: [id], onDelete: Cascade)
  user               User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  targetSubscription PushSubscription?  @relation(fields: [targetSubscriptionId], references: [id], onDelete: SetNull)

  @@index([status, nextAttemptAt])               // worker queue scan
  @@index([eventId])
  // Idempotency is enforced via two partial unique indexes added in the
  // migration (see §6.1) — one for EMAIL (event_id, user_id) and one for
  // WEB_PUSH (event_id, user_id, target_subscription_id). A plain @@unique
  // including target_subscription_id wouldn't work because Postgres treats
  // NULLs as distinct, so two EMAIL deliveries with NULL target_subscription_id
  // would both be allowed.
  @@map("notification_deliveries")
}

model NotificationPreference {
  id        String                @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId    String                @map("user_id") @db.Uuid
  category  NotificationCategory
  channel   NotificationChannel
  enabled   Boolean               @default(true)
  updatedAt DateTime              @updatedAt @map("updated_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

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

  user        User                   @relation(fields: [userId], references: [id], onDelete: Cascade)
  deliveries  NotificationDelivery[]

  @@index([userId])
  @@map("push_subscriptions")
}
```

### 4.3 Design rationale

1. **Event vs Delivery — two tables.** Event = immutable fact ("X happened"). Delivery = mutable attempt ("deliver X via channel Y"). One event spawns 0..3 deliveries (in-app + email + push), each retried independently.
2. **In-app in its own table, not as `delivery channel=IN_APP`.** Hot-path queries (badge, list, markAllRead) use a different access pattern (per-user-time-sorted) than worker queue (status-time-sorted). Separate narrow table → compact indexes, no JOIN on event for unread count.
3. **Preferences relational, not JSON.** Old `userPreference.notificationSettings: Json` is dropped. Benefits: SQL filtering during preference resolve, migration-friendly when adding categories/channels, partial unique constraint guards against duplicates.
4. **MARKETING gate.** Worker checks `user_consents` before sending EMAIL for `category=MARKETING`. If most-recent MARKETING consent row has `accepted=false`, delivery is marked SKIPPED. This is defense-in-depth in addition to preference toggle (handles the race where consent is revoked between emit and delivery).
5. **`SKIPPED` status.** When preference is off at emit time, `emit()` doesn't create the delivery row (storage win). The status exists for cases where preference flips between emit and worker pickup.
6. **Outbox semantics built into `notification_deliveries`.** Existing `outbox_events` table has a different contract (aggregateType+aggregateId+payload, used by indexer); mixing is dangerous. We re-use the worker pattern (cron + SKIP LOCKED + backoff), not the table.
7. **Cascade deletes.** `User` deletion cascades through events, in_app, deliveries, push_subscriptions. GDPR-friendly.
8. **`UserPreference.notificationSettings` Json column is removed.** Migration includes inline backfill (see §6.2).

## 5. `packages/notifications` package

```
packages/notifications/
├── package.json                         # name: @repo/notifications, exports: ./src/index.ts
├── src/
│   ├── index.ts                         # public re-exports
│   ├── catalog.ts                       # EVENT_CATALOG — single source of truth
│   ├── emit.ts                          # core emit() — write event + in_app + deliveries
│   ├── helpers.ts                       # typed notify.<eventType>() wrappers
│   ├── resolve-preferences.ts           # which channels for (user × category)
│   ├── templates/
│   │   ├── registry.ts                  # type → { email?, inApp, push? } resolver
│   │   ├── verify-email.ts              # per-event template (filename = eventType)
│   │   ├── workspace-invite.ts
│   │   ├── new-login.ts
│   │   └── ...
│   ├── worker/
│   │   ├── dispatcher.ts                # locks N PENDING, routes to channel
│   │   ├── send-email.ts                # @repo/mail.sendMailNow + retry calc
│   │   ├── send-web-push.ts             # web-push package + 410 cleanup
│   │   └── lock.ts                      # SELECT FOR UPDATE SKIP LOCKED helper
│   └── types.ts
└── test/
    ├── emit.test.ts
    ├── resolve-preferences.test.ts
    ├── catalog.test.ts                  # asserts every EventType has a descriptor
    └── worker/
        ├── dispatcher.test.ts
        ├── send-email.test.ts
        └── send-web-push.test.ts
```

### 5.1 `EVENT_CATALOG`

Single source of truth — Preferences UI, worker, and tests all read from it.

```ts
type EventDescriptor = {
  category: NotificationCategory
  defaultChannels: NotificationChannel[] // delivered to (if user hasn't disabled)
  lockedChannels: NotificationChannel[] // user CAN'T disable
  requiresConsent: 'MARKETING' | null // gate before delivery
}

export const EVENT_CATALOG = {
  // SERVICE
  VERIFY_EMAIL: {
    category: 'SERVICE',
    defaultChannels: ['EMAIL'],
    lockedChannels: ['EMAIL'],
    requiresConsent: null,
  },
  RESET_PASSWORD: {
    category: 'SERVICE',
    defaultChannels: ['EMAIL'],
    lockedChannels: ['EMAIL'],
    requiresConsent: null,
  },
  PASSWORD_CHANGED: {
    category: 'SERVICE',
    defaultChannels: ['EMAIL'],
    lockedChannels: ['EMAIL'],
    requiresConsent: null,
  },
  EMAIL_CHANGED: {
    category: 'SERVICE',
    defaultChannels: ['EMAIL'],
    lockedChannels: ['EMAIL'],
    requiresConsent: null,
  },
  WELCOME: {
    category: 'SERVICE',
    defaultChannels: ['EMAIL'],
    lockedChannels: ['EMAIL'],
    requiresConsent: null,
  },
  ACCOUNT_DELETION_REQUESTED: {
    category: 'SERVICE',
    defaultChannels: ['EMAIL'],
    lockedChannels: ['EMAIL'],
    requiresConsent: null,
  },
  ACCOUNT_DELETION_COMPLETED: {
    category: 'SERVICE',
    defaultChannels: ['EMAIL'],
    lockedChannels: ['EMAIL'],
    requiresConsent: null,
  },
  // SECURITY
  NEW_LOGIN: {
    category: 'SECURITY',
    defaultChannels: ['EMAIL', 'IN_APP'],
    lockedChannels: ['IN_APP'],
    requiresConsent: null,
  },
  SUSPICIOUS_ACTIVITY: {
    category: 'SECURITY',
    defaultChannels: ['EMAIL', 'IN_APP'],
    lockedChannels: ['IN_APP'],
    requiresConsent: null,
  },
  // COLLABORATION
  WORKSPACE_INVITE: {
    category: 'COLLABORATION',
    defaultChannels: ['EMAIL', 'IN_APP'],
    lockedChannels: ['IN_APP'],
    requiresConsent: null,
  },
  ROLE_CHANGED: {
    category: 'COLLABORATION',
    defaultChannels: ['IN_APP'],
    lockedChannels: ['IN_APP'],
    requiresConsent: null,
  },
  PAGE_MENTION: {
    category: 'COLLABORATION',
    defaultChannels: ['EMAIL', 'IN_APP'],
    lockedChannels: ['IN_APP'],
    requiresConsent: null,
  },
  COMMENT_CREATED: {
    category: 'COLLABORATION',
    defaultChannels: ['EMAIL', 'IN_APP'],
    lockedChannels: ['IN_APP'],
    requiresConsent: null,
  },
  // MARKETING
  WEEKLY_DIGEST: {
    category: 'MARKETING',
    defaultChannels: ['EMAIL'],
    lockedChannels: [],
    requiresConsent: 'MARKETING',
  },
  PRODUCT_UPDATE: {
    category: 'MARKETING',
    defaultChannels: ['EMAIL'],
    lockedChannels: [],
    requiresConsent: 'MARKETING',
  },
} as const satisfies Record<NotificationEventType, EventDescriptor>
```

### 5.2 `emit()` contract

```ts
emit(prisma: PrismaClient | TransactionClient, args: {
  type: NotificationEventType
  userId: string                       // recipient
  workspaceId?: string
  actorId?: string
  resourceUrl?: string                 // where in-app click navigates
  payload: Record<string, unknown>     // typed per-event in helpers
}): Promise<NotificationEvent>
```

Behavior inside the transaction:

1. `INSERT notification_events` (category derived from catalog).
2. If `IN_APP` is in `defaultChannels` or `lockedChannels`: `INSERT notification_in_app`.
3. Resolve preferences for `userId` × catalog row.
4. For each enabled non-IN_APP channel: `INSERT notification_deliveries`.
5. **SERVICE exception**: if `category === 'SERVICE'`, skip step 4 and instead call `sendMailNow()` synchronously after the transaction commits (still in the same request).
6. Return the event row.

### 5.3 Typed helpers

```ts
export const notify = {
  verifyEmail: (prisma, args: { userId; email; verifyUrl; firstName }) => emit(...),
  resetPassword: (prisma, args: { userId; resetUrl; firstName }) => emit(...),
  passwordChanged: (prisma, args: { userId; ipAddress?; firstName }) => emit(...),
  emailChanged: (prisma, args: { userId; oldEmail; newEmail; firstName }) => emit(...),
  welcome: (prisma, args: { userId; firstName }) => emit(...),
  accountDeletionRequested: (prisma, args: { userId; cancelUrl; firstName }) => emit(...),
  accountDeletionCompleted: (prisma, args: { userId; firstName; email }) => emit(...),
  newLogin: (prisma, args: { userId; ipAddress?; userAgent?; location?; firstName }) => emit(...),
  suspiciousActivity: (prisma, args: { userId; ipAddress?; userAgent?; firstName }) => emit(...),
  workspaceInvite: (prisma, args: { userId; workspaceId; actorId; inviteToken; workspaceName; firstName }) => emit(...),
  roleChanged: (prisma, args: { userId; workspaceId; actorId; newRole; firstName; workspaceName }) => emit(...),
  // Reserved stubs (no trigger points wired)
  pageMention: (prisma, args: { userId; workspaceId; pageId; actorId; snippet }) => emit(...),
  commentCreated: (prisma, args: { userId; workspaceId; pageId; actorId; commentId; snippet }) => emit(...),
  weeklyDigest: (prisma, args: { userId; period; summary }) => emit(...),
  productUpdate: (prisma, args: { userId; title; body; url? }) => emit(...),
}
```

### 5.4 `resolve-preferences.ts`

```ts
async function resolvePreferences(
  tx: TransactionClient,
  userId: string,
  descriptor: EventDescriptor,
): Promise<{ email: string | null; pushSubscriptions: PushSubscription[] }>
```

Logic:

- For each non-IN_APP channel in `descriptor.defaultChannels`:
  - Read `notification_preferences` for `(userId, descriptor.category, channel)`. If row exists with `enabled=false` AND channel is not in `descriptor.lockedChannels`, skip.
  - For `EMAIL` + `requiresConsent='MARKETING'`: read latest `user_consents` row for `(userId, MARKETING)`. If `accepted=false`, skip.
  - For `EMAIL`: also skip if user has no verified email (defensive).
- Returns target email (user.email if EMAIL passes) and list of `push_subscriptions` rows for the user (for fan-out to multiple devices).

## 6. Migrations

### 6.1 Schema migration

`packages/db/prisma/migrations/<timestamp>_notifications_v1/migration.sql`:

- Generated by `prisma migrate dev`: 5 new tables, 4 enums, FKs and indexes per §4.
- **Manual amendment after generation**: add two partial unique indexes for delivery idempotency. Plain `UNIQUE` including `target_subscription_id` is insufficient because Postgres treats NULLs as distinct, so two EMAIL deliveries (both with NULL `target_subscription_id`) for the same event×user would not collide. Partial indexes work on any Postgres ≥9.0:

  ```sql
  CREATE UNIQUE INDEX notification_deliveries_email_idem
    ON notification_deliveries (event_id, user_id)
    WHERE channel = 'EMAIL';

  CREATE UNIQUE INDEX notification_deliveries_push_idem
    ON notification_deliveries (event_id, user_id, target_subscription_id)
    WHERE channel = 'WEB_PUSH';
  ```

### 6.2 Inline backfill (in the same migration.sql)

```sql
-- Backfill notification_preferences from old userPreference.notificationSettings JSON.
-- Old shape: { email: { mentions: bool, comments: bool, weeklyDigest: bool } }
-- Mapping: mentions/comments → COLLABORATION/EMAIL; weeklyDigest → MARKETING/EMAIL.

INSERT INTO notification_preferences (id, user_id, category, channel, enabled, updated_at)
SELECT
  gen_random_uuid(),
  user_id,
  'COLLABORATION'::"NotificationCategory",
  'EMAIL'::"NotificationChannel",
  COALESCE(
    (notification_settings -> 'email' ->> 'mentions')::boolean,
    true
  ) AND COALESCE(
    (notification_settings -> 'email' ->> 'comments')::boolean,
    true
  ),
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

-- Drop legacy column
ALTER TABLE user_preferences DROP COLUMN notification_settings;
```

### 6.3 Schema field removal

`packages/db/prisma/schema.prisma` — remove `notificationSettings Json?` from `UserPreference`. Add `notifications NotificationInApp[]`, `notificationEvents NotificationEvent[]`, `notificationDeliveries NotificationDelivery[]`, `notificationPreferences NotificationPreference[]`, `pushSubscriptions PushSubscription[]` to `User`. Add `notificationEvents NotificationEvent[]` to `Workspace`.

## 7. Trigger points (where `notify.*` is called)

| Event                                                                | Where                                                                      | Notes                                                                       |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `VERIFY_EMAIL`                                                       | `packages/auth/src/auth.ts:sendVerificationEmail`                          | Replace direct `sendMailNow` call. SERVICE → synchronous email + event row. |
| `RESET_PASSWORD`                                                     | `packages/auth/src/auth.ts:sendResetPassword`                              | Same.                                                                       |
| `PASSWORD_CHANGED`                                                   | `packages/auth/src/auth.ts:onPasswordReset` (better-auth hook)             | Same.                                                                       |
| `EMAIL_CHANGED`                                                      | `packages/auth/src/auth.ts` (after change-email confirm hook)              | Same.                                                                       |
| `WELCOME`                                                            | `packages/auth/src/auth.ts:afterEmailVerification`                         | Same.                                                                       |
| `ACCOUNT_DELETION_REQUESTED` / `_COMPLETED`                          | wherever current calls live (search via grep)                              | Same.                                                                       |
| `NEW_LOGIN`                                                          | `packages/auth/src/auth.ts` better-auth `signIn.after` hook (new)          | Async via worker.                                                           |
| `SUSPICIOUS_ACTIVITY`                                                | trigger location TBD by future code (placeholder helper exists)            | Async.                                                                      |
| `WORKSPACE_INVITE`                                                   | `packages/trpc/src/routers/workspace.ts:144 inviteMember`                  | Replace direct invitation `sendMailNow`. Async via worker.                  |
| `ROLE_CHANGED`                                                       | `packages/trpc/src/routers/workspace.ts:updateMemberRole` (add if missing) | IN_APP only by default.                                                     |
| `PAGE_MENTION`, `COMMENT_CREATED`, `WEEKLY_DIGEST`, `PRODUCT_UPDATE` | helper exists, no caller                                                   | Stubs for future.                                                           |

`packages/auth/src/auth.ts` imports the `prisma` singleton from `@repo/db` (already imported there) — no signature changes to better-auth callbacks needed.

## 8. tRPC router (`packages/trpc/src/routers/notification.ts`)

Registered in `appRouter` as `notification: notificationRouter`.

```ts
notification: router({
  list: protectedProcedure
    .input(z.object({
      cursor: z.object({ createdAt: z.date(), id: z.string().uuid() }).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }))
    .query(...),

  unreadCount: protectedProcedure.query(...),

  markRead: protectedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }))
    .mutation(...),

  markAllRead: protectedProcedure.mutation(...),

  getPreferences: protectedProcedure.query(...),
    // Returns full matrix Record<Category, Record<Channel, { enabled, locked }>>
    // built from EVENT_CATALOG + DB overrides; locked cells flagged.

  setPreference: protectedProcedure
    .input(z.object({
      category: z.nativeEnum(NotificationCategory),
      channel: z.nativeEnum(NotificationChannel),
      enabled: z.boolean(),
    }))
    .mutation(...),
    // Throws BAD_REQUEST if channel is locked for category.
    // Throws FORBIDDEN if category=MARKETING && channel=EMAIL && no MARKETING consent.
    // Upserts notification_preferences.

  listPushSubscriptions: protectedProcedure.query(...),

  registerPushSubscription: protectedProcedure
    .input(z.object({
      endpoint: z.string().url(),
      keys: z.object({ p256dh: z.string(), auth: z.string() }),
      userAgent: z.string().optional(),
    }))
    .mutation(...),  // Upsert by endpoint (user can re-subscribe)

  revokePushSubscription: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(...),
}),
```

`emit()` is **not** exposed via tRPC — server-only API consumed inside other procedures and auth callbacks.

## 9. Worker (`apps/engines/src/apps/notifier/`)

```
apps/engines/src/apps/notifier/
├── notifier.module.ts            # NestJS module
├── notifier.service.ts           # @Cron, dispatcher
└── notifier.module.spec.ts
```

Wired in `apps/engines/src/main.ts` next to `IndexerModule`. Uses `@repo/notifications/worker/dispatcher`.

Env vars (added to `.env.example` and `turbo.json` `globalEnv`):

- `NOTIFIER_CRON_EXPRESSION` (default `*/5 * * * * *`)
- `NOTIFIER_BATCH_SIZE` (default `50`)
- `NOTIFIER_MAX_ATTEMPTS` (default `5`)

Backoff: `next_attempt_at = now() + min(60s · 2^attempts, 30 min)`. After `NOTIFIER_MAX_ATTEMPTS`, status flips to `FAILED`.

Push HTTP `410 Gone` or `404 Not Found` from endpoint → delete corresponding `push_subscriptions` row, mark delivery `FAILED` (terminal).

## 10. Web Push infrastructure

### 10.1 Service worker

`apps/web/public/sw.js`:

```js
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      data: { url: data.url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(clients.openWindow(event.notification.data.url || '/notifications'))
})
```

### 10.2 Client registration

- `apps/web/src/lib/push/register-sw.ts` — `'use client'` helper that registers `/sw.js`, calls `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })`, and posts the subscription to `notification.registerPushSubscription`.
- `apps/web/src/lib/push/vapid.ts` — exposes `NEXT_PUBLIC_VAPID_PUBLIC_KEY` to the client.
- `apps/web/src/components/notifications/push-toggle.tsx` — single component used inside `/settings/general` matrix that drives the permission prompt + first-subscribe flow.

### 10.3 Env vars

- `VAPID_PUBLIC_KEY` (server) + `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (client mirror)
- `VAPID_PRIVATE_KEY` (server only, used by worker)
- `VAPID_SUBJECT` (e.g. `mailto:noreply@anynote.dev`)

Generation: `npx web-push generate-vapid-keys`. Documented in `.env.example` comment.

## 11. UI

### 11.1 `/notifications` page

Files:

```
apps/web/src/app/(protected)/notifications/page.tsx        # RSC, Container maxWidth="md"
apps/web/src/components/notifications/
  ├── notifications-list.tsx                               # 'use client', infinite scroll
  ├── notification-row.tsx                                 # icon + title + actor + time + unread dot
  ├── notification-header.tsx                              # title + "Mark all read"
  └── format-notification.tsx                              # type → { icon, title, body }
```

Behavior:

- RSC renders first page via `getServerTRPC().notification.list({ limit: 20 })`.
- Client uses `useInfiniteQuery` with cursor `{ createdAt, id }`.
- "Mark all read" button → `notification.markAllRead.useMutation()`, invalidates list and badge.
- Row click: `notification.markRead.useMutation({ ids: [id] })` then `router.push(event.resourceUrl)` if URL present.
- Empty state: icon + "Здесь будут ваши уведомления".

### 11.2 Sidebar trigger in `workspace-sidebar.tsx`

Inserted between the trash block and `userMenu`:

```
Workspace switcher
Search/Chats/Settings
Favorites/Pages
       …
   flex spacer
─────────────────
🗑 Корзина
─────────────────
🔔 Уведомления (3)    ← NEW
─────────────────
{userMenu}
```

File: `apps/web/src/components/notifications/sidebar-notifications-trigger.tsx`.

- Button with `NotificationsIcon` + `<Badge badgeContent={unread} max={99} color="error">`.
- Badge data: `trpc.notification.unreadCount.useQuery({ refetchInterval: 30_000 })`.
- Click opens MUI `<Popover>` anchored to icon, content = `<NotificationsPopoverCard>`:
  - Header "Уведомления" + chip-link "Все →" navigating to `/notifications`.
  - Last 20 via `notification.list({ limit: 20 })`.
  - Infinite scroll inside popover (fixed height ~480px).
  - **"Loaded = read" behavior**: `IntersectionObserver` collects unread row IDs as they enter viewport; debounced `markRead({ ids })` decrements the badge.
  - Width ~360px on desktop; on mobile, opens as full-screen `<Drawer>`.

### 11.3 `/profile` cards

`apps/web/src/app/(protected)/profile/page.tsx` change:

- Container width grows to `maxWidth="md"`.
- Above the "Рабочие пространства" block, add a `Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}` of two cards:
  - `⚙ Настройки` → `/settings`
  - `🔔 Уведомления` → `/notifications`
- Each card = `Paper variant="outlined"` with icon + label, hover state, wrapped in `<Link>` (not `component={Link}` — RSC boundary rule from CLAUDE.md).

```
       [ Avatar ]
        Имя Фамилия
        email@...

   ┌───────────────┐  ┌──────────────────┐
   │  ⚙ Настройки  │  │ 🔔 Уведомления   │
   │  → /settings   │  │ → /notifications │
   └───────────────┘  └──────────────────┘

   РАБОЧИЕ ПРОСТРАНСТВА            [+]
   ...
```

### 11.4 `/settings/general` notifications section (rewrite)

Replace `apps/web/src/components/settings/notifications-section.tsx` with a tabular layout:

```
┌─ Уведомления ────────────────────────────────────────────────┐
│ Когда присылать email, in-app и web push                     │
│                                                              │
│                       Email      In-app     Web push         │
│ Безопасность           ☑ locked   ☑ locked   [☐ Включить]    │
│ Совместная работа      ☑          ☑ locked   ☐               │
│ Маркетинг и дайджест   ☐ ⓘ        —          —               │
│                        (требует согласия на маркетинг)       │
│                                                              │
│ ─── Устройства для push ─────────────────────────────────── │
│ • Chrome (Mac)        добавлено вчера         [ Отозвать ]  │
│ • iPhone Safari       добавлено 5 дней назад  [ Отозвать ]  │
└──────────────────────────────────────────────────────────────┘
```

- Rows = `SECURITY`, `COLLABORATION`, `MARKETING`. Columns = `EMAIL`, `IN_APP`, `WEB_PUSH`.
- `SERVICE` row is **hidden** (always email, can't be turned off).
- Locked cells: checkmark + tooltip "Это уведомление обязательное". Click is no-op.
- Marketing × Email: disabled until MARKETING consent given; tooltip links to `/settings/consents`.
- Push column: first toggle invokes `requestPermission()` → `pushManager.subscribe()` → `notification.registerPushSubscription` mutation. Subsequent toggles flip per-category preference.
- "Устройства для push" — list of `pushSubscription` rows below the matrix; "Отозвать" deletes the row (worker emits SKIPPED on next attempt).

Reads `notification.getPreferences` and `notification.listPushSubscriptions`. Writes through `setPreference`, `registerPushSubscription`, `revokePushSubscription`.

## 12. Tests

| Layer                    | Files                                                                                                      | Coverage                                                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/notifications` | `test/emit.test.ts`, `test/resolve-preferences.test.ts`, `test/catalog.test.ts`, `test/worker/*.test.ts`   | emit writes correct rows; resolver respects locked + consent gate; catalog covers every EventType; worker dispatches to correct handler; backoff math; HTTP 410 cleans subscription. |
| `packages/trpc`          | `test/notification.test.ts`                                                                                | each procedure: list pagination, markRead doesn't touch other users' rows, MARKETING without consent → FORBIDDEN, locked channel → BAD_REQUEST.                                      |
| `apps/web`               | `test/notifications-list.test.tsx`, `test/sidebar-trigger.test.tsx`, `test/notifications-section.test.tsx` | infinite scroll, mark-as-read on visibility, badge count, preferences matrix locked-cell behavior.                                                                                   |
| `apps/e2e`               | `apps/e2e/notifications.spec.ts`                                                                           | full flow: invite → recipient sees badge → opens popover → click navigates to workspace and marks read.                                                                              |

`apps/e2e/helpers/auth.ts:writeConsentsForUserId` — also seeds default `notification_preferences` rows for the new user (so e2e specs don't hit empty-state branches unintentionally). Production code path remains lazy: missing row → use catalog default.

## 13. Acceptance criteria

A user can:

- Sign up → receive verify email (existing flow, now also writes `NotificationEvent` row for audit).
- Get invited to a workspace → see in-app badge update within 30s, see notification in `/notifications`, receive email within ~5s if EMAIL preference on.
- Open `/notifications` → see paginated list, scroll to load more, click "Mark all read".
- Click sidebar bell → see popover with last 20, items mark themselves read on viewport, click navigates to resource.
- Open `/settings/general` → see preferences matrix, toggle COLLABORATION/EMAIL off → no email on next invite (in-app still arrives).
- Toggle WEB_PUSH on → browser permission prompt → subscription registered → push notification arrives on next collab event.
- Revoke a push device in settings → no more push to that device.

A developer can:

- Add a new event type by: appending to `NotificationEventType` enum, adding entry to `EVENT_CATALOG`, adding helper in `helpers.ts`, adding template file in `templates/`. No worker or UI code changes needed.

## 14. Open questions / future work (non-blocking)

- **Wire up `mention`/`comment`/`digest` triggers** when those features land.
- **Add a notification preview/test button** in settings to send a sample to the user across all enabled channels.
- **Cleanup cron** for read in-app notifications older than e.g. 90 days, if `notification_in_app` table grows.
- **Notification grouping** ("Анна и ещё 2 пригласили вас…") if volume becomes annoying.
- **APNs/FCM** for native mobile clients.
