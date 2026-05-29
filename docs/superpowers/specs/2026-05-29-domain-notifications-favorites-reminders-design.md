# `@repo/domain` SP2 — Notifications + Favorites + Reminders — Design

**Status:** Implemented (branch `feat/domain-notif-fav-reminders`)
**Date:** 2026-05-29
**Scope:** Migrate the write business-logic for **Notifications**, **Favorites**, and **Reminders** into `@repo/domain`, and refactor **both** consumers — `@repo/trpc` procedures and the `apps/engines` MCP services — to call it. This collapses the duplicated/divergent implementations these three domains accumulated (each currently has a tRPC version *and* a separate engines direct-Prisma version) into one source of truth, and fixes the gaps that divergence created. This is **sub-project 2** of the `@repo/domain` initiative (see `[[domain-package-initiative]]`); **Pages/Search** is the remaining, larger cycle (SP3) and is explicitly out of scope here.

---

## Context

SP1 created `@repo/domain` (NodeNext-clean, deps `@repo/db` + `zod` only; `fn(prisma, actorUserId, input)` → result; throws `DomainError`; owns its own `prisma.$transaction`) and migrated the **Kanban** writes into it, with tRPC and a *greenfield* engines adapter both consuming it.

SP2 differs in one structural way that shapes the whole design: **every domain here already has two implementations** — a tRPC procedure *and* a divergent `apps/engines` MCP service built in Feature 1 as a separate direct-Prisma reimplementation. So SP2 is not "add an adapter on top of new domain logic"; it is "**extract the logic once, then refactor two existing divergent call-sites to share it**," fixing the bugs the divergence caused along the way.

### Current state (the duplication being collapsed)

| Domain | tRPC write surface | engines MCP surface | Gap created by divergence |
|---|---|---|---|
| **Notifications** | `notification.ts`: `markRead`, `markAllRead`, `deleteAll`, `setPreference` (marketing-consent check), `registerPushSubscription`, `revokePushSubscription` | `notification.service.ts` / `notification.tools.ts`: `list` + `markRead` only (a subset) | engines exposes only mark-read |
| **Favorites** | inside `page.ts`: `addFavorite`, `removeFavorite`, `reorderFavorites` | `favorite.service.ts` / `favorite.tools.ts`: `list` + `add` + `remove` | engines **missing `reorderFavorites`** |
| **Reminders** | `reminder.ts`: `syncForPage` (batch reconcile; validates recipients vs `workspaceMember`; calls `rebuildDeliveries`/`cancelPendingDeliveries` **inside** its `$transaction`) | `reminder.service.ts`: granular `createReminder`/`moveReminder`/`deleteReminder`/`completeReminder` — **never schedules delivery** | engines reminders silently get **no delivery schedule** (real bug) |

Coupling: Favorites + Reminders reference Pages (read-only); Reminders → Notifications delivery via `@repo/notifications`; Notifications is otherwise standalone.

## Principles (inherited from SP1, one addition)

- Domain functions are `fn(prisma, actorUserId, input)`, validate input with `zod` schemas exported from the domain, perform an access check as the first step, throw `DomainError { code, httpStatus, message }`, and own their own `prisma.$transaction` for multi-write operations.
- Domain emits no in-process events. Post-commit fire-and-forget events (e.g. `kanbanBus.emit`) remain a **caller** concern, exactly as in SP1. (Notifications/Favorites/Reminders have no in-process bus emits today, so there is nothing to thread.)
- **New in SP2 — transactional side-effects via Ports.** A side-effect that must be *atomic with the write* and lives in another package (Reminders' delivery-scheduling, which writes `notification_*` rows inside the same transaction) is modelled as an **injected port**: the domain defines a minimal interface, owns the transaction, and calls the injected implementation inside it. Callers inject the real implementation. The domain's dependency surface stays `@repo/db` + `zod`. This pattern is intended to generalize to Pages' outbox events in SP3.

## Architecture decisions

| Decision | Choice |
|---|---|
| Where write logic lives | `@repo/domain` modules `notifications/`, `favorites/`, `reminders/` |
| Reads | Stay direct-Prisma in each consumer (engines read services + tRPC queries), as in SP1 — only **writes** move to the domain |
| Reminders delivery-scheduling | **Ports / injection**: domain defines `DeliveryScheduler`; callers inject `@repo/notifications`'s `rebuildDeliveries`/`cancelPendingDeliveries` |
| `ReminderForRebuild` type | **Re-declared in `@repo/domain`** (plain data) so the domain does not import `@repo/notifications`; structural typing lets callers inject the raw functions with zero adapter code |
| Error mapping | Reuse `mapDomain` (tRPC → `TRPCError`) and `mapDomainError` (engines → `HttpException`) from SP1 |
| Scopes | Reuse existing `notifications:*` / `favorites:*` / `reminders:*` (granted + drift-guarded since Feature 1). **No new scopes.** New tools reuse existing scopes |

## Domain modules

### `domain/notifications` (mechanical — pure SP1 pattern)

Migrate the three **dependency-free, dedup-worthy** mutations into `domain/notifications`: `markRead` (the only one duplicated across tRPC + engines), `markAllRead`, and `deleteAll`. All are user-scoped (operate on the actor's own `notificationInApp` rows). Pure `db` + `zod`; no ports.

**Deliberately NOT migrated (stay in tRPC):** `setPreference` and `registerPushSubscription` / `revokePushSubscription`. Rationale (discovered during planning): they are **tRPC-only — not duplicated** in engines, so migrating them yields no single-source-of-truth payoff (YAGNI); and `setPreference` validates against `EVENT_CATALOG`, which lives in `@repo/notifications` (Bundler). Importing it into `@repo/domain` would break the package's `db`+`zod`-only purity — the exact thing that makes it engines-consumable. They remain in `notification.ts` unchanged.

- **tRPC**: `markRead` / `markAllRead` / `deleteAll` become thin wrappers — `mapDomain(() => domain.<fn>(ctx.prisma, ctx.user.id, input))`. The other three procedures are untouched.
- **engines**: `notification.service.markRead` delegates to `domain.markRead` (ids path) / `domain.markAllRead` (all path). **Gap-fix:** add a `markAllRead` MCP tool (agent-useful: "mark all my notifications read"), reusing the existing `notifications:write` scope.

### `domain/favorites` (mechanical — pure SP1 pattern)

Extract `addFavorite` / `removeFavorite` / `reorderFavorites` out of `page.ts` into `domain/favorites` (user+page-scoped: the page must exist in a workspace the actor belongs to). Pure `db` + `zod`; no ports. **Reconciliation (discovered during planning):** tRPC seeds the first favorite at position `(_max ?? -1) + 1 = 0` while engines used `(_max ?? 0) + 1 = 1` — a latent off-by-one. The domain adopts the **tRPC 0-based** rule (consistent with `reorderFavorites`, which assigns positions by 0-based index). The tRPC `requireWritableWorkspace` gate stays in the tRPC wrapper (engines stays membership-only, as today) — only the position/upsert core is shared.

- **tRPC**: the three favorite procedures in `page.ts` become wrappers (they stay physically in `page.ts`; only their bodies delegate).
- **engines**: `favorite.service.add`/`remove` delegate to domain. **Gap-fix:** add the missing `reorderFavorites` MCP tool delegating to `domain.reorderFavorites`.

### `domain/reminders` (the nuanced one — Ports)

Hosts **both** API shapes over one invariant-preserving core, so each consumer keeps its natural surface while sharing logic:

- **Batch** — `syncReminders(prisma, actorUserId, { pageId, reminders }, scheduler)` for tRPC's `syncForPage`. The recipient-validation against `workspaceMember` (currently in the tRPC procedure) moves into the domain so both shapes enforce it.
- **Granular** — `createReminder` / `moveReminder` / `deleteReminder` / `completeReminder` for engines.

Every write that changes timing, recipients, or done-state calls the injected scheduler **inside the domain's transaction**. Routing engines' granular ops through these functions **automatically fixes the delivery bug**, because the domain function — not the caller — performs the scheduling.

```ts
// domain/reminders/ports.ts — plain data; no @repo/notifications import
export interface ReminderForRebuild {
  id: string
  pageId: string
  workspaceId: string
  createdById: string | null
  dueAt: Date
  offsets: number[]
  audience: 'ME' | 'WORKSPACE' | 'LIST'
  label: string | null
  recipients: string[]
  doneAt: Date | null
}

export interface DeliveryScheduler {
  rebuild(tx: Prisma.TransactionClient, r: ReminderForRebuild): Promise<void>
  cancel(tx: Prisma.TransactionClient, reminderIds: string[], reason: string): Promise<void>
}
```

Because TypeScript is structural and the shapes match `@repo/notifications` exactly, callers inject with **zero adapter**:

```ts
import { rebuildDeliveries, cancelPendingDeliveries } from '@repo/notifications'
const scheduler = { rebuild: rebuildDeliveries, cancel: cancelPendingDeliveries }
// tRPC:    domain.syncReminders(ctx.prisma, ctx.user.id, input, scheduler)
// engines: domain.createReminder(prisma, userId, input, scheduler)   (etc.)
```

## Consumer wiring

- **tRPC** (`@repo/trpc`): `notification.ts`, the favorites procedures in `page.ts`, and `reminder.ts` become thin wrappers. `reminder.ts` keeps importing `@repo/notifications` (Bundler→Bundler) and injects the scheduler.
- **engines** (`apps/engines`): the existing read services stay direct-Prisma. The write services (`notification.service`, `favorite.service`, `reminder.service`) delegate to `domain.*`. `reminder.service` imports `rebuildDeliveries`/`cancelPendingDeliveries` from `@repo/notifications` and injects them. Two new `@Tool` methods are added (`markAllRead`, `reorderFavorites`) reusing existing scopes. `@repo/domain` is already an engines dependency (SP1); `@repo/notifications` is already an engines dependency (the notifier cron).

## Testing

- **Domain unit tests** (mocked Prisma): each function's validation, access guard, Prisma ops, and `DomainError` conditions. For reminders, a **fake `DeliveryScheduler`** asserts `rebuild`/`cancel` are called with the correct `ReminderForRebuild` data inside the transaction.
- **tRPC suites stay green** — the existing notification/reminder/page-favorite tests are the regression guard; ports are verbatim so messages/behavior match.
- **engines service tests** — real-domain + mocked-Prisma (+ a stub scheduler), the SP1 approach.
- **Capstone integration test** (`apps/engines/test/integration/*.e2e.spec.ts`, live Postgres): engines `createReminder` → domain → injected **real** `@repo/notifications` → assert `notification_deliveries` rows are created. This proves the engines delivery bug is fixed end-to-end.

## Risk to validate first

`@repo/notifications` is `moduleResolution: Bundler` with raw-`.ts` exports. Engines (NodeNext) must import its delivery functions to inject them. Engines already imports `@repo/notifications/worker` cleanly (gates green on `main`), so the root export almost certainly type-checks too — but **the first task validates** `import { rebuildDeliveries } from '@repo/notifications'` under `pnpm --filter engines check-types`. If it trips TS2835, the bounded fallback is converting `@repo/notifications` to NodeNext-clean (explicit `.ts` extensions, `moduleResolution` like `@repo/db`), which also fixes its latent Bundler+raw-`.ts` mismatch. Resolving this gate is a prerequisite for the Reminders work.

## Build order (within SP2)

1. **Validate the `@repo/notifications` import risk** (above) before anything reminders-related.
2. **Notifications** — domain module + tRPC wrappers + engines delegation + `markAllRead` tool.
3. **Favorites** — domain module + tRPC wrappers + engines delegation + `reorderFavorites` tool.
4. **Reminders** — domain module + `DeliveryScheduler` port + tRPC `syncForPage` wrapper + engines delegation (bug fix) + capstone integration test.
5. **Verify** — `agents-token` drift-guard unchanged (no new scopes), full `pnpm gates`, mark spec Implemented.

Each domain is independently green; Notifications + Favorites prove the refactor-both-consumers flow before Reminders adds the port.

## Out of scope

- **Pages / Search** migration (SP3) — the largest domain, deepest in the dependency chain.
- Converting `@repo/notifications` to NodeNext-clean **unless** the risk-validation task shows engines can't import its root export (then it becomes an in-scope prerequisite).
- Any new agent capability beyond the two gap-fix tools; any change to delivery semantics, notification preferences UX, or the dispatcher worker.
