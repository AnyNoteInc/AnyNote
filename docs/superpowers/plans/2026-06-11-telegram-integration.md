# Telegram Bot Integration Implementation Plan (Phase 7B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-workspace Telegram bot connections that push collection-scoped notifications into explicitly subscribed chats, plus an identity-gated `/help` `/link` `/search` `/get` command surface — per `docs/superpowers/specs/2026-06-11-telegram-integration-design.md` (THE SPEC; read it first, it overrides any ambiguity here).

**Architecture:** Mirror of Phase 7A webhooks: third outbox aggregate (`telegram_event`) → `@repo/telegram` package (api client, pure command router, fan-out + delivery ticks) → engines cron; inbound Telegram updates hit a Next route verified by `X-Telegram-Bot-Api-Secret-Token`. The 7A files are the canonical templates — when this plan says "mirror X", open X and copy its structure, swapping webhook→telegram semantics.

**Tech Stack:** Prisma 7, vitest (real DB), tRPC v11, NestJS cron, Next 16 route handlers, MUI v6.

**Template files (read before the task that cites them):**
- `packages/webhooks/src/worker/fan-out.ts`, `worker/deliver.ts`, `src/{catalog,secret,signature,challenge,payload}.ts`, `test/{fan-out,deliver,challenge}.test.ts`, `test/setup.ts`, `vitest.config.ts`, `package.json`, `tsconfig.json`, `eslint.config.mjs`
- `packages/trpc/src/routers/webhook.ts` + `packages/trpc/test/webhook-router.test.ts`
- `apps/engines/src/apps/webhook/**`
- `apps/web/src/components/workspace/settings/{webhooks-section,webhook-dialog,webhook-deliveries-table}.tsx`, `webhook-events.ts`, `workspace-settings-dialog.tsx`
- `apps/web/src/app/api/webhooks/yookassa/route.ts`
- `apps/e2e/webhooks.spec.ts`

**Shared-dev-DB migration rule (Task 1):** generate SQL via schema-to-schema `prisma migrate diff` (no DB), apply with `psql --single-transaction` inside the `anynote-postgres-1` container, then `prisma migrate resolve --applied <name>`. NEVER `migrate dev`/`reset`. (`prisma migrate status` exits 1 from pre-existing foreign drift — ignore that exit code.)

**Commits:** Conventional Commits, explicit paths only (NEVER `git add -A` — untracked `cl*.md` files in sibling checkouts must never be committed).

---

## Task 1: Schema, migration, dual-emission helper

**Files:** Modify `packages/db/prisma/schema.prisma`, `packages/db/src/index.ts`; Create `packages/db/prisma/migrations/20260612090000_telegram/migration.sql`; Modify emission call sites: `packages/domain/src/pages/repositories/pages.repository.ts`, `packages/trpc/src/routers/comment.ts`, `apps/yjs/src/persistence.ts`.

- [ ] **Step 1 — schema.** Append to `schema.prisma` (follow §2 of the spec EXACTLY — it is normative; below are the models in full):

```prisma
enum TelegramConnectionStatus {
  PENDING
  ACTIVE
  DISABLED
  ERROR
}

enum TelegramChatStatus {
  ACTIVE
  LEFT
}

enum TelegramDeliveryStatus {
  PENDING
  SENT
  FAILED
  SKIPPED
}

enum TelegramCommandResult {
  OK
  DENIED
  ERROR
}

model TelegramConnection {
  id                  String                   @id @default(uuid(7)) @db.Uuid
  workspaceId         String                   @unique @map("workspace_id") @db.Uuid
  createdById         String                   @map("created_by_id") @db.Uuid
  botTokenEnc         Json                     @map("bot_token_enc")
  botUsername         String?                  @map("bot_username") @db.VarChar(64)
  webhookSecretEnc    Json                     @map("webhook_secret_enc")
  status              TelegramConnectionStatus @default(PENDING)
  consecutiveFailures Int                      @default(0) @map("consecutive_failures")
  lastError           String?                  @map("last_error") @db.VarChar(500)
  createdAt           DateTime                 @default(now()) @map("created_at")
  updatedAt           DateTime                 @updatedAt @map("updated_at")
  workspace     Workspace                        @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  chats         TelegramChat[]
  subscriptions TelegramCollectionSubscription[]
  deliveries    TelegramDelivery[]
  audits        TelegramBotCommandAudit[]

  @@map("telegram_connections")
}

model TelegramChat {
  id           String             @id @default(uuid(7)) @db.Uuid
  connectionId String             @map("connection_id") @db.Uuid
  chatId       String             @map("chat_id") @db.VarChar(32)
  type         String             @db.VarChar(16)
  title        String?            @db.VarChar(255)
  status       TelegramChatStatus @default(ACTIVE)
  createdAt    DateTime           @default(now()) @map("created_at")
  updatedAt    DateTime           @updatedAt @map("updated_at")
  connection    TelegramConnection               @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  subscriptions TelegramCollectionSubscription[]

  @@unique([connectionId, chatId])
  @@map("telegram_chats")
}

model TelegramCollectionSubscription {
  id           String   @id @default(uuid(7)) @db.Uuid
  connectionId String   @map("connection_id") @db.Uuid
  chatId       String   @map("chat_id") @db.Uuid
  collectionId String   @map("collection_id") @db.Uuid
  events       String[]
  createdById  String   @map("created_by_id") @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")
  connection TelegramConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  chat       TelegramChat       @relation(fields: [chatId], references: [id], onDelete: Cascade)
  collection Collection         @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  deliveries TelegramDelivery[]

  @@unique([chatId, collectionId])
  @@index([connectionId])
  @@index([collectionId])
  @@map("telegram_collection_subscriptions")
}

model TelegramUserLink {
  id             String   @id @default(uuid(7)) @db.Uuid
  userId         String   @unique @map("user_id") @db.Uuid
  telegramUserId String   @unique @map("telegram_user_id") @db.VarChar(32)
  username       String?  @db.VarChar(64)
  linkedAt       DateTime @default(now()) @map("linked_at")
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("telegram_user_links")
}

model TelegramLinkCode {
  id        String    @id @default(uuid(7)) @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  codeHash  String    @unique @map("code_hash") @db.VarChar(64)
  expiresAt DateTime  @map("expires_at")
  usedAt    DateTime? @map("used_at")
  createdAt DateTime  @default(now()) @map("created_at")
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("telegram_link_codes")
}

model TelegramDelivery {
  id              String                 @id @default(uuid(7)) @db.Uuid
  connectionId    String                 @map("connection_id") @db.Uuid
  subscriptionId  String                 @map("subscription_id") @db.Uuid
  eventType       String                 @map("event_type") @db.VarChar(64)
  eventId         String                 @map("event_id") @db.Uuid
  payload         Json
  status          TelegramDeliveryStatus @default(PENDING)
  attempts        Int                    @default(0)
  nextAttemptAt   DateTime               @default(now()) @map("next_attempt_at")
  lockedAt        DateTime?              @map("locked_at")
  lockedBy        String?                @map("locked_by") @db.VarChar(64)
  responseSnippet String?                @map("response_snippet") @db.VarChar(500)
  lastError       String?                @map("last_error") @db.VarChar(500)
  createdAt       DateTime               @default(now()) @map("created_at")
  connection   TelegramConnection             @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  subscription TelegramCollectionSubscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)

  @@unique([subscriptionId, eventId])
  @@index([status, nextAttemptAt])
  @@index([connectionId, createdAt(sort: Desc)])
  @@map("telegram_deliveries")
}

model TelegramBotCommandAudit {
  id             String                @id @default(uuid(7)) @db.Uuid
  connectionId   String                @map("connection_id") @db.Uuid
  chatId         String                @map("chat_id") @db.VarChar(32)
  telegramUserId String                @map("telegram_user_id") @db.VarChar(32)
  linkedUserId   String?               @map("linked_user_id") @db.Uuid
  command        String                @db.VarChar(32)
  argsSummary    String?               @map("args_summary") @db.VarChar(200)
  result         TelegramCommandResult
  detail         String?               @db.VarChar(200)
  createdAt      DateTime              @default(now()) @map("created_at")
  connection TelegramConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  @@index([connectionId, createdAt(sort: Desc)])
  @@map("telegram_bot_command_audits")
}
```

Add the back-relations on `Workspace` (`telegramConnection TelegramConnection?`), `User` (`telegramUserLink TelegramUserLink?`, `telegramLinkCodes TelegramLinkCode[]`), `Collection` (`telegramSubscriptions TelegramCollectionSubscription[]`).

- [ ] **Step 2 — migration** per the shared-dev-DB rule above: `pnpm --filter @repo/db exec prisma migrate diff --from-schema-datamodel <(git show main:packages/db/prisma/schema.prisma) --to-schema-datamodel prisma/schema.prisma --script` → save as the migration.sql; apply via `docker exec -i anynote-postgres-1 psql -U postgres -d anynote --single-transaction < migration.sql`; `prisma migrate resolve --applied 20260612090000_telegram`. Run `pnpm --filter @repo/db prisma:generate`.

- [ ] **Step 3 — dual emission.** In `packages/db/src/index.ts`: widen `OutboxAggregateType` to include `'telegram_event'`; rename nothing; ADD:

```ts
export type EnqueueIntegrationEventsArgs = EnqueueWebhookEventArgs

/**
 * Writes one outbox row per outbound-integration consumer (webhooks + telegram).
 * Consumers each claim only their own aggregateType — SKIP LOCKED consumers must
 * never share rows (they would steal from each other).
 */
export async function enqueueIntegrationEvents(
  tx: Prisma.TransactionClient,
  args: EnqueueIntegrationEventsArgs,
): Promise<void> {
  const payload = {
    resourceType: args.resourceType,
    actorId: args.actorId ?? null,
    hints: args.hints ?? {},
  }
  await tx.outboxEvent.createMany({
    data: (['webhook_event', 'telegram_event'] as const).map((aggregateType) => ({
      eventType: args.event,
      aggregateType,
      aggregateId: args.resourceId,
      workspaceId: args.workspaceId,
      payload,
    })),
  })
}
```

Keep `enqueueWebhookEvent` exported (tests use it) but switch EVERY call site of `enqueueWebhookEvent` in `pages.repository.ts`, `comment.ts`, and `apps/yjs/src/persistence.ts` to `enqueueIntegrationEvents` (grep to find all; preserve each site's args verbatim). Update `apps/yjs/src/persistence.spec.ts` + `packages/domain/.../pages.repository.test.ts` + `packages/trpc/test/comment-router.test.ts` mocks/assertions accordingly (they may assert the function name or row counts — a `webhook_event` count assertion now also sees `telegram_event` rows only if it queries without aggregateType filter; fix filters, don't weaken assertions).

- [ ] **Step 4 — verify:** `pnpm --filter @repo/db check-types && pnpm --filter @repo/domain test && pnpm --filter @repo/trpc test && pnpm --filter yjs test && pnpm --filter @repo/webhooks test` (webhooks fan-out tests must still pass — they drain `webhook_event` rows and must be UNAFFECTED by sibling `telegram_event` rows; if a drain-loop counts rows, scope it).

- [ ] **Step 5 — commit:**
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260612090000_telegram packages/db/src/index.ts packages/domain/src/pages/repositories/pages.repository.ts packages/domain/src/pages/repositories/pages.repository.test.ts packages/trpc/src/routers/comment.ts packages/trpc/test/comment-router.test.ts apps/yjs/src/persistence.ts apps/yjs/src/persistence.spec.ts
git commit -m "feat(db): telegram integration models + dual webhook/telegram outbox emission"
```

---

## Task 2: `@repo/telegram` package scaffold — api client, secrets, render

**Files:** Create `packages/telegram/{package.json,tsconfig.json,eslint.config.mjs,vitest.config.ts}`, `packages/telegram/src/{index.ts,api.ts,secret.ts,render.ts}`, `packages/telegram/test/{api.test.ts,secret.test.ts,render.test.ts,setup.ts}`; Modify `packages/webhooks/src/worker/index.ts` (export the shared gate), `.dependency-cruiser.cjs`/`docs/architecture.md` IF needed (see Step 1).

- [ ] **Step 1 — package config.** Copy `packages/webhooks/package.json` → name `@repo/telegram`, same exports map (`.` + `./worker`), same scripts, deps: `@repo/db`, `@repo/auth`, `@repo/webhooks` (workspace:*), `zod`. Copy tsconfig/eslint/vitest/test-setup verbatim from webhooks. THEN run `pnpm check-architecture` early with a stub `src/index.ts` importing `@repo/webhooks`: if the lateral Tier-2→Tier-2 edge is rejected, read `docs/architecture.md` + the dependency-cruiser config and add the explicit allowed edge `@repo/telegram → @repo/webhooks` with a one-line rationale comment ("telegram consumes the webhook no-leak gate — single implementation"); report this in your final summary.
- [ ] **Step 2 — shared gate exports.** In `packages/webhooks/src/worker/index.ts` add exports for `passesVisibilityGate`, `sanitizeHints`, `eventIdForOutboxRow` from `./fan-out` (verify the names in `fan-out.ts`; export types they need too).
- [ ] **Step 3 — api.ts** (TDD: write `test/api.test.ts` cases first with an injected `fetchFn` — Telegram-shaped JSON responses; assert URL composition, token NEVER appearing in thrown error messages or the `lastError` strings it produces, AbortSignal timeout):

```ts
export type TelegramApiResult<T> = { ok: true; result: T } | { ok: false; description: string }

export class TelegramApi {
  constructor(
    private readonly token: string,
    private readonly opts: { fetchFn?: typeof fetch; baseUrl?: string; timeoutMs?: number } = {},
  ) {}

  private get baseUrl(): string {
    return this.opts.baseUrl ?? process.env.TELEGRAM_API_BASE_URL ?? 'https://api.telegram.org'
  }

  private async call<T>(method: string, body?: Record<string, unknown>): Promise<TelegramApiResult<T>> {
    const fetchFn = this.opts.fetchFn ?? fetch
    const timeoutMs = this.opts.timeoutMs ?? Number(process.env.TELEGRAM_TIMEOUT_MS ?? 10_000)
    try {
      const res = await fetchFn(`${this.baseUrl}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })
      const json = (await res.json()) as { ok: boolean; result?: T; description?: string }
      if (!json.ok) return { ok: false, description: json.description ?? `HTTP ${res.status}` }
      return { ok: true, result: json.result as T }
    } catch (err) {
      // Never include the URL (it embeds the token) in surfaced errors.
      return { ok: false, description: err instanceof Error ? err.name : 'fetch failed' }
    }
  }

  getMe() { return this.call<{ id: number; username?: string }>('getMe') }
  setWebhook(url: string, secretToken: string) {
    return this.call<boolean>('setWebhook', { url, secret_token: secretToken, allowed_updates: ['message', 'my_chat_member'] })
  }
  deleteWebhook() { return this.call<boolean>('deleteWebhook') }
  sendMessage(chatId: string, text: string) {
    return this.call<{ message_id: number }>('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
  }
}
```

- [ ] **Step 4 — secret.ts** (mirror `packages/webhooks/src/secret.ts`): `generateTelegramWebhookSecret()` → 32-char base62 (no prefix); `generateLinkCode()` → 8-char uppercase base32 (no 0/O/1/I); `hashLinkCode(code)` → sha256 hex. Tests: shape regexes + hash determinism.
- [ ] **Step 5 — render.ts**: `escapeHtml(s)` + `renderEventMessage({ eventType, pageTitle, pageUrl, actorName })` → Russian one-liners per event type (e.g. `page.created` → `📄 Новая страница: <a href="...">Title</a>`; `comment.created` → `💬 Новый комментарий на странице <a>...</a>`; cover all 8 catalog types — import `WEBHOOK_EVENT_TYPES` from `@repo/webhooks` for an exhaustiveness test) and `renderHelp()`, `renderSearchResults(items)`, `renderNotFound()`, `renderNotLinked()`, `renderDenied()`. Tests: HTML escaping of titles (`<b>` injection), exhaustive event coverage.
- [ ] **Step 6 — index.ts** exports api/secret/render. Verify `pnpm --filter @repo/telegram test && pnpm --filter @repo/telegram check-types && pnpm check-architecture`. **Step 7 — commit:**
```bash
git add packages/telegram packages/webhooks/src/worker/index.ts pnpm-lock.yaml
git commit -m "feat(telegram): package scaffold — bot api client, secrets, message rendering"
```
(plus the dependency-cruiser/docs file if touched — name it explicitly.)

---

## Task 3: Command router (pure, TDD the §5 permission ladder)

**Files:** Create `packages/telegram/src/commands.ts`, `packages/telegram/test/commands.test.ts` (real-DB vitest, fixtures like `packages/webhooks/test/fan-out.test.ts`).

- [ ] **Step 1 — types + router skeleton.** `routeUpdate(prisma, connection, update)` where `connection` is the loaded `TelegramConnection` row and `update` a minimal Telegram `Update` type (`message?: { chat: {id, type, title?}, from?: {id, username?}, text? }`, `my_chat_member?: …`). Returns `{ reply: string | null, audit: { command, argsSummary, result, detail, telegramUserId, linkedUserId, chatId } | null }` (audit null only for non-command messages). The route handler (Task 6) persists the audit row and sends the reply — `commands.ts` does NO Telegram I/O.
- [ ] **Step 2 — TDD the ladder** (write ALL tests red-first; fixture helper creates workspace + member + TEAM/PERSONAL collections + pages + connection + chat + subscription):
  1. `/help` → reply contains command list; audit `{command:'help', result:'OK'}`.
  2. `/link <valid code>` → upserts `TelegramUserLink` (replacing the user's previous link), marks code used; audit OK. Expired / used / unknown code → DENIED with distinct `detail`; reply does not reveal which.
  3. `/search q` unlinked sender → DENIED, reply = renderNotLinked().
  4. `/search q` linked but NOT a member of `connection.workspaceId` → DENIED.
  5. `/search q` linked member, chat has subscriptions → results ONLY from subscribed collections' pages, title-`contains` case-insensitive, excludes trashed (`deletedAt != null`), archived (`archivedAt != null`) and database item-pages (mirror the `excludeDatabaseRowPages` predicate — grep `packages/domain` for it and reuse/replicate), top 5, each `title + ${baseUrl}/pages/${id}` (baseUrl from `process.env.BETTER_AUTH_URL`; verify the live page route is `/pages/[id]` by checking `apps/web/src/app/(protected)/pages` — adjust if different).
  6. `/search` with PERSONAL-collection page matching the query but its collection NOT subscribable → never returned (create a PERSONAL collection subscription attempt is blocked at the router level — Task 7 — so here seed a subscription pointing at a TEAM collection only and assert the personal page absent).
  7. `/search q` in a chat with zero subscriptions → empty-scope reply, audit OK with `detail:'no-scope'`.
  8. `/get <pageId>` for a page in a subscribed collection → title + link + updatedAt; for a page outside the subscribed set OR trashed OR malformed UUID → uniform renderNotFound() (assert byte-identical replies — no existence oracle); unlinked → DENIED.
  9. Unknown command `/frobnicate` → audit `{command:'unknown'}`, help-pointer reply.
  10. `argsSummary` truncated to 200 chars.
- [ ] **Step 3 — implement until green.** `pnpm --filter @repo/telegram test`. **Step 4 — commit:**
```bash
git add packages/telegram/src/commands.ts packages/telegram/test/commands.test.ts packages/telegram/src/index.ts
git commit -m "feat(telegram): command router with identity-gated search/get and full audit"
```

---

## Task 4: Fan-out tick

**Files:** Create `packages/telegram/src/worker/{index.ts,fan-out.ts}`, `packages/telegram/test/fan-out.test.ts`.

- [ ] **Step 1 — mirror `packages/webhooks/src/worker/fan-out.ts` closely**: same claim SQL shape but `aggregate_type = 'telegram_event'`; same PENDING→PROCESSING→DONE/FAILED lifecycle + backoff + OUTBOX_MAX_ATTEMPTS; same per-row processing order: resolve pageId exactly the way 7A's `processRow` does for page vs comment resources (read it — comments resolve the page via the row's hints/aggregate data), call the IMPORTED `passesVisibilityGate` + `sanitizeHints` from `@repo/webhooks/worker`, reuse `eventIdForOutboxRow` for the deterministic id. THEN the telegram-specific match: load the page's `collectionId`; if null → no subscriptions match → markDone. Else `telegramCollectionSubscription.findMany({ where: { collectionId, events: { has: eventType }, chat: { status: 'ACTIVE' }, connection: { status: 'ACTIVE', workspaceId: row.workspaceId } } })` → `telegramDelivery.createMany({ data: …, skipDuplicates: true })` with the sanitized 7A payload envelope (`buildWebhookPayload` from `@repo/webhooks`).
- [ ] **Step 2 — TDD** (mirror `packages/webhooks/test/fan-out.test.ts` incl. the bounded `runFanOutUntilDrained` helper — the shared dev DB may hold foreign PENDING rows): matching subscription → delivery row created with deterministic eventId; event not in `events[]` → none; chat LEFT → none; connection DISABLED → none; PERSONAL-collection page → gate blocks (none); `collectionId: null` page → none; re-run after crash-simulation (reset row to PENDING) → no duplicate (unique + skipDuplicates); `webhook_event` rows are NOT consumed by this tick and vice versa (seed both, run both ticks, assert each only drained its own).
- [ ] **Step 3 — verify both packages:** `pnpm --filter @repo/telegram test && pnpm --filter @repo/webhooks test`. **Step 4 — commit:**
```bash
git add packages/telegram/src/worker packages/telegram/test/fan-out.test.ts
git commit -m "feat(telegram): fan-out tick — subscription matching over the shared no-leak gate"
```

---

## Task 5: Delivery tick

**Files:** Create `packages/telegram/src/worker/deliver.ts`, `packages/telegram/test/deliver.test.ts`; Modify `packages/telegram/src/worker/index.ts`.

- [ ] **Step 1 — mirror `packages/webhooks/src/worker/deliver.ts`**: claim SQL with the stale-lock reclaim (`locked_at IS NULL OR locked_at < now() - 10min`, SKIP LOCKED), backoff 60s·2^n cap 30min, maxAttempts default 8, injectable `fetchFn`. Telegram-specific flow per delivery: load subscription→chat→connection; decrypt `botTokenEnc` (deep-import `@repo/auth/src/secret-encryption.ts` like webhooks' deliver — copy its import path style; decrypt failure ⇒ terminal FAILED + bump `consecutiveFailures`); **send-time re-check**: page still exists, `deletedAt null`, `collectionId === subscription.collectionId`, collection kind TEAM ⇒ else SKIPPED (no retry); fetch `page.title` now, render via `renderEventMessage` (actorName: load the actor user's firstName if `payload.actor` id present, else null), `sendMessage(chat.chatId, text)`. Success ⇒ SENT + reset connection `consecutiveFailures` to 0. Telegram error containing `403`/`bot was kicked`/`chat not found` ⇒ chat status LEFT + delivery SKIPPED (no retry). Other failure ⇒ retry ladder; exhausted ⇒ FAILED; every failure bumps `consecutiveFailures`; at ≥10 ⇒ connection status ERROR + `lastError` (fan-out then stops matching it). `responseSnippet` = first 500 chars of the API response description.
- [ ] **Step 2 — TDD** (fixtures mirror webhooks `deliver.test.ts`, incl. backdated `nextAttemptAt` for Node-vs-Postgres clock skew): success path (assert sendMessage body: chat_id, HTML title link, escaped title); retry/backoff scheduling; 403 ⇒ chat LEFT + SKIPPED; decrypt corruption ⇒ terminal first tick; send-time re-check (page trashed after fan-out ⇒ SKIPPED; page moved to another collection ⇒ SKIPPED); auto-disable at threshold; stale lock reclaimed at 11min not at 1min; token absent from `lastError`.
- [ ] **Step 3:** `pnpm --filter @repo/telegram test`. **Step 4 — commit:**
```bash
git add packages/telegram/src/worker packages/telegram/test/deliver.test.ts
git commit -m "feat(telegram): delivery tick — send-time visibility re-check, backoff, auto-disable"
```

---

## Task 6: Inbound webhook route (apps/web)

**Files:** Create `apps/web/src/app/api/telegram/webhook/[connectionId]/route.ts`, `apps/web/test/telegram-webhook-route.test.ts`.

- [ ] **Step 1 — route** (template: `apps/web/src/app/api/webhooks/yookassa/route.ts` for shape; `runtime = 'nodejs'`):
  1. Load connection by param id (`prisma.telegramConnection.findUnique`); missing or `status === 'DISABLED'` ⇒ 404.
  2. Timing-safe compare `X-Telegram-Bot-Api-Secret-Token` header vs `decryptSecret(webhookSecretEnc)` (use `timingSafeEqual` with length guard; decrypt failure ⇒ 403). Mismatch ⇒ 403.
  3. Parse update JSON (bad ⇒ 400). `my_chat_member` ⇒ upsert `TelegramChat` on `(connectionId, chatId)` with type/title; `new_chat_member.status` in `('left','kicked')` ⇒ status LEFT, in `('member','administrator')` ⇒ ACTIVE. `message` ⇒ upsert chat ACTIVE, then if `text` starts with `/` ⇒ `routeUpdate` → persist the audit row → reply via `new TelegramApi(decryptedToken).sendMessage(...)` wrapped in try/catch (reply failures swallowed, logged).
  4. Always `NextResponse.json({ ok: true })` on handled paths.
- [ ] **Step 2 — tests** (vitest node env in `apps/web/test/`, mock prisma like neighbouring route tests if a precedent exists — check `apps/web/test/` for an existing route-handler test pattern; if none mocks prisma, use real prisma like the trpc suites): secret mismatch ⇒ 403 + no chat row; valid `my_chat_member` join ⇒ chat ACTIVE; kicked ⇒ LEFT; `/help` message ⇒ audit row + 200 (inject fetchFn? the route constructs TelegramApi internally — give the route a module-level `const sendReply = …` seam OR pass `TELEGRAM_API_BASE_URL` pointing at a `vi.stubGlobal`'d fetch; choose the simplest seam and note it).
- [ ] **Step 3:** `pnpm --filter web test && pnpm --filter web check-types`. **Step 4 — commit:**
```bash
git add apps/web/src/app/api/telegram apps/web/test/telegram-webhook-route.test.ts
git commit -m "feat(web): telegram inbound webhook route — secret verification, chat registry, command dispatch"
```

---

## Task 7: tRPC router `telegram.*`

**Files:** Create `packages/trpc/src/routers/telegram.ts`, `packages/trpc/test/telegram-router.test.ts`; Modify `packages/trpc/src/index.ts` (mount `telegram:`), `packages/trpc/package.json` (+`@repo/telegram`).

- [ ] **Step 1 — router** (template `webhook.ts`: copy `assertWebhookAccess` as `assertTelegramAccess` — OWNER/ADMIN + `developerSpaceEnabled`; SAFE_SELECT omitting `botTokenEnc`/`webhookSecretEnc`). Procedures per spec §7: `getConnection`, `connect` (zod token regex `/^\d+:[\w-]{30,}$/`; encrypt token + fresh webhook secret; upsert ONE connection per workspace; then synchronously `getMe` → store botUsername, `setWebhook(${process.env.BETTER_AUTH_URL}/api/telegram/webhook/${id}, secret)`; both ok ⇒ ACTIVE else ERROR + lastError; timeout-bounded like 7A's `CHALLENGE_TIMEOUT_MS` — reuse `TELEGRAM_TIMEOUT_MS`), `verify` (re-run getMe+setWebhook), `disconnect` (best-effort deleteWebhook, DISABLED, mark connection's PENDING deliveries SKIPPED), `listChats`, `removeChat`, `createSubscription` (collection in-workspace + `kind === 'TEAM'` else BAD_REQUEST «Только командные разделы»; events ⊆ `WEBHOOK_EVENT_TYPES`; ≤50/connection), `updateSubscription`, `deleteSubscription`, `listSubscriptions` (include chat title + collection title), `deliveries` (keyset 30, no payload), `auditLog` (keyset 30). Member-level (NOT plan/role-gated beyond membership): `createLinkCode` (invalidate user's prior unused codes, 15-min TTL, return plaintext once), `getMyLink`, `unlinkMe`.
- [ ] **Step 2 — tests** (template `webhook-router.test.ts` incl. the dedicated `tg-test-pro` plan fixture + ACTIVE subscription; inject the Telegram API via `TELEGRAM_API_BASE_URL`? No — the router constructs `TelegramApi`; give `connect`/`verify` an injectable seam the same way `webhook.ts` injects `sendVerificationChallenge` for tests — read how webhook-router.test.ts mocks it (vi.mock of `@repo/webhooks`) and mirror with `@repo/telegram`): EDITOR forbidden on every managed proc; personal-plan workspace forbidden; connect with malformed token ⇒ BAD_REQUEST before any network; connect getMe-fail ⇒ ERROR status persisted; PERSONAL collection subscription ⇒ BAD_REQUEST; foreign-workspace collection ⇒ NOT_FOUND/BAD_REQUEST; secrets absent from every read shape; link-code lifecycle (create → expire → reuse rejected); deliveries/audit scoping to the caller's workspace.
- [ ] **Step 3:** `pnpm --filter @repo/trpc test && pnpm --filter @repo/trpc check-types`. **Step 4 — commit:**
```bash
git add packages/trpc/src/routers/telegram.ts packages/trpc/src/index.ts packages/trpc/test/telegram-router.test.ts packages/trpc/package.json pnpm-lock.yaml
git commit -m "feat(trpc): telegram router — connection, chats, subscriptions, link codes, logs"
```

---

## Task 8: Engines cron module + env

**Files:** Create `apps/engines/src/apps/telegram/{telegram.module.ts,cron/telegram-cron.service.ts,cron/telegram-cron.service.spec.ts}`; Modify `apps/engines/src/app.module.ts`, `apps/engines/package.json` (+`@repo/telegram`), `.env.example`, `turbo.json`.

- [ ] **Step 1** — mirror `apps/engines/src/apps/webhook/` verbatim (service: `TELEGRAM_CRON_EXPRESSION ?? '*/5 * * * * *'`, `runTelegramFanOutTick` then `runTelegramDeliveryTick`, env-derived batch/attempts/timeout, catch+log). Register `TelegramModule` after `WebhookModule`. Jest spec via `jest.unstable_mockModule` (3 cases, mirror webhook-cron.service.spec.ts; add a jest moduleNameMapper entry for `@repo/telegram/worker` if resolution fails — check how/whether `@repo/webhooks` needed one).
- [ ] **Step 2** — env: `TELEGRAM_API_BASE_URL`, `TELEGRAM_CRON_EXPRESSION`, `TELEGRAM_BATCH_SIZE`, `TELEGRAM_MAX_ATTEMPTS`, `TELEGRAM_TIMEOUT_MS` in `.env.example` (webhook-block style) AND `turbo.json` globalEnv. Verify `pnpm --filter engines test && pnpm --filter engines check-types`.
- [ ] **Step 3 — commit:**
```bash
git add apps/engines/src/apps/telegram apps/engines/src/app.module.ts apps/engines/package.json apps/engines/jest.config.ts .env.example turbo.json pnpm-lock.yaml
git commit -m "feat(engines): telegram dispatch cron module"
```

---

## Task 9: Settings UI

**Files:** Create `apps/web/src/components/workspace/settings/{telegram-section.tsx,telegram-subscription-dialog.tsx}`, `apps/web/src/components/settings/telegram-link-card.tsx`; Modify `workspace-settings-dialog.tsx` (slug `telegram` after `webhooks`, `show: features.developerSpaceEnabled`, canManage like webhooks), the personal integrations page (`apps/web/src/app/(protected)/settings/integrations/page.tsx` or its section component — read it first), `packages/ui/src/components/index.ts` (re-export `TelegramIcon` if not already — it IS already exported per the survey; verify).

- [ ] **Step 1 — workspace section** (template `webhooks-section.tsx`): connect card — when no connection: token TextField (password type, BotFather hint text) + «Подключить»; when connected: bot `@username`, status chip (Ожидает=default / Активен=success / Отключен=default / Ошибка=error + lastError tooltip), «Проверить» (verify), «Отключить» (disconnect, confirm dialog). Chats list (title/type/status chip/удалить). Subscriptions table + create dialog (chat Select из ACTIVE chats; collection Select — `trpc.collection.list` filtered to `kind === 'TEAM'`; event checklist reusing `webhook-events.ts` labels) with edit/delete. Delivery log (template `webhook-deliveries-table.tsx`: event, status, attempts, error tooltip, «Показать ещё»). Audit log table (command, sender, result chip, detail, date, «Показать ещё»). Non-canManage ⇒ info Alert, queries disabled (7A pattern). testids per spec §8: `telegram-connect`, `telegram-token-input`, `telegram-chat-row`, `telegram-subscription-create`, `telegram-subscription-row`, `telegram-audit`.
- [ ] **Step 2 — personal link card** in `/settings/integrations`: linked state (`@username`, datetime, «Отвязать») / unlinked («Получить код» → one-time code display `telegram-link-code` + instructions «Отправьте боту вашего пространства: /link CODE», 15-min note). Uses `telegram.getMyLink`/`createLinkCode`/`unlinkMe`.
- [ ] **Step 3 — verify:** `pnpm --filter web lint && pnpm --filter web check-types && pnpm --filter web build` (no `@repo/telegram` runtime import in client code — event labels come from the existing local copy). **Step 4 — commit:**
```bash
git add apps/web/src/components/workspace/settings apps/web/src/components/settings apps/web/src/app/\(protected\)/settings/integrations packages/ui/src/components/index.ts
git commit -m "feat(web): telegram settings — connection card, chat subscriptions, logs, personal link"
```

---

## Task 10: E2E + changelog (+ controller-run gates)

**Files:** Create `apps/e2e/telegram.spec.ts`; Modify `docs/changelog.md`, `playwright.config.ts` (webServer env: add `TELEGRAM_API_BASE_URL: 'http://127.0.0.1:9'` — unroutable port ⇒ instant deterministic failure, no live calls).

- [ ] **Step 1 — E2E** (template `apps/e2e/webhooks.spec.ts` incl. the beforeAll/afterAll plan-flag flip with capture+restore in try/finally): sign up + workspace → settings → «Телеграм» section visible → paste well-formed fake token `123456789:` + 35 word chars → «Подключить» → status shows «Ошибка» (connect's getMe fails fast against 127.0.0.1:9 — that IS the asserted no-live-network behaviour; generous timeouts) → personal `/settings/integrations` → «Получить код» → `telegram-link-code` shows an 8-char code.
- [ ] **Step 2 — changelog** («Готовится», after the webhooks block):
```md
**Телеграм-бот для пространств**

- Подключите своего бота: уведомления о страницах и комментариях командных разделов прямо в чаты, на которые вы явно подписали раздел.
- Команды /search и /get работают только для участников, привязавших аккаунт, — каждый запрос фиксируется в журнале аудита.
```
- [ ] **Step 3 — run:** `set -a; source .env; set +a; pnpm exec playwright test apps/e2e/telegram.spec.ts --retries=2` → green. (Full `pnpm gates` is run by the controller afterwards.) **Step 4 — commits:**
```bash
git add apps/e2e/telegram.spec.ts playwright.config.ts && git commit -m "test(e2e): telegram connect error-state + personal link code flow"
git add docs/changelog.md && git commit -m "docs(changelog): telegram bot integration"
```

---

## Completion

Group reviews: Tasks 1–5 (substrate) then 6–10 (API/UI/E2E), spec + quality each, fixes between. Final whole-branch review focus: (1) no-leak chain — personal/private pages and titles can never reach a TelegramDelivery row, a sent message, or a command reply (incl. the send-time re-check and the uniform not-found oracle); (2) secret hygiene — bot token / webhook secret / link codes never in logs, replies, reads, or error strings; (3) outbox isolation — webhook and telegram ticks can't claim each other's rows, indexer untouched, dual-emission row counts don't break 7A tests; (4) inbound route hardening — secret comparison timing-safe, DISABLED connections dead, audit written on every command incl. denials; (5) regression across domain/trpc/yjs suites (emission call-site switch). Then full `pnpm gates` (env sourced!) and the user merge checkpoint.

## Self-review (at plan-writing time)

- Spec §2→T1; §3 api/secret/render→T2, commands→T3, fan-out→T4, deliver→T5; §4→T6; §5→T3 (+T6 dispatch); §6 woven through T3/T4/T5 tests; §7→T7; §8→T9; §9→T8; §10→tests per task + T10.
- Type consistency: `routeUpdate` (T3) consumed by T6; `runTelegramFanOutTick`/`runTelegramDeliveryTick` exported via `./worker` (T4/T5) consumed by T8; gate helpers exported from `@repo/webhooks/worker` (T2) consumed by T4/T5; `TelegramApi` (T2) used by T5/T6/T7.
- Known risks named in-task: check-architecture lateral edge (T2 step 1), jest mapper (T8), route-test seam (T6 step 2), page-URL verification (T3 case 5), emission-test fallout (T1 step 3).
