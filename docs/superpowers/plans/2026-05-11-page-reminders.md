# Page reminders implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `/reminder` slash command that inserts an inline Tiptap chip with a deadline, preset intermediate offsets, an audience selector (me / whole workspace / list of users), undo support, and notifications fired through the existing notifications/v1 pipeline.

**Architecture:** Reminder state is stored as Tiptap node attrs in the Y.Doc (source of truth) and reconciled to a soft-deletable `Reminder` table via a debounced client-side `syncForPage` mutation. Notifications use a new `REMINDER_DUE` event type under category `COLLABORATION`; per-recipient/per-offset `NotificationDelivery` rows are upserted with `nextAttemptAt = dueAt - offset·60s` and dispatched by the existing notifier cron.

**Tech Stack:** Next.js 16 (apps/web), Tiptap 3 + Y.Doc + Hocuspocus (packages/editor), Prisma 7 + Postgres (packages/db), tRPC v11 (packages/trpc), NestJS cron (apps/engines), MUI v6 + `@mui/x-date-pickers` (packages/ui), better-auth (packages/auth), vitest + playwright.

**Spec:** [docs/superpowers/specs/2026-05-11-page-reminders-design.md](../specs/2026-05-11-page-reminders-design.md)

---

## Task 1: DB schema — Reminder, ReminderRecipient, ReminderAudience, REMINDER_DUE

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_reminders/migration.sql` (generated)

- [ ] **Step 1: Add enum + models to schema.prisma**

Find the `enum NotificationEventType` block (around the notification models, after `enum DeliveryStatus`) and add `REMINDER_DUE` as the last value:

```prisma
enum NotificationEventType {
  // ... existing values ...
  WEEKLY_DIGEST
  PRODUCT_UPDATE
  REMINDER_DUE
}
```

Find the `model User` block. Add three back-relations next to the existing `notification*` lines:

```prisma
model User {
  // ... existing fields and relations ...
  remindersAuthored      Reminder[]            @relation("ReminderAuthor")
  remindersCompleted     Reminder[]            @relation("ReminderDoneBy")
  reminderRecipients     ReminderRecipient[]   @relation("ReminderRecipient")
  // ... rest of User ...
}
```

Find the `model Workspace` block. Add:

```prisma
model Workspace {
  // ... existing fields and relations ...
  reminders Reminder[]
  // ...
}
```

Find the `model Page` block. Add:

```prisma
model Page {
  // ... existing fields and relations ...
  reminders Reminder[]
  // ...
}
```

At the bottom of the file (or in the section with other models), append:

```prisma
enum ReminderAudience {
  ME
  WORKSPACE
  LIST
}

model Reminder {
  id          String           @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  pageId      String           @map("page_id") @db.Uuid
  workspaceId String           @map("workspace_id") @db.Uuid
  createdById String?          @map("created_by_id") @db.Uuid
  label       String?          @db.VarChar(200)
  dueAt       DateTime         @map("due_at") @db.Timestamptz(6)
  offsets     Int[]            @default([])
  audience    ReminderAudience @default(ME)
  doneAt      DateTime?        @map("done_at") @db.Timestamptz(6)
  doneById    String?          @map("done_by_id") @db.Uuid
  deletedAt   DateTime?        @map("deleted_at") @db.Timestamptz(6)
  createdAt   DateTime         @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime         @updatedAt @map("updated_at") @db.Timestamptz(6)

  page       Page                @relation(fields: [pageId], references: [id], onDelete: Cascade)
  workspace  Workspace           @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  createdBy  User?               @relation("ReminderAuthor", fields: [createdById], references: [id], onDelete: SetNull)
  doneBy     User?               @relation("ReminderDoneBy", fields: [doneById], references: [id], onDelete: SetNull)
  recipients ReminderRecipient[]

  @@index([pageId, deletedAt])
  @@index([workspaceId, dueAt])
  @@index([doneAt])
  @@map("reminders")
}

model ReminderRecipient {
  reminderId String   @map("reminder_id") @db.Uuid
  userId     String   @map("user_id") @db.Uuid

  reminder Reminder @relation(fields: [reminderId], references: [id], onDelete: Cascade)
  user     User     @relation("ReminderRecipient", fields: [userId], references: [id], onDelete: Cascade)

  @@id([reminderId, userId])
  @@index([userId])
  @@map("reminder_recipients")
}
```

- [ ] **Step 2: Generate migration**

Run:
```bash
pnpm --filter @repo/db exec prisma migrate dev --name reminders
```

Expected: migration SQL is generated in `packages/db/prisma/migrations/<timestamp>_reminders/migration.sql`, the database is migrated, and the Prisma client is regenerated.

- [ ] **Step 3: Verify client types compile**

Run:
```bash
pnpm --filter @repo/db check-types
```

Expected: PASS. The generated client exports `Reminder`, `ReminderRecipient`, `ReminderAudience`, and `NotificationEventType` includes `REMINDER_DUE`.

- [ ] **Step 4: Verify @repo/db re-exports the new types**

Read `packages/db/src/index.ts`. If it explicitly re-exports model types or enums, add the new ones in the same style:

```ts
export type {
  // ... existing ...
  Reminder,
  ReminderRecipient,
  ReminderAudience,
} from '@prisma/client'
```

(If the file uses `export * from '@prisma/client'` then no change is needed.)

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/index.ts
git commit -m "feat(db): add Reminder, ReminderRecipient, REMINDER_DUE event type"
```

---

## Task 2: Notification catalog — REMINDER_DUE descriptor

**Files:**
- Modify: `packages/notifications/src/catalog.ts`

- [ ] **Step 1: Add descriptor entry**

Open `packages/notifications/src/catalog.ts`. Inside the `EVENT_CATALOG` object, after the existing COLLABORATION block (`COMMENT_CREATED`), add:

```ts
  REMINDER_DUE: {
    category: 'COLLABORATION',
    defaultChannels: ['IN_APP', 'EMAIL', 'WEB_PUSH'],
    lockedChannels: ['IN_APP'],
    requiresConsent: null,
  },
```

- [ ] **Step 2: Verify exhaustiveness**

Run:
```bash
pnpm --filter @repo/notifications check-types
```

Expected: PASS. Without this entry, TypeScript would flag the `Record<NotificationEventType, EventDescriptor>` type as incomplete now that `REMINDER_DUE` is in the enum.

- [ ] **Step 3: Commit**

```bash
git add packages/notifications/src/catalog.ts
git commit -m "feat(notifications): catalog REMINDER_DUE under COLLABORATION"
```

---

## Task 3: Notification helpers — formatHumanOffset

**Files:**
- Create: `packages/notifications/src/reminders.ts`
- Create: `packages/notifications/src/reminders.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/notifications/src/reminders.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { formatHumanOffset } from './reminders.ts'

describe('formatHumanOffset', () => {
  it.each([
    [0, 'в момент истечения'],
    [60, '1 час'],
    [1440, '1 день'],
    [4320, '3 дня'],
    [10080, '1 неделя'],
    [43200, '1 месяц'],
  ])('formats %d minutes as %s', (minutes, expected) => {
    expect(formatHumanOffset(minutes)).toBe(expected)
  })

  it('falls back to "напоминание" for unknown offsets', () => {
    expect(formatHumanOffset(777)).toBe('напоминание')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @repo/notifications test reminders
```

Expected: FAIL with "Failed to resolve import './reminders.ts'".

- [ ] **Step 3: Implement minimal helper**

Create `packages/notifications/src/reminders.ts`:

```ts
const HUMAN_OFFSETS: Record<number, string> = {
  0: 'в момент истечения',
  60: '1 час',
  1440: '1 день',
  4320: '3 дня',
  10080: '1 неделя',
  43200: '1 месяц',
}

export function formatHumanOffset(minutes: number): string {
  return HUMAN_OFFSETS[minutes] ?? 'напоминание'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @repo/notifications test reminders
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/notifications/src/reminders.ts packages/notifications/src/reminders.test.ts
git commit -m "feat(notifications): formatHumanOffset helper for reminder copy"
```

---

## Task 4: Reminder delivery rebuild + cancellation

**Files:**
- Modify: `packages/notifications/src/reminders.ts`
- Modify: `packages/notifications/src/reminders.test.ts`

- [ ] **Step 1: Append failing tests for rebuildDeliveries**

Append to `packages/notifications/src/reminders.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Prisma } from '@repo/db'
import { rebuildDeliveries, cancelPendingDeliveries } from './reminders.ts'

type Tx = Prisma.TransactionClient

function makeTx(overrides: Partial<Record<string, unknown>> = {}): Tx {
  const base = {
    workspaceMember: { findMany: vi.fn().mockResolvedValue([]) },
    reminderRecipient: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ email: 'a@b.c', emailVerified: true }) },
    notificationPreference: { findFirst: vi.fn().mockResolvedValue({ enabled: true }) },
    pushSubscription: { findMany: vi.fn().mockResolvedValue([]) },
    userConsent: { findFirst: vi.fn().mockResolvedValue(null) },
    notificationEvent: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'evt-1' }),
    },
    notificationDelivery: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'del-1' }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    notificationInApp: { create: vi.fn().mockResolvedValue({}) },
  }
  return { ...base, ...overrides } as unknown as Tx
}

describe('rebuildDeliveries', () => {
  const baseReminder = {
    id: '00000000-0000-0000-0000-000000000001',
    pageId: '22222222-2222-2222-2222-222222222222',
    workspaceId: '11111111-1111-1111-1111-111111111111',
    createdById: 'user-1',
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),  // 1 day from now
    offsets: [1440, 0],
    audience: 'ME' as const,
    label: 'Test',
    recipients: [],
    doneAt: null,
  }

  beforeEach(() => vi.clearAllMocks())

  it('creates one event + one delivery per (recipient, offset, channel) for ME audience', async () => {
    const tx = makeTx()
    await rebuildDeliveries(tx, baseReminder)

    // 2 offsets × 1 recipient = 2 events
    expect((tx.notificationEvent as any).create).toHaveBeenCalledTimes(2)
  })

  it('skips offsets whose fireAt is already in the past', async () => {
    const tx = makeTx()
    const reminder = {
      ...baseReminder,
      dueAt: new Date(Date.now() + 30 * 60 * 1000),  // 30 min from now
      offsets: [1440, 0],                                // 1d-out is past, in-moment is future
    }
    await rebuildDeliveries(tx, reminder)
    expect((tx.notificationEvent as any).create).toHaveBeenCalledTimes(1)
  })

  it('skips all deliveries when doneAt is set', async () => {
    const tx = makeTx()
    const reminder = { ...baseReminder, doneAt: new Date() }
    await rebuildDeliveries(tx, reminder)
    expect((tx.notificationEvent as any).create).not.toHaveBeenCalled()
  })

  it('resolves WORKSPACE audience to all current workspace members', async () => {
    const tx = makeTx({
      workspaceMember: {
        findMany: vi.fn().mockResolvedValue([
          { userId: 'user-1' },
          { userId: 'user-2' },
        ]),
      },
    })
    const reminder = { ...baseReminder, audience: 'WORKSPACE' as const, offsets: [0] }
    await rebuildDeliveries(tx, reminder)
    // 2 users × 1 offset = 2 events
    expect((tx.notificationEvent as any).create).toHaveBeenCalledTimes(2)
  })

  it('resolves LIST audience to provided recipients', async () => {
    const tx = makeTx()
    const reminder = {
      ...baseReminder,
      audience: 'LIST' as const,
      recipients: ['user-7', 'user-8'],
      offsets: [0],
    }
    await rebuildDeliveries(tx, reminder)
    expect((tx.notificationEvent as any).create).toHaveBeenCalledTimes(2)
  })
})

describe('cancelPendingDeliveries', () => {
  it('updates matching pending deliveries to SKIPPED', async () => {
    const tx = makeTx()
    await cancelPendingDeliveries(tx, ['rem-1', 'rem-2'], 'test reason')

    const updateMany = (tx.notificationDelivery as any).updateMany
    expect(updateMany).toHaveBeenCalledTimes(1)
    const call = updateMany.mock.calls[0][0]
    expect(call.where.status).toBe('PENDING')
    expect(call.data.status).toBe('SKIPPED')
    expect(call.data.lastError).toBe('test reason')
  })

  it('is a no-op for an empty reminder list', async () => {
    const tx = makeTx()
    await cancelPendingDeliveries(tx, [], 'test')
    expect((tx.notificationDelivery as any).updateMany).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
pnpm --filter @repo/notifications test reminders
```

Expected: FAIL — `rebuildDeliveries` / `cancelPendingDeliveries` not exported.

- [ ] **Step 3: Implement rebuildDeliveries and cancelPendingDeliveries**

Append to `packages/notifications/src/reminders.ts`:

```ts
import type { Prisma, ReminderAudience } from '@repo/db'

import { EVENT_CATALOG } from './catalog.ts'
import { resolvePreferences } from './resolve-preferences.ts'

type Tx = Prisma.TransactionClient

export type ReminderForRebuild = {
  id: string
  pageId: string
  workspaceId: string
  createdById: string | null
  dueAt: Date
  offsets: number[]
  audience: ReminderAudience
  label: string | null
  recipients: string[]
  doneAt: Date | null
}

async function resolveRecipientUserIds(tx: Tx, r: ReminderForRebuild): Promise<string[]> {
  if (r.audience === 'ME') return r.createdById ? [r.createdById] : []
  if (r.audience === 'WORKSPACE') {
    const members = await tx.workspaceMember.findMany({
      where: { workspaceId: r.workspaceId },
      select: { userId: true },
    })
    return members.map((m) => m.userId)
  }
  return r.recipients
}

export async function rebuildDeliveries(tx: Tx, r: ReminderForRebuild): Promise<void> {
  if (r.doneAt) {
    await cancelPendingDeliveries(tx, [r.id], 'reminder completed')
    return
  }

  const recipientIds = await resolveRecipientUserIds(tx, r)
  if (recipientIds.length === 0) {
    await cancelPendingDeliveries(tx, [r.id], 'no recipients')
    return
  }

  const descriptor = EVENT_CATALOG.REMINDER_DUE
  const now = Date.now()

  // 1. Load existing PENDING deliveries for this reminder (joined to events).
  const existing = await tx.notificationDelivery.findMany({
    where: {
      status: 'PENDING',
      event: {
        type: 'REMINDER_DUE',
        payload: { path: ['reminderId'], equals: r.id },
      },
    },
    include: { event: true },
  })

  type Key = string
  const keyOf = (userId: string, offsetMinutes: number, channel: string): Key =>
    `${userId}|${offsetMinutes}|${channel}`
  const existingByKey = new Map<Key, (typeof existing)[number]>()
  for (const d of existing) {
    const payload = d.event.payload as { offsetMinutes?: number }
    const off = typeof payload?.offsetMinutes === 'number' ? payload.offsetMinutes : -1
    existingByKey.set(keyOf(d.userId, off, d.channel), d)
  }

  const wantedKeys = new Set<Key>()

  // 2. For each future fire-point, ensure event + deliveries exist with correct nextAttemptAt.
  for (const offsetMinutes of r.offsets) {
    const fireAt = new Date(r.dueAt.getTime() - offsetMinutes * 60_000)
    if (fireAt.getTime() <= now) continue

    for (const userId of recipientIds) {
      const targets = await resolvePreferences(tx, userId, descriptor)
      const inAppWanted =
        descriptor.defaultChannels.includes('IN_APP') ||
        descriptor.lockedChannels.includes('IN_APP')

      // Lazy create the event row once per (offset, userId).
      let eventId: string | null = null
      const ensureEvent = async () => {
        if (eventId) return eventId
        const evt = await tx.notificationEvent.create({
          data: {
            type: 'REMINDER_DUE',
            category: descriptor.category,
            userId,
            workspaceId: r.workspaceId,
            payload: {
              reminderId: r.id,
              pageId: r.pageId,
              workspaceId: r.workspaceId,
              offsetMinutes,
              dueAt: r.dueAt.toISOString(),
              label: r.label,
            } as Prisma.InputJsonValue,
            resourceUrl: `/workspaces/${r.workspaceId}/pages/${r.pageId}#reminder-${r.id}`,
          },
        })
        eventId = evt.id
        if (inAppWanted) {
          await tx.notificationInApp.create({ data: { eventId: evt.id, userId } })
        }
        return eventId
      }

      if (targets.email) {
        const k = keyOf(userId, offsetMinutes, 'EMAIL')
        wantedKeys.add(k)
        const prev = existingByKey.get(k)
        if (prev) {
          if (prev.nextAttemptAt.getTime() !== fireAt.getTime()) {
            await tx.notificationDelivery.update({
              where: { id: prev.id },
              data: { nextAttemptAt: fireAt },
            })
          }
        } else {
          const evtId = await ensureEvent()
          await tx.notificationDelivery.create({
            data: {
              eventId: evtId,
              userId,
              channel: 'EMAIL',
              targetEmail: targets.email,
              nextAttemptAt: fireAt,
            },
          })
        }
      }

      for (const sub of targets.pushSubscriptions) {
        const k = keyOf(userId, offsetMinutes, 'WEB_PUSH')
        wantedKeys.add(k)
        const prev = existingByKey.get(k)
        if (prev) {
          if (prev.nextAttemptAt.getTime() !== fireAt.getTime()) {
            await tx.notificationDelivery.update({
              where: { id: prev.id },
              data: { nextAttemptAt: fireAt },
            })
          }
        } else {
          const evtId = await ensureEvent()
          await tx.notificationDelivery.create({
            data: {
              eventId: evtId,
              userId,
              channel: 'WEB_PUSH',
              targetSubscriptionId: sub.id,
              nextAttemptAt: fireAt,
            },
          })
        }
      }
    }
  }

  // 3. Anything in existing PENDING that we don't want → SKIPPED.
  const stale = existing.filter(
    (d) => {
      const payload = d.event.payload as { offsetMinutes?: number }
      const off = typeof payload?.offsetMinutes === 'number' ? payload.offsetMinutes : -1
      return !wantedKeys.has(keyOf(d.userId, off, d.channel))
    },
  )
  if (stale.length) {
    await tx.notificationDelivery.updateMany({
      where: { id: { in: stale.map((d) => d.id) } },
      data: {
        status: 'SKIPPED',
        processedAt: new Date(),
        lastError: 'reminder configuration changed',
        lockedAt: null,
        lockedBy: null,
      },
    })
  }
}

export async function cancelPendingDeliveries(
  tx: Tx,
  reminderIds: string[],
  reason: string,
): Promise<void> {
  if (reminderIds.length === 0) return
  await tx.notificationDelivery.updateMany({
    where: {
      status: 'PENDING',
      event: {
        type: 'REMINDER_DUE',
        payload: { path: ['reminderId'], in: reminderIds },
      },
    },
    data: {
      status: 'SKIPPED',
      processedAt: new Date(),
      lastError: reason,
      lockedAt: null,
      lockedBy: null,
    },
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
pnpm --filter @repo/notifications test reminders
```

Expected: PASS, all 13 tests.

- [ ] **Step 5: Export from package index**

Open `packages/notifications/src/index.ts` and add:

```ts
export {
  rebuildDeliveries,
  cancelPendingDeliveries,
  formatHumanOffset,
  type ReminderForRebuild,
} from './reminders.ts'
```

- [ ] **Step 6: Commit**

```bash
git add packages/notifications/src/reminders.ts packages/notifications/src/reminders.test.ts packages/notifications/src/index.ts
git commit -m "feat(notifications): rebuildDeliveries + cancelPendingDeliveries for reminders"
```

---

## Task 5: Email template — reminder-due

**Files:**
- Modify: `packages/mail/src/types.ts`
- Create: `packages/mail/src/templates/reminder-due.ts`
- Modify: `packages/mail/src/templates/index.ts`
- Modify: `packages/notifications/src/templates/email.ts`

- [ ] **Step 1: Add MailKind + payload type**

Edit `packages/mail/src/types.ts`. Append `'reminder-due'` to the `MailKind` union:

```ts
export type MailKind =
  | 'verify-email'
  | 'welcome'
  | 'reset-password'
  | 'password-changed'
  | 'email-changed'
  | 'new-login'
  | 'suspicious-activity'
  | 'invitation'
  | 'account-deletion-requested'
  | 'account-deletion-completed'
  | 'reminder-due'
```

Append the payload to `MailPayloads`:

```ts
  'reminder-due': {
    workspaceId: string
    pageId: string
    reminderId: string
    label: string | null
    dueAtIso: string
    offsetMinutes: number
    baseUrl: string
  }
```

- [ ] **Step 2: Implement the template**

Create `packages/mail/src/templates/reminder-due.ts`. First check what `esc()` helper looks like in the sibling templates:

```bash
head -20 packages/mail/src/templates/invitation.ts
```

Then write:

```ts
import type { MailPayloads, RenderedEmail } from '../types.ts'
import { formatHumanOffset } from '@repo/notifications'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderReminderDue(p: MailPayloads['reminder-due']): RenderedEmail {
  const label = p.label || 'Напоминание'
  const subject =
    p.offsetMinutes > 0
      ? `🔔 Через ${formatHumanOffset(p.offsetMinutes)}: ${label}`
      : `🔔 Напоминание: ${label}`

  const link = `${p.baseUrl}/workspaces/${encodeURIComponent(p.workspaceId)}/pages/${encodeURIComponent(p.pageId)}#reminder-${encodeURIComponent(p.reminderId)}`
  const dueLocal = new Date(p.dueAtIso).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' })

  const html = `<!doctype html>
<html lang="ru">
<body style="font-family: sans-serif;">
  <h1 style="margin:0 0 16px 0;">${esc(label)}</h1>
  <p>Дедлайн: <strong>${esc(dueLocal)}</strong></p>
  <p>
    <a href="${esc(link)}" style="display:inline-block; padding:10px 16px; background:#1976d2; color:#fff; text-decoration:none; border-radius:4px;">Открыть страницу</a>
  </p>
</body>
</html>`

  const text = `${label}\n\nДедлайн: ${dueLocal}\n\nСсылка: ${link}\n`

  return { subject, html, text }
}
```

If the existing templates have a shared `esc()` import (e.g. from `./utils.ts`), replace the local `esc` here with that import to match the convention.

- [ ] **Step 3: Register in renderTemplate switch**

Edit `packages/mail/src/templates/index.ts`. Add the import:

```ts
import { renderReminderDue } from './reminder-due.ts'
```

Add the case to the switch (before the `default`):

```ts
    case 'reminder-due':
      return renderReminderDue(data as MailPayloads['reminder-due'])
```

- [ ] **Step 4: Register in notification email registry**

Edit `packages/notifications/src/templates/email.ts`. Add this case (before `default`):

```ts
    case 'REMINDER_DUE': {
      const reminderId = typeof p.reminderId === 'string' ? p.reminderId : ''
      const pageId = typeof p.pageId === 'string' ? p.pageId : ''
      const workspaceId = typeof p.workspaceId === 'string' ? p.workspaceId : ''
      const offset = typeof payload.offsetMinutes === 'number' ? payload.offsetMinutes : 0
      return {
        kind: 'reminder-due',
        data: {
          workspaceId,
          pageId,
          reminderId,
          label: typeof p.label === 'string' ? p.label : null,
          dueAtIso: p.dueAt ?? '',
          offsetMinutes: offset,
          baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? '',
        },
      }
    }
```

Note: `renderEmailForEvent` only receives `payload`, so the renderer reads `workspaceId`, `pageId`, `reminderId` directly out of the JSON payload (already populated by Task 4's `rebuildDeliveries`).

- [ ] **Step 5: Type-check**

Run:
```bash
pnpm --filter @repo/mail check-types && pnpm --filter @repo/notifications check-types
```

Expected: PASS. The exhaustiveness check in `renderTemplate`'s `default` block will fail at type-check time if `MailKind` includes `'reminder-due'` but the switch doesn't.

- [ ] **Step 6: Commit**

```bash
git add packages/mail/src packages/notifications/src/templates
git commit -m "feat(mail): reminder-due email template + REMINDER_DUE renderer"
```

---

## Task 6: Dispatcher pre-fire validity check

**Files:**
- Modify: `packages/notifications/src/worker/dispatcher.ts`
- Modify: `packages/notifications/src/reminders.test.ts` (or new file)

- [ ] **Step 1: Read dispatcher to plan the hook point**

Read `packages/notifications/src/worker/dispatcher.ts` (already explored — lines 21-76). The check fits inside the `Promise.allSettled` callback, after the `findUnique` of the delivery and before the channel dispatch.

- [ ] **Step 2: Write failing test for the validity check**

Create `packages/notifications/src/worker/dispatcher-reminder.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { isReminderEventStillValid } from './dispatcher.ts'

describe('isReminderEventStillValid', () => {
  it('returns true for a non-reminder event', async () => {
    const prisma = { reminder: { findUnique: vi.fn() } }
    const res = await isReminderEventStillValid(prisma as any, {
      type: 'WORKSPACE_INVITE',
      payload: {},
    } as any)
    expect(res).toBe(true)
    expect(prisma.reminder.findUnique).not.toHaveBeenCalled()
  })

  it('returns false when reminder is missing', async () => {
    const prisma = { reminder: { findUnique: vi.fn().mockResolvedValue(null) } }
    const res = await isReminderEventStillValid(prisma as any, {
      type: 'REMINDER_DUE',
      payload: { reminderId: 'rem-1' },
    } as any)
    expect(res).toBe(false)
  })

  it('returns false when reminder is soft-deleted', async () => {
    const prisma = {
      reminder: {
        findUnique: vi.fn().mockResolvedValue({ deletedAt: new Date(), doneAt: null }),
      },
    }
    const res = await isReminderEventStillValid(prisma as any, {
      type: 'REMINDER_DUE',
      payload: { reminderId: 'rem-1' },
    } as any)
    expect(res).toBe(false)
  })

  it('returns false when reminder is done', async () => {
    const prisma = {
      reminder: {
        findUnique: vi.fn().mockResolvedValue({ deletedAt: null, doneAt: new Date() }),
      },
    }
    const res = await isReminderEventStillValid(prisma as any, {
      type: 'REMINDER_DUE',
      payload: { reminderId: 'rem-1' },
    } as any)
    expect(res).toBe(false)
  })

  it('returns true for an active reminder', async () => {
    const prisma = {
      reminder: {
        findUnique: vi.fn().mockResolvedValue({ deletedAt: null, doneAt: null }),
      },
    }
    const res = await isReminderEventStillValid(prisma as any, {
      type: 'REMINDER_DUE',
      payload: { reminderId: 'rem-1' },
    } as any)
    expect(res).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
pnpm --filter @repo/notifications test dispatcher-reminder
```

Expected: FAIL — `isReminderEventStillValid` not exported.

- [ ] **Step 4: Add the validity helper and wire it in**

Edit `packages/notifications/src/worker/dispatcher.ts`. Add the export and use it in the tick loop.

Above `runDispatcherTick`, add:

```ts
export async function isReminderEventStillValid(
  prisma: PrismaClient,
  event: { type: string; payload: unknown },
): Promise<boolean> {
  if (event.type !== 'REMINDER_DUE') return true
  const payload = event.payload as { reminderId?: string }
  if (!payload?.reminderId) return false
  const r = await prisma.reminder.findUnique({
    where: { id: payload.reminderId },
    select: { deletedAt: true, doneAt: true },
  })
  if (!r) return false
  return r.deletedAt === null && r.doneAt === null
}
```

Inside `runDispatcherTick`, in the `Promise.allSettled` block, after `if (!delivery) return` and before `try {`, insert:

```ts
const stillValid = await isReminderEventStillValid(prisma, delivery.event)
if (!stillValid) {
  await prisma.notificationDelivery.update({
    where: { id },
    data: {
      status: 'SKIPPED',
      processedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: 'reminder no longer valid',
    },
  })
  return
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
pnpm --filter @repo/notifications test dispatcher-reminder
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/notifications/src/worker/dispatcher.ts packages/notifications/src/worker/dispatcher-reminder.test.ts
git commit -m "feat(notifications): dispatcher skips invalid REMINDER_DUE deliveries"
```

---

## Task 7: tRPC reminder router — input schema and skeleton

**Files:**
- Create: `packages/trpc/src/routers/reminder.ts`
- Modify: `packages/trpc/src/index.ts`

- [ ] **Step 1: Create skeleton router**

Create `packages/trpc/src/routers/reminder.ts`:

```ts
import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { assertRole } from '../helpers/role'
import {
  rebuildDeliveries,
  cancelPendingDeliveries,
  type ReminderForRebuild,
} from '@repo/notifications'

const reminderSyncSchema = z.object({
  id: z.string().uuid(),
  dueAt: z.string().datetime(),
  offsets: z.array(z.number().int().min(0).max(525_600)).max(20),
  audience: z.enum(['ME', 'WORKSPACE', 'LIST']),
  label: z.string().max(200).nullable(),
  recipients: z.array(z.string().uuid()).max(100),
  doneAt: z.string().datetime().nullable(),
})

export const reminderRouter = router({
  syncForPage: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        reminders: z.array(reminderSyncSchema).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await ctx.prisma.page.findUniqueOrThrow({
        where: { id: input.pageId },
        select: { workspaceId: true },
      })
      await assertRole(ctx, page.workspaceId, ['OWNER', 'ADMIN', 'EDITOR'])

      await ctx.prisma.$transaction(async (tx) => {
        const existing = await tx.reminder.findMany({
          where: { pageId: input.pageId },
          select: {
            id: true,
            deletedAt: true,
            doneAt: true,
            dueAt: true,
            offsets: true,
            audience: true,
            createdById: true,
          },
        })
        const existingById = new Map(existing.map((r) => [r.id, r]))
        const incomingIds = new Set(input.reminders.map((r) => r.id))

        for (const r of input.reminders) {
          const prev = existingById.get(r.id)
          await tx.reminder.upsert({
            where: { id: r.id },
            create: {
              id: r.id,
              pageId: input.pageId,
              workspaceId: page.workspaceId,
              createdById: ctx.user.id,
              dueAt: new Date(r.dueAt),
              offsets: r.offsets,
              audience: r.audience,
              label: r.label,
              doneAt: r.doneAt ? new Date(r.doneAt) : null,
              doneById: r.doneAt ? ctx.user.id : null,
            },
            update: {
              dueAt: new Date(r.dueAt),
              offsets: r.offsets,
              audience: r.audience,
              label: r.label,
              doneAt: r.doneAt ? new Date(r.doneAt) : null,
              deletedAt: null,
              doneById: r.doneAt && !prev?.doneAt ? ctx.user.id : undefined,
            },
          })

          await tx.reminderRecipient.deleteMany({ where: { reminderId: r.id } })
          if (r.audience === 'LIST' && r.recipients.length) {
            await tx.reminderRecipient.createMany({
              data: r.recipients.map((uid) => ({ reminderId: r.id, userId: uid })),
            })
          }

          const forRebuild: ReminderForRebuild = {
            id: r.id,
            pageId: input.pageId,
            workspaceId: page.workspaceId,
            createdById: prev?.createdById ?? ctx.user.id,
            dueAt: new Date(r.dueAt),
            offsets: r.offsets,
            audience: r.audience,
            label: r.label,
            recipients: r.recipients,
            doneAt: r.doneAt ? new Date(r.doneAt) : null,
          }
          await rebuildDeliveries(tx, forRebuild)
        }

        const toDelete = [...existingById.keys()].filter((id) => !incomingIds.has(id))
        if (toDelete.length) {
          await tx.reminder.updateMany({
            where: { id: { in: toDelete }, deletedAt: null },
            data: { deletedAt: new Date() },
          })
          await cancelPendingDeliveries(tx, toDelete, 'reminder removed')
        }
      })

      return { ok: true }
    }),
})
```

- [ ] **Step 2: Verify assertRole helper exists**

Run:
```bash
grep -rln "export function assertRole\|export async function assertRole" packages/trpc/src/
```

Expected: a single hit (e.g. `packages/trpc/src/helpers/role.ts`). If the path differs, update the import in `reminder.ts`. If `assertRole` does not exist, look at how `workspace.ts` enforces roles (it uses an inline pattern) and copy it.

- [ ] **Step 3: Register router in appRouter**

Edit `packages/trpc/src/index.ts`. Add the import after the other router imports:

```ts
import { reminderRouter } from './routers/reminder'
```

In the `appRouter = router({ ... })` block, add:

```ts
  reminder: reminderRouter,
```

- [ ] **Step 4: Type-check**

Run:
```bash
pnpm --filter @repo/trpc check-types
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/reminder.ts packages/trpc/src/index.ts
git commit -m "feat(trpc): add reminder router with syncForPage mutation"
```

---

## Task 8: Integration test — syncForPage upsert/soft-delete/undo

**Files:**
- Create: `packages/trpc/src/routers/reminder.test.ts`

- [ ] **Step 1: Find existing integration test pattern**

Run:
```bash
ls packages/trpc/src/routers/*.test.ts | head -3 && head -30 "$(ls packages/trpc/src/routers/*.test.ts | head -1)"
```

This shows how routers are tested. Adopt the same setup (likely creates a test workspace + user via Prisma, calls `createCaller(ctx)`).

- [ ] **Step 2: Write failing test**

Create `packages/trpc/src/routers/reminder.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterAll } from 'vitest'
import { prisma } from '@repo/db'
import { createCaller } from '..'
import { createTestUser, createTestWorkspace, createTestPage, cleanupTestData } from '../test-utils'  // adapt to actual helper path

const ownerCtx = async () => {
  const user = await createTestUser()
  const workspace = await createTestWorkspace({ ownerId: user.id })
  const page = await createTestPage({ workspaceId: workspace.id, createdById: user.id })
  return {
    caller: createCaller({ prisma, user, headers: new Headers(), resHeaders: new Headers() } as any),
    user,
    workspace,
    page,
  }
}

describe('reminder.syncForPage', () => {
  afterAll(cleanupTestData)

  it('upserts new reminders', async () => {
    const { caller, page } = await ownerCtx()
    const id = crypto.randomUUID()
    await caller.reminder.syncForPage({
      pageId: page.id,
      reminders: [{
        id, dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        offsets: [0], audience: 'ME', label: 'Test', recipients: [], doneAt: null,
      }],
    })
    const row = await prisma.reminder.findUniqueOrThrow({ where: { id } })
    expect(row.deletedAt).toBeNull()
    expect(row.label).toBe('Test')
  })

  it('soft-deletes reminders missing from the sync payload', async () => {
    const { caller, page } = await ownerCtx()
    const id = crypto.randomUUID()
    const dueAt = new Date(Date.now() + 86_400_000).toISOString()
    await caller.reminder.syncForPage({
      pageId: page.id,
      reminders: [{ id, dueAt, offsets: [0], audience: 'ME', label: 'A', recipients: [], doneAt: null }],
    })
    await caller.reminder.syncForPage({ pageId: page.id, reminders: [] })
    const row = await prisma.reminder.findUniqueOrThrow({ where: { id } })
    expect(row.deletedAt).not.toBeNull()
  })

  it('restores a soft-deleted reminder when the same UUID is synced again (undo path)', async () => {
    const { caller, page } = await ownerCtx()
    const id = crypto.randomUUID()
    const payload = {
      id, dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      offsets: [0], audience: 'ME' as const, label: 'B', recipients: [], doneAt: null,
    }
    await caller.reminder.syncForPage({ pageId: page.id, reminders: [payload] })
    await caller.reminder.syncForPage({ pageId: page.id, reminders: [] })
    await caller.reminder.syncForPage({ pageId: page.id, reminders: [payload] })
    const row = await prisma.reminder.findUniqueOrThrow({ where: { id } })
    expect(row.deletedAt).toBeNull()
  })

  it('rejects callers without edit role', async () => {
    const { caller: ownerCaller, page } = await ownerCtx()
    const viewer = await createTestUser()
    // Assume helper to add a VIEWER membership
    await prisma.workspaceMember.create({
      data: { workspaceId: page.workspaceId, userId: viewer.id, role: 'VIEWER' },
    })
    const viewerCaller = createCaller({ prisma, user: viewer, headers: new Headers(), resHeaders: new Headers() } as any)
    await expect(
      viewerCaller.reminder.syncForPage({
        pageId: page.id,
        reminders: [{
          id: crypto.randomUUID(),
          dueAt: new Date(Date.now() + 86_400_000).toISOString(),
          offsets: [0], audience: 'ME', label: 'X', recipients: [], doneAt: null,
        }],
      }),
    ).rejects.toThrow()
    // suppress unused
    void ownerCaller
  })
})
```

Adjust imports / helper paths to match the actual test utilities exposed by `packages/trpc` (read `packages/trpc/src/test-utils*` or other existing test files).

- [ ] **Step 3: Run test to verify it fails / passes correctly**

Run:
```bash
pnpm --filter @repo/trpc test reminder
```

Expected: PASS for the upsert, soft-delete, and undo tests; PASS for permission test (router does reject). If any test helpers don't exist, adapt to the patterns used by other test files in the same directory.

- [ ] **Step 4: Commit**

```bash
git add packages/trpc/src/routers/reminder.test.ts
git commit -m "test(trpc): reminder.syncForPage upsert/soft-delete/undo/permission"
```

---

## Task 9: Editor — reminder.schema.ts

**Files:**
- Create: `packages/editor/src/extensions/reminder.schema.ts`
- Modify: `packages/editor/src/extensions/server.ts`

- [ ] **Step 1: Create schema**

Create `packages/editor/src/extensions/reminder.schema.ts`:

```ts
import { Node, mergeAttributes } from '@tiptap/core'

export const ReminderSchema = Node.create({
  name: 'reminder',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      id: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-id') ?? '',
        renderHTML: (attrs) => ({ 'data-id': attrs.id }),
      },
      dueAt: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-due-at') ?? '',
        renderHTML: (attrs) => ({ 'data-due-at': attrs.dueAt }),
      },
      offsets: {
        default: [1440, 0] as number[],
        parseHTML: (el) => {
          try {
            return JSON.parse(el.getAttribute('data-offsets') ?? '[]') as number[]
          } catch {
            return []
          }
        },
        renderHTML: (attrs) => ({ 'data-offsets': JSON.stringify(attrs.offsets) }),
      },
      audience: {
        default: 'ME' as 'ME' | 'WORKSPACE' | 'LIST',
        parseHTML: (el) => (el.getAttribute('data-audience') ?? 'ME') as 'ME' | 'WORKSPACE' | 'LIST',
        renderHTML: (attrs) => ({ 'data-audience': attrs.audience }),
      },
      label: {
        default: null as string | null,
        parseHTML: (el) => el.getAttribute('data-label'),
        renderHTML: (attrs) => (attrs.label ? { 'data-label': attrs.label } : {}),
      },
      recipients: {
        default: [] as string[],
        parseHTML: (el) => {
          try {
            return JSON.parse(el.getAttribute('data-recipients') ?? '[]') as string[]
          } catch {
            return []
          }
        },
        renderHTML: (attrs) =>
          attrs.recipients?.length ? { 'data-recipients': JSON.stringify(attrs.recipients) } : {},
      },
      doneAt: {
        default: null as string | null,
        parseHTML: (el) => el.getAttribute('data-done-at') || null,
        renderHTML: (attrs) => (attrs.doneAt ? { 'data-done-at': attrs.doneAt } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="reminder"]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-type': 'reminder' }),
      node.attrs.label ? String(node.attrs.label) : '🔔',
    ]
  },
})
```

- [ ] **Step 2: Re-export from server entry**

Open `packages/editor/src/extensions/server.ts`. Find the existing schema exports (PageLink, Callout, etc.) and add:

```ts
export { ReminderSchema } from './reminder.schema.ts'
```

Also append `ReminderSchema` to whatever array is consumed by Hocuspocus / SSR (look for an export like `serverExtensions` or `getServerSchema`).

- [ ] **Step 3: Type-check**

Run:
```bash
pnpm --filter @repo/editor check-types
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/extensions/reminder.schema.ts packages/editor/src/extensions/server.ts
git commit -m "feat(editor): reminder Tiptap inline atom schema"
```

---

## Task 10: Editor — color state logic with unit tests

**Files:**
- Create: `packages/editor/src/extensions/reminder/state.ts`
- Create: `packages/editor/src/extensions/reminder/state.test.ts`
- Create: `packages/editor/src/extensions/reminder/colors.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/editor/src/extensions/reminder/state.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { computeReminderState } from './state.ts'

const now = new Date('2026-05-11T12:00:00.000Z')

describe('computeReminderState', () => {
  it('returns green when doneAt is set, regardless of timing', () => {
    expect(
      computeReminderState(
        { dueAt: '2025-01-01T00:00:00.000Z', offsets: [0], doneAt: '2026-05-11T11:00:00.000Z' },
        now,
      ),
    ).toBe('green')
  })

  it('returns gray when dueAt is empty', () => {
    expect(computeReminderState({ dueAt: '', offsets: [], doneAt: null }, now)).toBe('gray')
  })

  it('returns red when now is past dueAt', () => {
    expect(
      computeReminderState(
        { dueAt: '2026-05-11T11:59:00.000Z', offsets: [0], doneAt: null },
        now,
      ),
    ).toBe('red')
  })

  it('returns yellow when now is between earliest offset window and dueAt', () => {
    // dueAt 1 hour from now; earliest offset = 1440min (1 day); now is inside the window
    expect(
      computeReminderState(
        { dueAt: '2026-05-11T13:00:00.000Z', offsets: [1440, 60, 0], doneAt: null },
        now,
      ),
    ).toBe('yellow')
  })

  it('returns gray when now is before earliest offset window', () => {
    // dueAt 1 week away; earliest offset = 1 day; now is well before window
    expect(
      computeReminderState(
        { dueAt: '2026-05-18T12:00:00.000Z', offsets: [1440, 60, 0], doneAt: null },
        now,
      ),
    ).toBe('gray')
  })

  it('treats no offsets as instantaneous fire — yellow only at dueAt', () => {
    expect(
      computeReminderState(
        { dueAt: '2026-05-11T13:00:00.000Z', offsets: [], doneAt: null },
        now,
      ),
    ).toBe('gray')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run:
```bash
pnpm --filter @repo/editor test state
```

Expected: FAIL.

- [ ] **Step 3: Implement state**

Create `packages/editor/src/extensions/reminder/state.ts`:

```ts
export type ReminderColor = 'gray' | 'yellow' | 'red' | 'green'

export type ReminderStateInput = {
  dueAt: string
  offsets: number[]
  doneAt: string | null
}

export function computeReminderState(attrs: ReminderStateInput, now: Date): ReminderColor {
  if (attrs.doneAt) return 'green'
  if (!attrs.dueAt) return 'gray'
  const due = new Date(attrs.dueAt).getTime()
  const t = now.getTime()
  if (t >= due) return 'red'
  if (!attrs.offsets || attrs.offsets.length === 0) return 'gray'
  const earliestOffsetMinutes = Math.max(...attrs.offsets)
  const yellowStart = due - earliestOffsetMinutes * 60_000
  return t >= yellowStart ? 'yellow' : 'gray'
}
```

- [ ] **Step 4: Verify tests pass**

Run:
```bash
pnpm --filter @repo/editor test state
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Create color palette**

Create `packages/editor/src/extensions/reminder/colors.ts`:

```ts
import type { ReminderColor } from './state.ts'

export type ReminderPalette = {
  bg: string
  fg: string
  border: string
}

export const REMINDER_COLORS: Record<ReminderColor, ReminderPalette> = {
  gray:   { bg: 'rgba(120, 120, 130, 0.10)', fg: '#5f5f6a', border: 'rgba(120, 120, 130, 0.25)' },
  yellow: { bg: 'rgba(255, 167, 38, 0.12)',  fg: '#b75d00', border: 'rgba(255, 167, 38, 0.40)' },
  red:    { bg: 'rgba(244,  67, 54, 0.12)',  fg: '#b3261e', border: 'rgba(244,  67, 54, 0.40)' },
  green:  { bg: 'rgba( 76, 175, 80, 0.12)',  fg: '#1e7e2c', border: 'rgba( 76, 175, 80, 0.40)' },
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/editor/src/extensions/reminder
git commit -m "feat(editor): reminder color state + palette with unit tests"
```

---

## Task 11: Editor — reminder.tsx React view

**Files:**
- Create: `packages/editor/src/extensions/reminder.tsx`
- Modify: `packages/editor/src/extensions/index.ts`

- [ ] **Step 1: Create React view + extension**

Create `packages/editor/src/extensions/reminder.tsx`:

```tsx
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useEffect, useMemo, useState } from 'react'
import { Box } from '@repo/ui/components'
import NotificationsIcon from '@mui/icons-material/Notifications'

import { ReminderSchema } from './reminder.schema.ts'
import { computeReminderState } from './reminder/state.ts'
import { REMINDER_COLORS } from './reminder/colors.ts'

function useTick(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function formatRelative(iso: string, now: Date): string {
  if (!iso) return 'Установить дату'
  const due = new Date(iso)
  const diff = due.getTime() - now.getTime()
  const minutes = Math.round(diff / 60_000)
  const absMinutes = Math.abs(minutes)
  if (absMinutes < 60) return minutes >= 0 ? `через ${absMinutes} мин` : `${absMinutes} мин назад`
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return hours >= 0 ? `через ${Math.abs(hours)} ч` : `${Math.abs(hours)} ч назад`
  return due.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

function ReminderView({ node, editor }: NodeViewProps) {
  const now = useTick(60_000)
  const state = useMemo(
    () => computeReminderState({
      dueAt: node.attrs.dueAt,
      offsets: node.attrs.offsets,
      doneAt: node.attrs.doneAt,
    }, now),
    [node.attrs.dueAt, node.attrs.offsets, node.attrs.doneAt, now],
  )
  const palette = REMINDER_COLORS[state]
  const isPlaceholder = !node.attrs.dueAt

  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    if (!editor.isEditable) return
    const ctx = (editor.storage as { reminderCallbacks?: { onClick?: (id: string, anchor: HTMLElement) => void } })
    ctx.reminderCallbacks?.onClick?.(node.attrs.id, e.currentTarget)
  }

  return (
    <NodeViewWrapper
      as="span"
      data-id={`reminder-${node.attrs.id}`}
      contentEditable={false}
    >
      <Box
        component="span"
        onClick={handleClick}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          px: 0.75,
          mx: 0.25,
          py: '1px',
          borderRadius: 1,
          bgcolor: palette.bg,
          color: palette.fg,
          border: `1px solid ${palette.border}`,
          cursor: editor.isEditable ? 'pointer' : 'default',
          fontSize: '0.875em',
          lineHeight: 1.2,
          textDecoration: node.attrs.doneAt ? 'line-through' : 'none',
          fontStyle: isPlaceholder ? 'italic' : 'normal',
          userSelect: 'none',
          verticalAlign: 'baseline',
        }}
      >
        <NotificationsIcon sx={{ fontSize: '0.95em' }} />
        <span>{node.attrs.label || (isPlaceholder ? 'Напомнить' : 'Напомнить')}</span>
        {!isPlaceholder && <span aria-hidden>·</span>}
        <span>{formatRelative(node.attrs.dueAt, now)}</span>
      </Box>
    </NodeViewWrapper>
  )
}

export const Reminder = ReminderSchema.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ReminderView)
  },
})
```

- [ ] **Step 2: Register the extension**

Edit `packages/editor/src/extensions/index.ts`. Find the array of extensions (e.g. `getExtensions(opts)`). Add the import at the top:

```ts
import { Reminder } from './reminder.tsx'
```

Insert `Reminder` into the returned array next to other inline atoms (`PageLink`, etc.).

- [ ] **Step 3: Type-check + lint**

Run:
```bash
pnpm --filter @repo/editor check-types && pnpm --filter @repo/editor lint
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/extensions/reminder.tsx packages/editor/src/extensions/index.ts
git commit -m "feat(editor): reminder inline node view + click callback hook"
```

---

## Task 12: Editor — slash command + handler type

**Files:**
- Modify: `packages/editor/src/slash-items.ts`
- Modify: `packages/editor/src/types.ts`

- [ ] **Step 1: Extend SlashItemHandlers type**

Open `packages/editor/src/types.ts`. Find the `SlashItemHandlers` type (or wherever date/file/pageLink slash handlers are typed). Append a new method:

```ts
export type SlashItemHandlers = {
  // ... existing handler methods ...
  openReminderCreate?: (reminderId: string) => void
}
```

- [ ] **Step 2: Add slash item**

Open `packages/editor/src/slash-items.ts`. Find the `createSlashItems(handlers)` function and the `base` group array. After the `date` / `datetime` item, append:

```ts
import NotificationsIcon from '@mui/icons-material/Notifications'

// ... inside the base group items array ...
{
  id: 'reminder',
  group: 'base',
  label: 'Напоминание',
  keywords: ['reminder', 'напоминание', 'дедлайн', 'deadline', 'todo'],
  icon: createElement(NotificationsIcon),
  run: ({ editor, range }) => {
    const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    editor
      .chain()
      .focus()
      .deleteRange(range)
      .insertContent({
        type: 'reminder',
        attrs: { id, dueAt: '', offsets: [1440, 0], audience: 'ME', label: null, recipients: [], doneAt: null },
      })
      .run()
    handlers.openReminderCreate?.(id)
  },
},
```

If the surrounding items don't use `createElement(NotificationsIcon)` and instead reference custom icons, follow whatever pattern is in the file (e.g. `<NotificationsIcon />` JSX if the file is TSX).

- [ ] **Step 3: Type-check**

Run:
```bash
pnpm --filter @repo/editor check-types
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/slash-items.ts packages/editor/src/types.ts
git commit -m "feat(editor): /reminder slash command + openReminderCreate handler"
```

---

## Task 13: Editor — wire click callbacks via editor storage

**Files:**
- Modify: `packages/editor/src/anynote-editor.tsx`
- Modify: `packages/editor/src/types.ts`

- [ ] **Step 1: Extend props**

In `packages/editor/src/types.ts`, find `AnyNoteEditorProps`. Append:

```ts
export type AnyNoteEditorProps = {
  // ... existing ...
  onReminderClick?: (reminderId: string, anchor: HTMLElement) => void
  onReminderCreate?: (reminderId: string) => void
}
```

- [ ] **Step 2: Pipe callbacks into editor storage**

Open `packages/editor/src/anynote-editor.tsx`. Locate the place where the editor is created (`useEditor({ extensions: [...], onCreate: ... })`). After the editor is created (or in `onCreate`), do:

```tsx
useEffect(() => {
  if (!editor) return
  (editor.storage as Record<string, unknown>).reminderCallbacks = {
    onClick: props.onReminderClick,
  }
}, [editor, props.onReminderClick])
```

Pipe `onReminderCreate` into `createSlashItems({ ..., openReminderCreate: props.onReminderCreate })` wherever slash items are constructed.

- [ ] **Step 3: Type-check**

Run:
```bash
pnpm --filter @repo/editor check-types
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/anynote-editor.tsx packages/editor/src/types.ts
git commit -m "feat(editor): pipe reminder click + create callbacks to editor"
```

---

## Task 14: Web — ReminderPopover component

**Files:**
- Create: `apps/web/src/components/page/reminder-popover.tsx`

- [ ] **Step 1: Check @mui/x-date-pickers availability**

Run:
```bash
grep -rln "DateTimePicker\|x-date-pickers" apps/web/src packages/ui/src 2>/dev/null | head -5
```

If hits: a `DateTimePicker` is already in use — reuse the same import. If no hits: add `@mui/x-date-pickers` and `date-fns` to `packages/ui/package.json` dependencies, run `pnpm install`, and configure `<LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={ru}>` somewhere accessible (either inside `<ReminderPopover>` for self-containment or globally in `apps/web/src/components/providers/`).

- [ ] **Step 2: Implement the popover**

Create `apps/web/src/components/page/reminder-popover.tsx`:

```tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  IconButton,
  Popover,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker'
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFnsV3'
import ru from 'date-fns/locale/ru'
import CloseIcon from '@mui/icons-material/Close'
import DeleteIcon from '@mui/icons-material/Delete'

import { trpc } from '@/trpc/client'

type Audience = 'ME' | 'WORKSPACE' | 'LIST'

export type ReminderFormValue = {
  id: string
  dueAt: string | null
  offsets: number[]
  audience: Audience
  label: string | null
  recipients: string[]
  doneAt: string | null
}

const OFFSET_PRESETS: { value: number; label: string }[] = [
  { value: 0,     label: 'В момент истечения' },
  { value: 60,    label: 'За 1 час' },
  { value: 1440,  label: 'За 1 день' },
  { value: 4320,  label: 'За 3 дня' },
  { value: 10080, label: 'За 1 неделю' },
  { value: 43200, label: 'За 1 месяц' },
]

type Props = {
  open: boolean
  anchorEl: HTMLElement | null
  mode: 'create' | 'edit'
  initial: ReminderFormValue
  workspaceId: string
  readOnly?: boolean
  onClose: () => void
  onSave: (value: ReminderFormValue) => void
  onDelete?: () => void
}

export function ReminderPopover({
  open, anchorEl, mode, initial, workspaceId, readOnly, onClose, onSave, onDelete,
}: Props) {
  const [value, setValue] = useState<ReminderFormValue>(initial)

  useEffect(() => { setValue(initial) }, [initial])

  const members = trpc.workspace.listMembers.useQuery(
    { workspaceId },
    { enabled: open && value.audience === 'LIST' },
  )

  const dueAtDate = value.dueAt ? new Date(value.dueAt) : null
  const submitDisabled = useMemo(() => {
    if (readOnly) return true
    if (!value.dueAt) return true
    if (new Date(value.dueAt).getTime() <= Date.now()) return true
    if (value.audience === 'LIST' && value.recipients.length === 0) return true
    return false
  }, [value, readOnly])

  const toggleOffset = (n: number) => {
    setValue((v) => ({
      ...v,
      offsets: v.offsets.includes(n) ? v.offsets.filter((x) => x !== n) : [...v.offsets, n],
    }))
  }

  const handleSubmit = () => { onSave(value); onClose() }
  const postpone = (deltaDays: number) => {
    if (!value.dueAt) return
    const d = new Date(value.dueAt)
    d.setDate(d.getDate() + deltaDays)
    onSave({ ...value, dueAt: d.toISOString() })
    onClose()
  }
  const postponeMonth = () => {
    if (!value.dueAt) return
    const d = new Date(value.dueAt)
    d.setMonth(d.getMonth() + 1)
    onSave({ ...value, dueAt: d.toISOString() })
    onClose()
  }
  const toggleDone = () => {
    const next = value.doneAt ? null : new Date().toISOString()
    onSave({ ...value, doneAt: next })
    onClose()
  }

  return (
    <Popover open={open} anchorEl={anchorEl} onClose={onClose} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
      <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={ru}>
        <Box sx={{ p: 2, width: 360 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
            <Typography variant="subtitle1">Напоминание</Typography>
            <IconButton size="small" onClick={onClose} aria-label="Закрыть"><CloseIcon fontSize="small" /></IconButton>
          </Stack>

          <Stack spacing={2}>
            <TextField
              label="Лейбл"
              size="small"
              value={value.label ?? ''}
              onChange={(e) => setValue({ ...value, label: e.target.value || null })}
              disabled={readOnly}
              inputProps={{ maxLength: 200 }}
              fullWidth
            />

            <DateTimePicker
              label="Дедлайн"
              value={dueAtDate}
              onChange={(d) => setValue({ ...value, dueAt: d ? d.toISOString() : null })}
              disablePast
              disabled={readOnly}
              slotProps={{ textField: { size: 'small', fullWidth: true } }}
            />

            <FormControl disabled={readOnly}>
              <FormLabel>Напомнить заранее</FormLabel>
              <Stack>
                {OFFSET_PRESETS.map((o) => (
                  <FormControlLabel
                    key={o.value}
                    control={<Checkbox size="small" checked={value.offsets.includes(o.value)} onChange={() => toggleOffset(o.value)} />}
                    label={o.label}
                  />
                ))}
              </Stack>
            </FormControl>

            <FormControl disabled={readOnly}>
              <FormLabel>Для кого</FormLabel>
              <RadioGroup
                value={value.audience}
                onChange={(_, v) => setValue({ ...value, audience: v as Audience, recipients: v === 'LIST' ? value.recipients : [] })}
              >
                <FormControlLabel value="ME" control={<Radio size="small" />} label="Только я" />
                <FormControlLabel value="WORKSPACE" control={<Radio size="small" />} label="Весь workspace" />
                <FormControlLabel value="LIST" control={<Radio size="small" />} label="Выбрать участников" />
              </RadioGroup>
              {value.audience === 'LIST' && (
                <Stack sx={{ pl: 3, maxHeight: 180, overflow: 'auto' }}>
                  {(members.data ?? []).map((m) => (
                    <FormControlLabel
                      key={m.user.id}
                      control={
                        <Checkbox
                          size="small"
                          checked={value.recipients.includes(m.user.id)}
                          onChange={() => {
                            setValue((v) => ({
                              ...v,
                              recipients: v.recipients.includes(m.user.id)
                                ? v.recipients.filter((x) => x !== m.user.id)
                                : [...v.recipients, m.user.id],
                            }))
                          }}
                        />
                      }
                      label={`${m.user.firstName ?? ''} ${m.user.lastName ?? ''}`.trim() || m.user.email}
                    />
                  ))}
                </Stack>
              )}
            </FormControl>

            {mode === 'edit' && !readOnly && (
              <>
                <Divider />
                <Stack direction="row" spacing={1}>
                  <Typography variant="caption" alignSelf="center">Перенести:</Typography>
                  <Button size="small" onClick={() => postpone(1)}>+1 день</Button>
                  <Button size="small" onClick={() => postpone(7)}>+1 неделя</Button>
                  <Button size="small" onClick={postponeMonth}>+1 месяц</Button>
                </Stack>

                <FormControlLabel
                  control={<Checkbox size="small" checked={!!value.doneAt} onChange={toggleDone} />}
                  label="Выполнено"
                />
              </>
            )}

            <Divider />
            <Stack direction="row" justifyContent="space-between">
              {mode === 'edit' && !readOnly ? (
                <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => { onDelete?.(); onClose() }}>
                  Удалить
                </Button>
              ) : (
                <span />
              )}
              <Stack direction="row" spacing={1}>
                <Button size="small" onClick={onClose}>Отмена</Button>
                {!readOnly && (
                  <Button size="small" variant="contained" disabled={submitDisabled} onClick={handleSubmit}>
                    {mode === 'create' ? 'Создать' : 'Сохранить'}
                  </Button>
                )}
              </Stack>
            </Stack>
          </Stack>
        </Box>
      </LocalizationProvider>
    </Popover>
  )
}
```

- [ ] **Step 3: Type-check**

Run:
```bash
pnpm --filter web check-types
```

Expected: PASS. If any MUI imports are missing from `@repo/ui/components`, add them to `packages/ui/src/components/index.ts`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/page/reminder-popover.tsx packages/ui
git commit -m "feat(web): ReminderPopover with create/edit modes and DateTimePicker"
```

---

## Task 15: Web — useReminderSync hook

**Files:**
- Create: `apps/web/src/components/page/use-reminder-sync.ts`
- Create: `apps/web/src/components/page/use-reminder-sync.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/web/src/components/page/use-reminder-sync.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { collectReminderInputs } from './use-reminder-sync.ts'

describe('collectReminderInputs', () => {
  it('skips reminder nodes without an id or dueAt', () => {
    const fakeDoc = {
      descendants(visit: (node: any) => void) {
        visit({ type: { name: 'paragraph' }, attrs: {} })
        visit({ type: { name: 'reminder' }, attrs: { id: '', dueAt: '2026-01-01T00:00:00Z' } })
        visit({ type: { name: 'reminder' }, attrs: { id: 'r1', dueAt: '' } })
        visit({
          type: { name: 'reminder' },
          attrs: {
            id: 'r2',
            dueAt: '2026-06-01T00:00:00Z',
            offsets: [0],
            audience: 'ME',
            label: 'x',
            recipients: [],
            doneAt: null,
          },
        })
      },
    }
    expect(collectReminderInputs(fakeDoc as any)).toEqual([
      {
        id: 'r2',
        dueAt: '2026-06-01T00:00:00Z',
        offsets: [0],
        audience: 'ME',
        label: 'x',
        recipients: [],
        doneAt: null,
      },
    ])
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run:
```bash
pnpm --filter web test use-reminder-sync
```

Expected: FAIL.

- [ ] **Step 3: Implement hook + helper**

Create `apps/web/src/components/page/use-reminder-sync.ts`:

```ts
'use client'

import { useEffect, useMemo } from 'react'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

import { trpc } from '@/trpc/client'

export type ReminderSyncInput = {
  id: string
  dueAt: string
  offsets: number[]
  audience: 'ME' | 'WORKSPACE' | 'LIST'
  label: string | null
  recipients: string[]
  doneAt: string | null
}

export function collectReminderInputs(doc: { descendants(visit: (node: PMNode) => void): void }): ReminderSyncInput[] {
  const out: ReminderSyncInput[] = []
  doc.descendants((node) => {
    if (node.type.name !== 'reminder') return
    const a = node.attrs as Record<string, unknown>
    if (typeof a.id !== 'string' || !a.id) return
    if (typeof a.dueAt !== 'string' || !a.dueAt) return
    out.push({
      id: a.id,
      dueAt: a.dueAt,
      offsets: Array.isArray(a.offsets) ? (a.offsets as number[]) : [],
      audience: (a.audience as ReminderSyncInput['audience']) ?? 'ME',
      label: typeof a.label === 'string' ? a.label : null,
      recipients: Array.isArray(a.recipients) ? (a.recipients as string[]) : [],
      doneAt: typeof a.doneAt === 'string' ? a.doneAt : null,
    })
  })
  return out
}

function debounce<T extends (...args: never[]) => unknown>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null
  const wrapped = (...args: Parameters<T>) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
  wrapped.cancel = () => { if (t) clearTimeout(t); t = null }
  return wrapped as T & { cancel: () => void }
}

export function useReminderSync(editor: Editor | null, pageId: string) {
  const sync = trpc.reminder.syncForPage.useMutation()
  const debounced = useMemo(() => debounce(() => {
    if (!editor) return
    if (!editor.isEditable) return
    const reminders = collectReminderInputs(editor.state.doc)
    sync.mutate({ pageId, reminders })
  }, 1_000), [editor, pageId, sync])

  useEffect(() => {
    if (!editor) return
    editor.on('update', debounced)
    return () => { editor.off('update', debounced); debounced.cancel() }
  }, [editor, debounced])
}
```

- [ ] **Step 4: Verify tests pass**

Run:
```bash
pnpm --filter web test use-reminder-sync
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/page/use-reminder-sync.ts apps/web/src/components/page/use-reminder-sync.test.tsx
git commit -m "feat(web): useReminderSync — debounced Y.Doc → DB reconciliation"
```

---

## Task 16: Web — page-renderer + editor-context wiring

**Files:**
- Modify: `apps/web/src/components/page/page-renderer.tsx`
- Modify: `apps/web/src/components/page/editor-context.tsx` (or wherever `pageEditor` lives)

- [ ] **Step 1: Build the popover controller hook**

Inside `apps/web/src/components/page/page-renderer.tsx`, near the other hooks, add:

```tsx
import { ReminderPopover, type ReminderFormValue } from './reminder-popover'
import { useReminderSync } from './use-reminder-sync'

// inside PageRenderer():
const [reminderUI, setReminderUI] = useState<
  | { open: false }
  | { open: true; mode: 'create' | 'edit'; anchorEl: HTMLElement | null; initial: ReminderFormValue }
>({ open: false })

const findReminderNode = useCallback((id: string) => {
  if (!editor) return null
  let found: { attrs: ReminderFormValue; pos: number } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'reminder' && node.attrs.id === id) {
      found = {
        attrs: {
          id: node.attrs.id,
          dueAt: node.attrs.dueAt || null,
          offsets: node.attrs.offsets ?? [],
          audience: node.attrs.audience ?? 'ME',
          label: node.attrs.label ?? null,
          recipients: node.attrs.recipients ?? [],
          doneAt: node.attrs.doneAt ?? null,
        },
        pos,
      }
      return false
    }
    return true
  })
  return found
}, [editor])

const handleReminderCreate = useCallback((id: string) => {
  // anchor will resolve once the DOM node mounts
  setTimeout(() => {
    const anchor = document.querySelector(`[data-id="reminder-${id}"]`) as HTMLElement | null
    const found = findReminderNode(id)
    if (!found) return
    setReminderUI({ open: true, mode: 'create', anchorEl: anchor, initial: found.attrs })
  }, 0)
}, [findReminderNode])

const handleReminderClick = useCallback((id: string, anchor: HTMLElement) => {
  const found = findReminderNode(id)
  if (!found) return
  setReminderUI({ open: true, mode: 'edit', anchorEl: anchor, initial: found.attrs })
}, [findReminderNode])

const saveReminder = useCallback((value: ReminderFormValue) => {
  if (!editor) return
  let pos: number | null = null
  editor.state.doc.descendants((node, p) => {
    if (node.type.name === 'reminder' && node.attrs.id === value.id) {
      pos = p
      return false
    }
    return true
  })
  if (pos === null) return
  editor.chain().focus().setNodeSelection(pos).updateAttributes('reminder', {
    dueAt: value.dueAt ?? '',
    offsets: value.offsets,
    audience: value.audience,
    label: value.label,
    recipients: value.recipients,
    doneAt: value.doneAt,
  }).run()
}, [editor])

const deleteReminder = useCallback((id: string) => {
  if (!editor) return
  let pos: number | null = null
  let size = 0
  editor.state.doc.descendants((node, p) => {
    if (node.type.name === 'reminder' && node.attrs.id === id) {
      pos = p
      size = node.nodeSize
      return false
    }
    return true
  })
  if (pos === null) return
  editor.chain().focus().deleteRange({ from: pos, to: pos + size }).run()
}, [editor])

useReminderSync(editor, page.id)
```

In the `<AnyNoteEditor ... />` block, pass the two callbacks:

```tsx
<AnyNoteEditor
  // ... existing props ...
  onReminderCreate={handleReminderCreate}
  onReminderClick={handleReminderClick}
/>
```

After `<AnyNoteEditor />` (still inside the returned tree), render the popover:

```tsx
{reminderUI.open && (
  <ReminderPopover
    open
    anchorEl={reminderUI.anchorEl}
    mode={reminderUI.mode}
    initial={reminderUI.initial}
    workspaceId={workspaceId}
    readOnly={!!readOnly}
    onClose={() => setReminderUI({ open: false })}
    onSave={saveReminder}
    onDelete={() => deleteReminder(reminderUI.initial.id)}
  />
)}
```

- [ ] **Step 2: Hash-anchor scroll**

Still in `page-renderer.tsx`, add an effect that runs after the editor is ready:

```tsx
useEffect(() => {
  if (!editor) return
  const hash = typeof window !== 'undefined' ? window.location.hash : ''
  const match = /^#reminder-([0-9a-f-]{36})$/i.exec(hash)
  if (!match) return
  const id = match[1]
  // wait a tick so the DOM is laid out
  const t = setTimeout(() => {
    const el = document.querySelector(`[data-id="reminder-${id}"]`) as HTMLElement | null
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('reminder-flash')
    setTimeout(() => el.classList.remove('reminder-flash'), 2000)
  }, 200)
  return () => clearTimeout(t)
}, [editor])
```

Add a CSS rule in the editor content styles for `.reminder-flash` (find `packages/editor/src/styles/content.css` and append):

```css
@keyframes reminder-flash {
  0%   { box-shadow: 0 0 0 2px rgba(255, 167, 38, 0.6); }
  100% { box-shadow: 0 0 0 2px rgba(255, 167, 38, 0); }
}
.reminder-flash {
  animation: reminder-flash 2s ease-out;
}
```

- [ ] **Step 3: Type-check + lint**

Run:
```bash
pnpm --filter web check-types && pnpm --filter web lint
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/page/page-renderer.tsx packages/editor/src/styles/content.css
git commit -m "feat(web): wire ReminderPopover + sync + anchor scroll into PageRenderer"
```

---

## Task 17: Manual smoke + dev verification

**Files:** none

- [ ] **Step 1: Start dev infra and server**

```bash
docker compose up -d
pnpm --filter web dev
```

In another terminal (or browser):

- [ ] **Step 2: Walk the golden path manually**

1. Open `http://localhost:3000`, sign in (or sign up via `signUpAndAuthAs` SQL trick from `apps/e2e/helpers/auth.ts`).
2. Open any workspace page (`/workspaces/<id>/pages/<id>`).
3. Type `/reminder`, click the entry.
4. Verify the popover opens. Fill the label, set due date 5 minutes in the future, check `В момент истечения`, choose `Только я`. Click `Создать`.
5. Verify the chip renders inline. Wait a few seconds; chip should be **gray** (less than the earliest offset, which is 0 in this test ⇒ flips to yellow immediately).
6. Click the chip; verify the edit popover opens populated with the saved values.
7. Click `+1 день`; verify the chip's text updates to ~24h away and stays editable.
8. Toggle `Выполнено`; verify the chip turns **green** with strikethrough.
9. Untoggle done; verify the chip restores.
10. Click `🗑 Удалить`; chip disappears. Press `⌘Z` / `Ctrl+Z`; chip reappears intact.
11. Verify in `psql` (`SELECT id, due_at, deleted_at, done_at FROM reminders ORDER BY created_at DESC LIMIT 5;`) that:
    - Initial create → row present, `deleted_at IS NULL`.
    - After delete + undo → same id, `deleted_at IS NULL` again.

- [ ] **Step 3: Tear down**

Stop the dev server.

- [ ] **Step 4: Note results**

If anything fails: capture the error, debug, fix, **then** continue. Do not mark this task complete with a broken smoke.

- [ ] **Step 5: No commit (manual verification)**

---

## Task 18: E2E test

**Files:**
- Create: `apps/e2e/reminders.spec.ts`

- [ ] **Step 1: Inspect helpers**

Read `apps/e2e/helpers/auth.ts` to confirm the `signUpAndAuthAs` signature and where the test workspace gets created. (May need to call `workspaces/new` after sign-in if seed doesn't auto-create one — copy this from another spec.)

- [ ] **Step 2: Write the spec**

Create `apps/e2e/reminders.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

test.describe('Page reminders', () => {
  test('creates a reminder via slash command and shows the chip', async ({ page }) => {
    await signUpAndAuthAs(page, { email: `reminder-${Date.now()}@example.com`, firstName: 'R', lastName: 'T' })

    // Create or open a workspace + page. Reuse helpers from sibling specs that do this.
    await page.goto('/workspaces/new')
    await page.getByLabel('Название').fill('Reminder Spec WS')
    await page.getByRole('button', { name: /создать/i }).click()
    await page.waitForURL(/\/workspaces\/[0-9a-f-]+/i)

    // Create a page (adapt to current sidebar/create-page UI)
    await page.getByRole('button', { name: /новая страница|\+/i }).first().click()
    await page.waitForURL(/\/workspaces\/[0-9a-f-]+\/pages\//i)

    const editor = page.locator('.ProseMirror').first()
    await editor.click()
    await editor.type('Test ')
    await editor.type('/reminder')
    await page.getByRole('option', { name: /напоминание/i }).click()

    // Popover should open
    const popover = page.locator('text=Напоминание').first()
    await expect(popover).toBeVisible()

    // Fill date (DateTimePicker — open and pick a date a few days out)
    await page.getByLabel('Дедлайн').click()
    // skip granular date picking; just type into the input
    await page.getByLabel('Дедлайн').fill('15.06.2026 14:00')

    // Check at-deadline offset
    await page.getByRole('checkbox', { name: /в момент истечения/i }).check()

    // Submit
    await page.getByRole('button', { name: /создать/i }).click()

    // Chip rendered
    const chip = page.locator('[data-type="reminder"]').first()
    await expect(chip).toBeVisible()
    await expect(chip).toContainText(/2026/)
  })

  test('marking done turns the chip green and is reversible', async ({ page }) => {
    await signUpAndAuthAs(page, { email: `reminder-done-${Date.now()}@example.com`, firstName: 'R', lastName: 'T' })

    // Reach the editor (copy steps from the previous test or extract into a helper)
    await page.goto('/workspaces/new')
    await page.getByLabel('Название').fill('Reminder Done WS')
    await page.getByRole('button', { name: /создать/i }).click()
    await page.waitForURL(/\/workspaces\/[0-9a-f-]+/i)
    await page.getByRole('button', { name: /новая страница|\+/i }).first().click()
    await page.waitForURL(/\/workspaces\/[0-9a-f-]+\/pages\//i)

    const editor = page.locator('.ProseMirror').first()
    await editor.click()
    await editor.type('/reminder')
    await page.getByRole('option', { name: /напоминание/i }).click()
    await page.getByLabel('Дедлайн').fill('15.06.2026 14:00')
    await page.getByRole('checkbox', { name: /в момент истечения/i }).check()
    await page.getByRole('button', { name: /создать/i }).click()

    const chip = page.locator('[data-type="reminder"]').first()
    await expect(chip).toBeVisible()

    // Click chip to open the edit popover
    await chip.click()
    await page.getByRole('checkbox', { name: /выполнено/i }).check()

    // Chip text-decoration changes; assert the data-done-at attribute is now set
    await expect(chip).toHaveAttribute('data-done-at', /.+/)

    // Reopen, untoggle
    await chip.click()
    await page.getByRole('checkbox', { name: /выполнено/i }).uncheck()
    await expect(chip).not.toHaveAttribute('data-done-at', /.+/)
  })
})
```

- [ ] **Step 3: Run E2E**

Run:
```bash
pnpm exec playwright test apps/e2e/reminders.spec.ts
```

Expected: PASS for the golden-path test.

- [ ] **Step 4: Commit**

```bash
git add apps/e2e/reminders.spec.ts
git commit -m "test(e2e): /reminder slash command creates an inline chip"
```

---

## Task 19: Full gates

**Files:** none

- [ ] **Step 1: Run gates**

```bash
pnpm gates
```

Expected: PASS for check-types + lint + build + test across all workspaces.

- [ ] **Step 2: Fix any failures**

If gates fail:
- type errors → fix the source file, re-run the affected workspace's `check-types`
- lint errors → fix or run `pnpm format` for prettier issues
- test failures → diagnose, fix code or test, re-run

Repeat until gates pass cleanly. Do NOT bypass hooks with `--no-verify` (the project's CLAUDE.md forbids this).

- [ ] **Step 3: Verify worktree state**

Run:
```bash
git status --short && git log --oneline -10
```

Expected: clean tree, ~13 commits (`feat(db)`, `feat(notifications)`, etc.).

- [ ] **Step 4: Mark plan done**

Leave a final progress note in the conversation: "Plan complete; ready for review / merge."

---

## Self-review notes (for the reviewer)

- **Spec coverage:**
  - DB schema (spec §"Data model") ↔ Task 1
  - `REMINDER_DUE` event type + catalog ↔ Task 1 (enum) + Task 2 (descriptor)
  - `formatHumanOffset` ↔ Task 3
  - `rebuildDeliveries` / `cancelPendingDeliveries` ↔ Task 4
  - Email template (`reminder-due.ts`) ↔ Task 5
  - Dispatcher pre-fire validity check ↔ Task 6
  - tRPC `reminder.syncForPage` ↔ Task 7 (+ integration test in Task 8)
  - Tiptap schema ↔ Task 9
  - Color logic ↔ Task 10
  - React view ↔ Task 11
  - Slash command ↔ Task 12
  - Editor callback wiring ↔ Task 13
  - Popover UI ↔ Task 14
  - useReminderSync ↔ Task 15
  - Page-renderer wiring + anchor scroll ↔ Task 16
  - Manual smoke ↔ Task 17
  - E2E ↔ Task 18
  - Gates ↔ Task 19

- **Open implementation risks the executing engineer should watch:**
  - `@mui/x-date-pickers` may not be installed; Task 14 step 1 has a check.
  - The tRPC test helpers may not match the names in Task 8 (`createTestUser`/`createTestWorkspace`); the step explicitly says to adapt to the patterns in sibling test files.
  - `send-email.ts` shape may differ from the pseudo-code in Task 5 step 5; read the file and copy the existing dispatch pattern.
  - `crypto.randomUUID()` in Task 12 has a fallback for older environments — keep the fallback even if the project targets modern browsers.
