# Phase 7A — Outbound Webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Developer-platform-style outbound webhook subscriptions per `docs/superpowers/specs/2026-06-10-outbound-webhooks-design.md`: HMAC-signed HTTPS delivery with challenge verification, retries/backoff, delivery logs, auto-disable, a TEAM-visibility no-leak gate, and an admin+plan-gated settings UI.

**Architecture:** Domain mutations enqueue `webhook_event` outbox rows (second row alongside the indexing one). A new **`@repo/webhooks`** package (Tier-2 sibling of `@repo/notifications`: deps `@repo/db` + `@repo/auth`) holds the catalog, secret/HMAC helpers, SSRF guard, fan-out tick, delivery tick, and the challenge sender — all vitest-real-DB-tested so the merge gates cover them. `apps/engines` gains a thin `WebhookModule` cron wiring the ticks (the notifier pattern). `packages/trpc` gains the `webhook` router (OWNER/ADMIN + `developerSpaceEnabled`; synchronous challenge on create/verify — the MCP `validateMcp` precedent). `apps/web` gains the «Вебхуки» settings section.

---

## Worker ground rules (every task)

- Worktree: `/Users/victor/.config/superpowers/worktrees/anynote/notion-phase-7a-webhooks`, branch `feat/notion-phase-7a-webhooks`. Commands from the worktree root.
- Prettier semi:false single quotes 100-char. **Never `git add -A`** (untracked `cl*.md` at repo root). Conventional Commits; one commit per task with the given message. Real-DB tests need postgres (up).
- READ the cited template files before writing — they are committed code, not summaries:
  - Outbox helpers + `OutboxAggregateType` ('page'|'file'): `packages/db/src/index.ts:121-161`.
  - The 14 emission call sites: `packages/domain/src/pages/repositories/pages.repository.ts` — createPageTx(:231 enqueue), createItemPageTx(:298), archivePageTx(:317), unarchivePageTx(:335), moveToCollectionTx(:381), renamePageTx(:404), updatePageTx(:431), duplicatePageTx(:481), movePageTx(:545), reorderPageTx(:608), softDeletePageTx(:670), restorePageTx(:752), hardDeletePageTx(:787), emptyTrashTx(:806).
  - Worker package template: `packages/notifications/` (package.json exports map incl. `./worker`, `src/worker/lock.ts` SKIP-LOCKED claim, `src/worker/dispatcher.ts` backoff `60s*2^attempts` cap 30min, vitest + test setup).
  - Engines cron template: `apps/engines/src/apps/notifier/` (module + cron service), `apps/engines/src/apps/indexer/cron/vectorization-cron.service.ts` (outbox claim SQL :90-114, markFailedOrRetry :217-239), `apps/engines/src/app.module.ts`, PRISMA provider `apps/engines/src/infra/db/db.providers.ts` (@Global DbModule).
  - Secret encryption: `packages/auth/src/secret-encryption.ts` (encryptSecret/decryptSecret/EncryptedPayload; AES-256-GCM; `SECRETS_ENCRYPTION_KEY`); usage precedent `packages/trpc/src/routers/ai-provider.ts:56-66,144-153`.
  - Secret-bearing create + base62: `packages/trpc/src/routers/api-key.ts` + `packages/trpc/src/services/api-key.ts` (toBase62, return-once pattern).
  - Role gating: local `assertRole` pattern `packages/trpc/src/routers/mcp-server.ts:39-51` + plan-flag gate `:235-242` (`getWorkspaceFeatures` → `customMcpEnabled` FORBIDDEN). Webhooks use `developerSpaceEnabled`.
  - Settings UI template: `apps/web/src/components/workspace/settings/mcp-section.tsx` + the dialog items array `workspace-settings-dialog.tsx:37-186` (`show: features.<flag>`, `isOwner` prop, `roleQ.data` in scope).
  - Real-DB router-test harness with role fixtures: `packages/trpc/test/database-router.test.ts:54-128` + `job-router.test.ts` (ensurePersonalPlan upsert).
  - Comment procedures (emission sites): `packages/trpc/src/routers/comment.ts` createThread(:254-319), addComment(:321-356), resolveThread(:430-448) — note `publicProcedure` + `resolveCommentContext` gives `c.pageId/c.workspaceId/c.author`.
  - yjs content saves: `apps/yjs/src/persistence.ts` (storePageDocument + the 10-min revision throttle — `page.content_updated` piggybacks it).
- New-package checklist (Task 2): pnpm workspace picks `packages/*` automatically; copy `@repo/notifications`' tsconfig/vitest/test-setup style; **check `.dependency-cruiser.cjs`** — if tiers enumerate package names, add `@repo/webhooks` at the notifications tier (verify with `pnpm check-architecture` before committing); web does NOT depend on it (no transpilePackages change); `packages/trpc` and `apps/engines` add it as `workspace:*`.
- New env vars (Task 8): `WEBHOOK_CRON_EXPRESSION`, `WEBHOOK_BATCH_SIZE`, `WEBHOOK_MAX_ATTEMPTS`, `WEBHOOK_TIMEOUT_MS` → BOTH `.env.example` AND `turbo.json globalEnv` (the two-place rule; deploy templates are out of scope, flag in the PR text).

### Plan-level refinements vs the spec (intentional)

1. Worker logic lives in `@repo/webhooks` (not engines-local) so the vitest real-DB suites run inside `pnpm gates` — engines unit tests are mock-only and `test-int` is outside the gates.
2. `page.content_updated` emits from `apps/yjs` persistence at the existing 10-minute revision throttle (the only real content-save site; the spec's caveat about coalescing becomes a precise guarantee). Import-path content writes (apps/web processors) do NOT emit in 7A — documented.
3. Endpoint verification is SYNCHRONOUS inside `create`/`verify`/url-change (10s timeout, the MCP validateMcp precedent) — no verification rows in WebhookDelivery; the result decides PENDING/ACTIVE before the mutation returns.
4. `createItemPageTx` (database item pages) emits NO webhook events at all (cheaper than emit-then-drop); the fan-out's parent-is-DATABASE check stays as the defense-in-depth authority for any other path.

---

## Task 1: Schema — WebhookSubscription + WebhookDelivery

**Files:** `packages/db/prisma/schema.prisma`; migration `20260611090000_webhooks`.

- [ ] **Step 1:** Append (id convention `gen_random_uuid()`, snake_case maps, Timestamptz(6)):

```prisma
enum WebhookSubscriptionStatus {
  PENDING
  ACTIVE
  DISABLED
  FAILED
}

enum WebhookDeliveryStatus {
  PENDING
  PROCESSING
  DELIVERED
  FAILED
}

model WebhookSubscription {
  id                    String                    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId           String                    @map("workspace_id") @db.Uuid
  createdById           String                    @map("created_by_id") @db.Uuid
  name                  String                    @db.VarChar(100)
  url                   String                    @db.Text
  secretEnc             Json                      @map("secret_enc")
  events                String[]
  status                WebhookSubscriptionStatus @default(PENDING)
  payloadVersion        Int                       @default(1) @map("payload_version")
  verificationChallenge String?                   @map("verification_challenge") @db.VarChar(64)
  verifiedAt            DateTime?                 @map("verified_at") @db.Timestamptz(6)
  consecutiveFailures   Int                       @default(0) @map("consecutive_failures")
  createdAt             DateTime                  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt             DateTime                  @updatedAt @map("updated_at") @db.Timestamptz(6)

  workspace  Workspace         @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  createdBy  User              @relation("WebhookSubscriptionCreatedBy", fields: [createdById], references: [id], onDelete: Cascade)
  deliveries WebhookDelivery[]

  @@index([workspaceId, status])
  @@map("webhook_subscriptions")
}

model WebhookDelivery {
  id              String                @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  subscriptionId  String                @map("subscription_id") @db.Uuid
  eventType       String                @map("event_type") @db.VarChar(64)
  eventId         String                @map("event_id") @db.Uuid
  payload         Json
  status          WebhookDeliveryStatus @default(PENDING)
  attempts        Int                   @default(0)
  nextAttemptAt   DateTime              @default(now()) @map("next_attempt_at") @db.Timestamptz(6)
  lockedAt        DateTime?             @map("locked_at") @db.Timestamptz(6)
  lockedBy        String?               @map("locked_by") @db.VarChar(64)
  responseStatus  Int?                  @map("response_status")
  responseSnippet String?               @map("response_snippet") @db.VarChar(500)
  latencyMs       Int?                  @map("latency_ms")
  lastError       String?               @map("last_error") @db.Text
  createdAt       DateTime              @default(now()) @map("created_at") @db.Timestamptz(6)

  subscription WebhookSubscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)

  @@index([status, nextAttemptAt])
  @@index([subscriptionId, createdAt])
  @@map("webhook_deliveries")
}
```

Reverse relations: `Workspace.webhookSubscriptions WebhookSubscription[]`; `User.webhookSubscriptions WebhookSubscription[] @relation("WebhookSubscriptionCreatedBy")`. `prisma validate`.

- [ ] **Step 2:** Migration via the established diff flow (Prisma 7.7 `--from-schema/--to-schema`; strip stray log lines):
```bash
git show HEAD:packages/db/prisma/schema.prisma > /tmp/schema-before-7a.prisma
mkdir -p packages/db/prisma/migrations/20260611090000_webhooks
pnpm --filter @repo/db exec prisma migrate diff --from-schema /tmp/schema-before-7a.prisma --to-schema prisma/schema.prisma --script > packages/db/prisma/migrations/20260611090000_webhooks/migration.sql
```
Inspect: 2 CREATE TYPE + 2 CREATE TABLE + indexes + FKs, purely additive — else STOP.

- [ ] **Step 3:** Apply via `docker exec -i anynote-postgres-1 psql -U <user> -d <db> -v ON_ERROR_STOP=1 --single-transaction < migration.sql` (creds from `.env`), then `migrate resolve --applied 20260611090000_webhooks`, `prisma:generate`. Verify `\d webhook_subscriptions` + the ledger row (ignore pre-existing foreign drift).

- [ ] **Step 4 — commit:**
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260611090000_webhooks
git commit -m "feat(db): webhook subscription + delivery models"
```

---

## Task 2: `@repo/webhooks` package — catalog, secrets, HMAC, SSRF, payload (pure, TDD)

**Files:** Create `packages/webhooks/{package.json,tsconfig.json,vitest.config.ts,test/setup.ts}`, `src/{index.ts,catalog.ts,secret.ts,signature.ts,ssrf.ts,payload.ts}`; tests `test/{catalog,secret,signature,ssrf,payload}.test.ts`. Possibly modify `.dependency-cruiser.cjs`.

- [ ] **Step 1 — scaffold.** Copy `packages/notifications/package.json` shape: name `@repo/webhooks`, deps `@repo/db workspace:*`, `@repo/auth workspace:*`; devDeps eslint/ts configs + vitest; exports map `{".": src/index.ts, "./worker": src/worker/index.ts}` (worker added in Tasks 4-5); scripts test/lint/check-types matching notifications. tsconfig: copy notifications' (NodeNext). vitest.config + test/setup.ts: copy notifications'/trpc's root-.env loader. Run `pnpm install`. Then `pnpm check-architecture` — if it fails on the unknown package, add `@repo/webhooks` to `.dependency-cruiser.cjs` at the same tier as `@repo/notifications` (read the file; mirror notifications' entries exactly).

- [ ] **Step 2 — failing tests, then implement:**

`catalog.ts`:
```ts
export const WEBHOOK_EVENT_TYPES = [
  'page.created',
  'page.content_updated',
  'page.properties_updated',
  'page.moved',
  'page.deleted',
  'page.undeleted',
  'comment.created',
  'comment.resolved',
] as const
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number]
export function isWebhookEventType(v: string): v is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(v)
}
/** Documented-but-not-yet-emitted (the 7C portal lists them as «скоро»). */
export const COMING_EVENT_TYPES = ['collection.created', 'collection.updated', 'database.row_changed'] as const
```
Test: shape + isWebhookEventType true/false.

`secret.ts` — `generateWebhookSecret(): string` returning `whsec_` + 32 base62 (copy the `toBase62` from `packages/trpc/src/services/api-key.ts`, 24 random bytes → 32 chars) and `generateChallenge(): string` (32 base62). Test: format regex + uniqueness + length.

`signature.ts`:
```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

/** sha256 HMAC over `{timestamp}.{body}` — the documented signature base. */
export function signWebhookPayload(secret: string, timestampSec: number, body: string): string {
  const mac = createHmac('sha256', secret).update(`${timestampSec}.${body}`).digest('hex')
  return `sha256=${mac}`
}

/** Consumer-side verification helper (documented in 7C; also used in tests). */
export function verifyWebhookSignature(
  secret: string,
  timestampSec: number,
  body: string,
  signature: string,
): boolean {
  const expected = signWebhookPayload(secret, timestampSec, body)
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}
```
Test: known-vector format `sha256=<64 hex>`; verify roundtrip true; tampered body/timestamp/secret false.

`ssrf.ts` — pure + injectable lookup:
```ts
import { lookup as dnsLookup } from 'node:dns/promises'

export type LookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>

const defaultLookup: LookupFn = (h) => dnsLookup(h, { all: true, verbatim: true })

export function isBlockedAddress(address: string, family: number): boolean { /* …see below */ }

export class SsrfBlockedError extends Error {}

/** HTTPS-only + resolve the host and refuse private/loopback/link-local/CGN/metadata ranges. */
export async function assertSafeWebhookUrl(rawUrl: string, lookup: LookupFn = defaultLookup): Promise<void>
```
`isBlockedAddress` blocks IPv4: 0.0.0.0/8, 10/8, 127/8, 100.64/10, 169.254/16, 172.16/12, 192.168/16, plus any literal `169.254.169.254`; IPv6: `::`, `::1`, `fc00::/7`, `fe80::/10`, `::ffff:`-mapped IPv4 (recurse into the mapped v4). `assertSafeWebhookUrl`: parse URL (throw SsrfBlockedError('Только https:// адреса') unless protocol https:), reject userinfo, if the hostname is an IP literal classify directly, else lookup ALL addresses and reject if ANY is blocked (DNS failure → SsrfBlockedError). Tests: each blocked range (v4+v6+mapped), public IP passes, https enforced, http rejected, injectable-lookup fake returning a private IP for a public-looking hostname → blocked, multi-A-record with one private → blocked.

`payload.ts`:
```ts
export type WebhookEventInput = {
  eventId: string
  event: string
  workspaceId: string
  actorId: string | null
  resourceType: 'page' | 'comment'
  resourceId: string
  hints?: Record<string, unknown>
  occurredAt: Date
}

const FORBIDDEN_KEYS = ['title', 'content', 'body', 'text', 'name'] as const

export function buildWebhookPayload(input: WebhookEventInput): Record<string, unknown>
export function assertNoForbiddenKeys(payload: unknown): void  // deep-walks; throws on any forbidden key
```
`buildWebhookPayload` returns exactly `{version: 1, id, event, timestamp: occurredAt.toISOString(), workspaceId, actor: {id: actorId}, resource: {type, id}, hints: hints ?? {}}` AND calls `assertNoForbiddenKeys` on the result (hints are caller-controlled — the assertion is the regression net). Tests: shape; a hints object smuggling `{title: 'x'}` THROWS; nested forbidden key throws; clean hints pass.

`index.ts` re-exports all of the above.

- [ ] **Step 3:** `pnpm --filter @repo/webhooks test` (~18 tests green), lint, check-types, `pnpm check-architecture`. **Step 4 — commit:**
```bash
git add packages/webhooks .dependency-cruiser.cjs pnpm-lock.yaml
git commit -m "feat(webhooks): package scaffold — catalog, secrets, hmac, ssrf guard, payload builder"
```
(include .dependency-cruiser.cjs only if touched)

---

## Task 3: Event emission — helper + 12 page sites + comments + yjs content

**Files:** Modify `packages/db/src/index.ts`, `packages/domain/src/pages/repositories/pages.repository.ts`, `packages/trpc/src/routers/comment.ts`, `apps/yjs/src/persistence.ts`.

- [ ] **Step 1 — helper in `packages/db/src/index.ts`:** widen the union and add the emit helper next to `enqueueOutboxEvent`:

```ts
export type OutboxAggregateType = 'page' | 'file' | 'webhook_event'

export interface EnqueueWebhookEventArgs {
  event: string // e.g. 'page.moved' — @repo/webhooks owns the catalog; db stays untyped
  resourceType: 'page' | 'comment'
  resourceId: string
  workspaceId: string
  actorId?: string | null
  hints?: Prisma.InputJsonValue
}

/** Second outbox row for webhook fan-out (the indexer only reads aggregate_type='page'). */
export async function enqueueWebhookEvent(
  tx: Prisma.TransactionClient,
  args: EnqueueWebhookEventArgs,
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      eventType: args.event,
      aggregateType: 'webhook_event',
      aggregateId: args.resourceId,
      workspaceId: args.workspaceId,
      payload: {
        resourceType: args.resourceType,
        actorId: args.actorId ?? null,
        hints: args.hints ?? {},
      },
    },
  })
}
```

- [ ] **Step 2 — page repository sites.** In `pages.repository.ts`, directly after each existing `enqueueOutboxEvent` call, add the webhook emission with the derived event (import `enqueueWebhookEvent` from `@repo/db`; same `this.uow.client() as Prisma.TransactionClient` tx; `actorUserId` is in scope at every site):

| Method | event | hints |
|---|---|---|
| createPageTx | `page.created` | `{}` |
| createItemPageTx | — NONE (db item pages; comment why) | |
| archivePageTx | `page.properties_updated` | `{ changed: ['archivedAt'] }` |
| unarchivePageTx | `page.properties_updated` | `{ changed: ['archivedAt'] }` |
| moveToCollectionTx | `page.moved` | `{ scope: 'collection' }` |
| renamePageTx | `page.properties_updated` | `{ changed: ['title'] }` (+`'icon'` when `input.icon !== undefined`) |
| updatePageTx | `page.properties_updated` | `{ changed: [...keys actually present in input] }` |
| duplicatePageTx | `page.created` | `{ duplicatedFrom: <source page id> }` |
| movePageTx | `page.moved` | `{ to: input.newParentId ?? null }` |
| reorderPageTx | `page.moved` | `{ to: input.newParentId ?? null }` |
| softDeletePageTx | `page.deleted` | `{}` |
| restorePageTx | `page.undeleted` | `{}` |
| hardDeletePageTx | `page.deleted` | `{ hard: true }` |
| emptyTrashTx | `page.deleted` per page in the loop | `{ hard: true }` |

`workspaceId` and the page id mirror the adjacent indexing enqueue. KEEP the existing enqueues untouched.

- [ ] **Step 3 — comment emissions.** In `packages/trpc/src/routers/comment.ts` (read the three procedures first): after the comment/thread write succeeds in `createThread` and `addComment`, enqueue `comment.created`; in `resolveThread` after the update, `comment.resolved`. These run OUTSIDE a domain transaction — call `enqueueWebhookEvent(ctx.prisma as unknown as Prisma.TransactionClient, {...})` (TransactionClient is structurally a subset of PrismaClient — the create call works; add a one-line comment). Fields: `resourceType: 'comment'`, `resourceId: c.pageId` (the PAGE id — the visibility gate resolves pages; the comment ids ride in hints), `workspaceId: c.workspaceId`, `actorId: c.author.userId ?? null`, hints `{ threadId, commentId }` / `{ threadId, resolved: true }`. NOTE: comments can come from anonymous share-link users — `actorId` null is fine; the event still concerns a page whose visibility the fan-out gates.

- [ ] **Step 4 — yjs content saves.** In `apps/yjs/src/persistence.ts` `storePageDocument`: inside the EXISTING 10-minute revision-throttle branch (where `captureContentRevision` fires), also `prisma.outboxEvent.create` a `webhook_event` row (`event page.content_updated`, resourceType page, actorId null — the yjs server doesn't know the actor; hints `{}`). Use a direct create matching `enqueueWebhookEvent`'s shape (apps/yjs may import the helper from `@repo/db` if its tsconfig allows — prefer the helper; verify the import compiles). Comment: collab edits coalesce at the revision throttle (≥10 min).

- [ ] **Step 5 — verify:** `pnpm --filter @repo/domain test` (593 — the repo tests mock uow clients; if any asserts exact call counts on outboxEvent.create, update those expectations — that IS a legitimate behavior change), `pnpm --filter @repo/trpc test`, `pnpm --filter @repo/yjs-server check-types` (or its test script if present), `pnpm check-types`. **Step 6 — commit:**
```bash
git add packages/db/src/index.ts packages/domain/src/pages/repositories/pages.repository.ts packages/trpc/src/routers/comment.ts apps/yjs/src/persistence.ts
git commit -m "feat(domain): webhook_event outbox emissions for page lifecycle, comments, content saves"
```
(plus any updated domain test files)

---

## Task 4: Fan-out tick (`@repo/webhooks/worker`, real-DB TDD)

**Files:** Create `packages/webhooks/src/worker/{index.ts,fan-out.ts}`; Test `packages/webhooks/test/fan-out.test.ts`.

- [ ] **Step 1 — failing tests** (real DB; email-suffix harness `+webhook-fanout-test@anynote.dev` copied from `packages/trpc/test/database-router.test.ts`; cleanFixtures deletes webhookDelivery/webhookSubscription/outboxEvent(workspace-scoped)/pages/collections/members/workspaces/users; seed: owner + workspace + TEAM collection + a TEAM page + a PERSONAL collection (owner-owned) + a personal page + an ACTIVE subscription `{events: ['page.created','page.moved','comment.created'], status ACTIVE, secretEnc: encryptSecret('whsec_test')}`; SECRETS_ENCRYPTION_KEY comes from root .env — if absent in .env, set a base64 32-byte value in test setup BEFORE imports). Cases (6):
  1. A `webhook_event` outbox row (`page.created`, the TEAM page) → exactly one PENDING WebhookDelivery for the subscription; payload shape matches `buildWebhookPayload` (version 1, ids, NO title keys); outbox row DONE.
  2. PERSONAL-collection page event → ZERO deliveries, outbox DONE (the no-leak invariant).
  3. Event type not in `subscription.events` → zero deliveries.
  4. PENDING/DISABLED/FAILED subscriptions get nothing (only ACTIVE).
  5. A page whose parent is a DATABASE page → zero deliveries (item-page defense).
  6. `page.deleted` for a TRASHED team page still fans out (the deletion event itself passes); but `page.created` for an already-trashed page does not.

- [ ] **Step 2 — implement `fan-out.ts`:**
```ts
export type FanOutOpts = { workerId: string; batchSize: number }
export async function runFanOutTick(prisma: PrismaClient, opts: FanOutOpts): Promise<void>
```
Claim: `$transaction` + raw `SELECT id, event_type, aggregate_id, workspace_id, payload FROM outbox_events WHERE status='PENDING' AND next_attempt_at <= now() AND aggregate_type='webhook_event' ORDER BY id LIMIT ${batch} FOR UPDATE SKIP LOCKED` then mark PROCESSING (the vectorization-cron pattern WITHOUT the dedup collapse — every event delivers). Per row (Promise.allSettled): load ACTIVE subscriptions `{workspaceId, status: 'ACTIVE', events: {has: eventType}}`; none → DONE. Visibility gate for `resourceType page` (and comments — gate on the page id): load the page with collection kind + parent type + deletedAt; pass iff collection kind TEAM or collectionId null, parent (if any) not DATABASE, and (deletedAt null OR eventType === 'page.deleted'). Fail gate → DONE, zero rows. Pass → `createMany` WebhookDelivery rows `{subscriptionId, eventType, eventId: randomUUID(), payload: buildWebhookPayload({...from row + payload.actorId/hints, occurredAt: row.created_at})}`. Errors → markFailedOrRetry (copy the vectorization SQL backoff). NOTE eventId: generate ONE per outbox row (same id across subscriptions — it identifies the EVENT; consumers dedupe by it). `worker/index.ts` exports runFanOutTick (+ runDeliveryTick after Task 5).

- [ ] **Step 3:** tests green; lint/check-types. **Step 4 — commit:**
```bash
git add packages/webhooks
git commit -m "feat(webhooks): fan-out tick with team-visibility no-leak gate"
```

---

## Task 5: Delivery tick (injected fetch, real-DB TDD)

**Files:** Create `packages/webhooks/src/worker/deliver.ts` (+export from worker/index); Test `packages/webhooks/test/deliver.test.ts`.

- [ ] **Step 1 — failing tests** (same harness; a fake fetch `vi.fn()` + fake lookup injected; seed an ACTIVE subscription + PENDING deliveries). Cases (8):
  1. Happy path: fetch called once with the subscription URL; body = JSON.stringify(delivery.payload); headers `X-AnyNote-Signature` verifying via `verifyWebhookSignature` against the DECRYPTED secret + the sent `X-AnyNote-Timestamp`, plus `X-AnyNote-Event`/`X-AnyNote-Delivery`/`X-AnyNote-Payload-Version: 1`/`Content-Type: application/json`; 200 → DELIVERED with responseStatus/latencyMs set, consecutiveFailures reset to 0.
  2. 500 response → attempts=1, status PENDING, nextAttemptAt ≈ now+60s (backoff base), responseStatus 500 + snippet recorded.
  3. attempts reaching maxAttempts → FAILED + subscription.consecutiveFailures incremented.
  4. consecutiveFailures reaching 10 → subscription status FAILED; fan-out then skips it (assert no new deliveries for a fresh event).
  5. SSRF: lookup resolving to 10.0.0.5 → terminal FAILED `lastError` mentions blocked, no fetch call, counts toward consecutiveFailures.
  6. Send-time visibility re-check: page moved to a PERSONAL collection after enqueue → terminal FAILED `'resource no longer workspace-visible'`, no fetch, does NOT increment consecutiveFailures.
  7. Timeout (fetch rejects AbortError) → retry scheduling like a 500.
  8. Response snippet truncated to 500 chars.

- [ ] **Step 2 — implement `deliver.ts`:**
```ts
export type DeliverOpts = {
  workerId: string
  batchSize: number
  maxAttempts: number
  timeoutMs: number
  fetchFn?: typeof fetch
  lookup?: LookupFn
  autoDisableThreshold?: number // default 10
}
export async function runDeliveryTick(prisma: PrismaClient, opts: DeliverOpts): Promise<void>
```
Claim PENDING past nextAttemptAt with lock (copy `packages/notifications/src/worker/lock.ts` onto webhook_deliveries). Per delivery: load delivery + subscription; subscription not ACTIVE → terminal FAILED ('subscription inactive', no counter); send-time re-check (same gate as fan-out, via payload.resource.id; `page.deleted` events skip the deletedAt check); `assertSafeWebhookUrl(url, lookup)`; decryptSecret(subscription.secretEnc); timestamp = `Math.floor(Date.now()/1000)`; sign; fetch with AbortSignal.timeout(timeoutMs); record responseStatus/snippet/latency. Success (2xx) → DELIVERED + reset consecutiveFailures (only when >0). Failure → backoff `60s*2^attempts` cap 30min; terminal → FAILED + `subscription.update({ consecutiveFailures: {increment:1}, ...(reaching threshold ? {status:'FAILED'} : {}) })` — read-modify carefully (increment then check value via updated row). SSRF/visibility terminals as specified in Step 1. All DB writes clear locks.

- [ ] **Step 3:** tests green (14 total in the package by now ≥); lint/check-types/check-architecture. **Step 4 — commit:**
```bash
git add packages/webhooks
git commit -m "feat(webhooks): hmac delivery tick — ssrf guard, backoff, auto-disable, logs"
```

---

## Task 6: Challenge sender + tRPC `webhook` router

**Files:** Create `packages/webhooks/src/challenge.ts` (+index export), `packages/trpc/src/routers/webhook.ts`; Modify `packages/trpc/src/index.ts` (mount `webhook:`), `packages/trpc/package.json` (+`@repo/webhooks workspace:*`); Test `packages/webhooks/test/challenge.test.ts`, `packages/trpc/test/webhook-router.test.ts`.

- [ ] **Step 1 — challenge sender** (`challenge.ts`, TDD with injected fetch/lookup):
```ts
export type ChallengeResult = { ok: boolean; error?: string }
export async function sendVerificationChallenge(args: {
  url: string
  secret: string
  challenge: string
  subscriptionId: string
  timeoutMs?: number
  fetchFn?: typeof fetch
  lookup?: LookupFn
}): Promise<ChallengeResult>
```
POSTs `{type:'verification', challenge, subscriptionId}` signed exactly like a delivery (`X-AnyNote-Event: verification`, same signature headers); ok iff 2xx AND the response body's first 4096 chars contain the challenge string. SSRF guard applies. Tests (4): success; echo missing → ok:false; non-2xx → ok:false; blocked host → ok:false with error.

- [ ] **Step 2 — router** (`webhook.ts`). Local `assertRole(ctx, workspaceId, ['OWNER','ADMIN'])` (copy mcp-server.ts:39-51) + plan gate (`getWorkspaceFeatures` → `developerSpaceEnabled` else FORBIDDEN 'DEVELOPER_SPACE_NOT_IN_PLAN') — both run in EVERY procedure. Procedures (spec §7):
  - `create({workspaceId, name 1..100, url, events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1)})`: https-prefix quick-check (BAD_REQUEST «Только https://»), ≤20 subscriptions per workspace (BAD_REQUEST), `generateWebhookSecret()` + `generateChallenge()`, `encryptSecret(secret)`, create row (PENDING, verificationChallenge), then `sendVerificationChallenge` synchronously → ok ? update {status ACTIVE, verifiedAt, verificationChallenge null} : leave PENDING. Return `{id, status, secret}` — THE ONLY time the secret crosses.
  - `update({id, workspaceId, name?, url?, events?})`: url change → new challenge + PENDING + sync re-challenge (same as create); else plain update.
  - `rotateSecret({id, workspaceId})` → new secret, re-encrypt, return `{secret}` once.
  - `verify({id, workspaceId})` → re-challenge (decrypts the stored secret), updates status accordingly; returns `{status}`.
  - `setEnabled({id, workspaceId, enabled})` → DISABLED↔ACTIVE; resume requires `verifiedAt` (else BAD_REQUEST «Сначала подтвердите адрес»); also resets `consecutiveFailures` and clears FAILED→ACTIVE on resume when verified (re-enable after auto-disable).
  - `delete({id, workspaceId})`.
  - `list({workspaceId})` — select WITHOUT secretEnc/verificationChallenge.
  - `deliveries({workspaceId, subscriptionId, cursor?})` — verify the subscription belongs to the workspace; take 30, keyset by createdAt/id; fields per spec.
  The router takes the fetch/lookup for challenges from module scope (real ones) — tests inject by mocking `@repo/webhooks`'s challenge via vi.mock OR (cleaner) the router reads an optional `ctx.webhookChallenge` port… KEEP SIMPLE: tests `vi.mock('@repo/webhooks', async (orig) => ({...await orig(), sendVerificationChallenge: vi.fn(...)}))` — vitest module mock, the established style in trpc tests is harness-level; choose vi.mock and document.
  Mount `webhook: webhookRouter` in `packages/trpc/src/index.ts`; add the dep to package.json + `pnpm install`.

- [ ] **Step 3 — router tests** (`webhook-router.test.ts`, real DB, harness from job-router incl. ensurePersonalPlan; ALSO upsert the plan with `developerSpaceEnabled: true` for the happy fixtures and a second plan/workspace WITHOUT it for the gate test; subscribe the owner to an ACTIVE subscription via direct prisma where needed; mock sendVerificationChallenge). Cases (9): create returns secret once + ACTIVE when challenge ok; challenge fail → PENDING; list never contains secretEnc/secret; EDITOR → FORBIDDEN; plan without developerSpaceEnabled → FORBIDDEN; non-https create → BAD_REQUEST; 21st subscription → BAD_REQUEST; rotateSecret returns new secret + old signature no longer verifies (use verifyWebhookSignature against re-decrypted secretEnc); setEnabled resume unverified → BAD_REQUEST; deliveries paginates + scoped to the workspace (foreign subscriptionId → NOT_FOUND).

- [ ] **Step 4:** `pnpm --filter @repo/trpc test` full + `pnpm --filter @repo/webhooks test` + check-types both. **Step 5 — commit:**
```bash
git add packages/webhooks packages/trpc/src/routers/webhook.ts packages/trpc/src/index.ts packages/trpc/package.json packages/trpc/test/webhook-router.test.ts pnpm-lock.yaml
git commit -m "feat(trpc): webhook router — create/verify/rotate/deliveries with admin+plan gates"
```

---

## Task 7: Engines WebhookModule (cron wiring) + env

**Files:** Create `apps/engines/src/apps/webhook/{webhook.module.ts,cron/webhook-cron.service.ts,cron/webhook-cron.service.spec.ts}`; Modify `apps/engines/src/app.module.ts`, `apps/engines/package.json` (+`@repo/webhooks workspace:*`), `.env.example`, `turbo.json`.

- [ ] **Step 1 — cron service** (mirror `notifier-cron.service.ts` verbatim style):
```ts
@Injectable()
export class WebhookCronService {
  private readonly logger = new Logger(WebhookCronService.name)
  private readonly workerId = `webhook-${hostname()}-${process.pid}`
  private readonly batchSize = Number(process.env.WEBHOOK_BATCH_SIZE ?? 20)
  private readonly maxAttempts = Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? 8)
  private readonly timeoutMs = Number(process.env.WEBHOOK_TIMEOUT_MS ?? 10_000)

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Cron(process.env.WEBHOOK_CRON_EXPRESSION ?? '*/5 * * * * *')
  async tick(): Promise<void> {
    try {
      await runFanOutTick(this.prisma, { workerId: this.workerId, batchSize: this.batchSize })
      await runDeliveryTick(this.prisma, {
        workerId: this.workerId,
        batchSize: this.batchSize,
        maxAttempts: this.maxAttempts,
        timeoutMs: this.timeoutMs,
      })
    } catch (err) {
      this.logger.error('webhook tick failed', err)
    }
  }
}
```
Imports from `@repo/webhooks/worker`. Module = providers [WebhookCronService] (DbModule is @Global). Register `WebhookModule` in `app.module.ts` after `NotifierModule`. Unit spec (jest, mock-style like vectorization-cron.service.spec.ts): mock the worker fns via jest module factory; tick calls both with the env-derived opts; a worker throw is caught + logged (no rethrow).

- [ ] **Step 2 — env:** add the four `WEBHOOK_*` vars to `.env.example` (commented defaults) AND `turbo.json globalEnv`. Verify `pnpm --filter engines test` (jest unit, the moduleNameMapper maps @repo/db — check whether `@repo/webhooks` needs a mapper entry like `'^@repo/webhooks/worker$': '<rootDir>/../../packages/webhooks/src/worker/index.ts'`; add both `@repo/webhooks` mappings to jest.config.ts if resolution fails) + `pnpm --filter engines check-types` + `pnpm check-types`.

- [ ] **Step 3 — commit:**
```bash
git add apps/engines/src/apps/webhook apps/engines/src/app.module.ts apps/engines/package.json apps/engines/jest.config.ts .env.example turbo.json pnpm-lock.yaml
git commit -m "feat(engines): webhook dispatch cron module"
```

---

## Task 8: Settings UI — «Вебхуки» section

**Files:** Create `apps/web/src/components/workspace/settings/webhooks-section.tsx` (+small subcomponents in the same folder if needed: `webhook-dialog.tsx`, `webhook-deliveries-table.tsx`); Modify `workspace-settings-dialog.tsx`; extend `apps/web/test/import-export-helpers.test.ts`-style pure tests ONLY if a pure helper emerges (status labels).

Template: `mcp-section.tsx` (SettingsCard, list, dialog, isOwner alert). Read it + the dialog items array first.

- [ ] **Step 1 — section registration:** slug `'webhooks'` in `SettingsSectionSlug`; item after `'mcp'`:
```tsx
    {
      slug: 'webhooks',
      label: 'Вебхуки',
      icon: <WebhookIcon fontSize="small" />,
      show: features.developerSpaceEnabled,
      render: () => (
        <WorkspaceWebhooksSection
          workspaceId={workspaceId}
          canManage={roleQ.data === 'OWNER' || roleQ.data === 'ADMIN'}
        />
      ),
    },
```
`WebhookIcon` exists in MUI icons — add the re-export to `packages/ui/src/components/index.ts` if missing (one line, existing pattern).

- [ ] **Step 2 — section component.** SettingsCard «Вебхуки» description «HTTP-уведомления о событиях пространства для ваших интеграций. Подпись HMAC, повторные попытки и журнал доставок.»; non-canManage → info Alert «Управлять вебхуками могут владелец и администраторы» (list still visible). Subscription list (table or stacked cards): name, url (truncated), status Chip (Ожидает проверки=default / Активен=success / Приостановлен=default / Ошибки=error), events count chip, consecutiveFailures warning when >0; row actions (canManage): «Проверить» (verify, when PENDING), pause/resume Switch (setEnabled), «Сменить секрет» (rotate → secret dialog), Delete, «Доставки» (expands/opens the deliveries table: event, status chip, attempts, HTTP status, latency, date, lastError tooltip; «Показать ещё» pagination via cursor). Create button (canManage) → dialog: name, url (https placeholder), event checklist (label + ru description per type — define `WEBHOOK_EVENT_LABELS: Record<string,{label,desc}>` locally in the section; the catalog VALUES come from a type-only import or a literal copy with a sync comment — do NOT import @repo/webhooks runtime into the client bundle; copy the 8 literals with `// keep in sync with @repo/webhooks catalog`). After create: the one-time secret dialog («Секрет показывается только один раз» + copy button + the signature header docs line). Errors surfaced via Alert (e.message).
- testids: `webhooks-create`, `webhook-row`, `webhook-secret-value`, `webhook-deliveries`, `webhook-verify`.

- [ ] **Step 3 — verify:** `pnpm --filter web lint && pnpm --filter web check-types && pnpm --filter web build` (client-bundle gate — especially NO `@repo/webhooks` import in client code). **Step 4 — commit:**
```bash
git add apps/web/src/components/workspace/settings packages/ui/src/components/index.ts
git commit -m "feat(web): webhooks settings section — subscriptions, secret dialog, delivery log"
```

---

## Task 9: E2E + changelog + gates

**Files:** Create `apps/e2e/webhooks.spec.ts`; Modify `docs/changelog.md`.

- [ ] **Step 1 — E2E** (no live network: the created subscription stays PENDING because the challenge URL is unreachable — that IS the asserted behavior). Flow: `signUpAndCreateWorkspace` → the user's plan is personal (developerSpaceEnabled false) → the Вебхуки section must be ABSENT; then upgrade the seeded personal plan? — NO: instead seed `developerSpaceEnabled: true` onto the personal plan via prisma in the spec setup (`prisma.plan.update({where:{slug:'personal'}, data:{developerSpaceEnabled:true}})` in beforeAll, restore in afterAll — the E2E DB is shared with dev; restore carefully). Then: open settings → Вебхуки → create (name, `https://example.invalid/hook`, pick 2 events) → one-time secret dialog visible with `whsec_` prefix → close → row shows «Ожидает проверки» → deliveries empty state. Use the import-export spec's openSettings helper pattern.
- [ ] **Step 2 — changelog** («Готовится», after the import/export block):
```md
**Вебхуки для интеграций**

- Подписки на события пространства (страницы, комментарии) с доставкой на ваш HTTPS-адрес: подпись HMAC, проверка адреса, повторные попытки и журнал доставок.
- Безопасно по умолчанию: только содержимое командных разделов, в событиях — только идентификаторы и метаданные.
```
- [ ] **Step 3:** run E2E spec (`--retries=2`, root .env sourced) → green; then FULL `pnpm gates` → 38+/38+ green (fix minimally; report product-bug smells). **Step 4 — commits:**
```bash
git add apps/e2e/webhooks.spec.ts && git commit -m "test(e2e): webhook subscription create + pending verification flow"
git add docs/changelog.md && git commit -m "docs(changelog): outbound webhooks"
```

---

## Completion

Final whole-branch review focus: (1) the no-leak chain end-to-end (fan-out gate + send-time re-check + payload forbidden-keys — can ANY personal/private page id/title reach a delivery row or the wire?), (2) SSRF completeness (redirects! does fetch follow redirects to private hosts? — set `redirect: 'manual'`/treat 3xx as failure if not already), (3) secret handling (never logged/returned post-create; encrypted at rest), (4) outbox interference (indexer untouched; webhook rows don't break its dedup), (5) GENERIC regression across domain/trpc suites. Then the merge checkpoint.

## Self-review (at plan-writing time)

- Spec §2→T1; §3→T3; §4→T4; §5→T5 (+T7 wiring); §6→T6 challenge; §7→T6 router + T8 UI; §8 tests distributed per task + E2E in T9; §9 env→T7.
- Type consistency: catalog (T2) consumed by T3 comment zod? — no: emission uses plain strings (db stays untyped per T3 comment), the ROUTER validates against WEBHOOK_EVENT_TYPES (T6); LookupFn (T2 ssrf) reused by T5/T6; signWebhookPayload shared by deliver + challenge; runFanOutTick/runDeliveryTick exported via ./worker for engines (T7).
- Deviations flagged in the header (package placement, yjs content_updated, sync verification, item-page non-emission).
- Redirect handling: added to the final-review focus AND implementers should set `redirect: 'manual'` + treat 3xx as failure in deliver/challenge — bake it in T5/T6 implementations.
