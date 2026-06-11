# Telegram Bot Integration — Design (Notion-parity Phase 7B)

**Date:** 2026-06-11
**Status:** approved design (brainstorm decisions locked with the user)
**Roadmap source:** `cl7.md` Prompt 7.2

AnyNote-specific Telegram integration: workspace-scoped bot connections that push
collection-scoped notifications into explicitly subscribed chats, plus a small,
identity-gated command surface (`/help`, `/link`, `/search`, `/get`). Telegram is
**not** Notion parity; it consumes the Phase 7A event substrate with stricter
privacy defaults and full auditability.

## 1. Locked decisions

| Decision | Choice |
| --- | --- |
| Bot model | **Per-workspace bot token** — admin creates a bot via @BotFather and pastes the token; AES-encrypted at rest (`encryptSecret`, same as AiProvider `connectionEnc`). No global AnyNote bot. |
| Event source | **Mirror 7A** — emission sites write a third outbox row (`aggregateType: 'telegram_event'`); a dedicated fan-out tick + delivery tick in engines. No row-sharing with the webhook consumer (SKIP-LOCKED consumers would steal each other's rows). |
| Command scope (MVP) | `/help`, `/link <code>`, `/search <query>`, `/get <pageId>`. No share/publish writes from chat. |
| Plan gate | Reuse `Plan.developerSpaceEnabled` (same flag as webhooks/MCP/API keys). No new Plan column. |

## 2. Data model (packages/db)

All ids UUID v7 via Prisma defaults; one migration `*_telegram`.

```prisma
enum TelegramConnectionStatus { PENDING ACTIVE DISABLED ERROR }
enum TelegramChatStatus { ACTIVE LEFT }
enum TelegramDeliveryStatus { PENDING SENT FAILED SKIPPED }
enum TelegramCommandResult { OK DENIED ERROR }

model TelegramConnection {
  id                  String  @id @default(uuid(7)) @db.Uuid
  workspaceId         String  @unique @db.Uuid            // one connection per workspace (MVP)
  createdById         String  @db.Uuid
  botTokenEnc         Json                                  // EncryptedPayload {iv, ciphertext, tag}
  botUsername         String? @db.VarChar(64)               // from getMe at connect
  webhookSecretEnc    Json                                  // EncryptedPayload; Telegram echoes the plaintext in X-Telegram-Bot-Api-Secret-Token
  status              TelegramConnectionStatus @default(PENDING)
  consecutiveFailures Int     @default(0)
  lastError           String? @db.VarChar(500)
  createdAt / updatedAt
  // relations: workspace (cascade), chats[], subscriptions[], deliveries[], audits[]
}

model TelegramChat {
  id           String @id @default(uuid(7)) @db.Uuid
  connectionId String @db.Uuid                              // cascade → TelegramConnection
  chatId       String @db.VarChar(32)                       // Telegram chat id (int64 as string)
  type         String @db.VarChar(16)                       // private | group | supergroup | channel
  title        String? @db.VarChar(255)
  status       TelegramChatStatus @default(ACTIVE)
  createdAt / updatedAt
  @@unique([connectionId, chatId])
}

model TelegramCollectionSubscription {
  id           String   @id @default(uuid(7)) @db.Uuid
  connectionId String   @db.Uuid
  chatId       String   @db.Uuid                            // FK → TelegramChat (cascade)
  collectionId String   @db.Uuid                            // FK → Collection (cascade); MUST be kind=TEAM (router-enforced)
  events       String[]                                     // subset of the 7A WEBHOOK_EVENT_TYPES catalog
  createdById  String   @db.Uuid
  createdAt / updatedAt
  @@unique([chatId, collectionId])
}

model TelegramUserLink {
  id             String  @id @default(uuid(7)) @db.Uuid
  userId         String  @unique @db.Uuid                   // one Telegram identity per user…
  telegramUserId String  @unique @db.VarChar(32)            // …and one user per Telegram identity (global)
  username       String? @db.VarChar(64)
  linkedAt       DateTime @default(now())
}

model TelegramLinkCode {
  id        String   @id @default(uuid(7)) @db.Uuid
  userId    String   @db.Uuid
  codeHash  String   @unique @db.VarChar(64)                // sha256 of the one-time code; plaintext shown once
  expiresAt DateTime                                        // now() + 15 min
  usedAt    DateTime?
  createdAt DateTime @default(now())
}

model TelegramDelivery {
  id             String  @id @default(uuid(7)) @db.Uuid
  connectionId   String  @db.Uuid
  subscriptionId String  @db.Uuid                           // cascade → TelegramCollectionSubscription
  eventType      String  @db.VarChar(64)
  eventId        String  @db.Uuid                           // deterministic sha256(outboxRowId) — 7A pattern
  payload        Json                                       // metadata envelope (ids/hints only, no titles)
  status         TelegramDeliveryStatus @default(PENDING)
  attempts       Int     @default(0)
  nextAttemptAt  DateTime @default(now())
  lockedAt / lockedBy(varchar 64)
  responseSnippet String? @db.VarChar(500)
  lastError       String? @db.VarChar(500)
  createdAt
  @@unique([subscriptionId, eventId])                       // idempotent re-fan-out
  @@index([status, nextAttemptAt])
}

model TelegramBotCommandAudit {
  id             String  @id @default(uuid(7)) @db.Uuid
  connectionId   String  @db.Uuid                           // cascade
  chatId         String  @db.VarChar(32)                    // raw Telegram chat id
  telegramUserId String  @db.VarChar(32)
  linkedUserId   String? @db.Uuid                           // resolved AnyNote user, if linked
  command        String  @db.VarChar(32)                    // help | link | search | get | unknown
  argsSummary    String? @db.VarChar(200)                   // truncated, never page content
  result         TelegramCommandResult
  detail         String? @db.VarChar(200)                   // denial reason / error class
  createdAt
  @@index([connectionId, createdAt(sort: Desc)])
}
```

`OutboxAggregateType` union in `packages/db/src/index.ts` widens to include
`'telegram_event'`, and `enqueueWebhookEvent` is generalised: a new
`enqueueIntegrationEvents(tx, args)` writes **both** the `webhook_event` and the
`telegram_event` rows with identical payloads; all 7A emission call sites
(pages repository, comment router, yjs persistence) switch to it. Rows are
emitted unconditionally (the 7A precedent): a fan-out tick with no matching
subscriptions marks them DONE with zero deliveries.

## 3. `@repo/telegram` package (new, Tier-2 like `@repo/webhooks`)

Exports `.` (api client, command router, rendering) + `./worker` (ticks).
Real-DB vitest suites run inside `pnpm gates`. The worker deep-imports
`@repo/auth/secret-encryption.ts` (7A pattern — avoids better-auth instantiation).

- **`api.ts`** — minimal Bot API client: `getMe`, `setWebhook`, `deleteWebhook`,
  `sendMessage`. Constructor takes `{ token, fetchFn?, baseUrl? }`;
  `baseUrl` defaults to `process.env.TELEGRAM_API_BASE_URL ?? 'https://api.telegram.org'`.
  Fixed host — **no user-controlled URLs, no SSRF surface**. Timeouts via
  AbortSignal (`TELEGRAM_TIMEOUT_MS`, default 10 s). Errors surface
  `{ ok: false, description }` without ever logging the token.
- **`secret.ts`** — `generateWebhookSecret()` (base62, 32 chars) +
  `generateLinkCode()` (8-char base32, sha256-hashed at rest).
- **`commands.ts`** — pure command router: `routeUpdate(deps, connection, update)`
  parses a Telegram `Update`, dispatches to handlers, returns
  `{ reply?: string, audit: {...} }`. All I/O behind an injected `deps` object
  (prisma + clock) so unit tests need no network.
- **`render.ts`** — message templates (Russian), HTML parse-mode with escaping.
- **`worker/fan-out.ts`** — claims `telegram_event` outbox rows
  (`FOR UPDATE SKIP LOCKED`, PENDING→PROCESSING→DONE/FAILED, 7A backoff):
  re-uses `passesVisibilityGate` and `sanitizeHints` **imported from
  `@repo/webhooks`** (single no-leak implementation), then matches
  `TelegramCollectionSubscription` rows where the page's `collectionId` equals
  the subscription's collection AND the event type is selected AND the
  subscription's chat is ACTIVE AND the connection is ACTIVE. Creates
  `TelegramDelivery` rows with deterministic `eventId` + `skipDuplicates`.
  Note: the gate already admits only TEAM-or-null collections; subscriptions
  are per-collection, so pages with `collectionId: null` match no subscription.
- **`worker/deliver.ts`** — claims due PENDING deliveries (stale-lock reclaim
  10 min, 7A pattern), decrypts the bot token (decrypt failure ⇒ terminal FAILED
  + connection error counter), **fetches the page title at send time** (see §6),
  renders the message, `sendMessage`. Failure ⇒ exponential backoff 60 s·2^n cap
  30 min, max `TELEGRAM_MAX_ATTEMPTS` (default 8). Telegram 403
  (bot kicked from chat) ⇒ mark the chat `LEFT`, delivery SKIPPED, no retries.
  `consecutiveFailures` ≥ 10 on the connection ⇒ status ERROR (auto-disable;
  resume by reconnect or `setEnabled` after the cause is fixed).

## 4. Inbound webhook (apps/web)

`POST /api/telegram/webhook/[connectionId]` (Next route, yookassa-style):

1. Load the connection; 404 if missing/DISABLED.
2. Compare `X-Telegram-Bot-Api-Secret-Token` against the decrypted
   `webhookSecretEnc` (timing-safe). Mismatch ⇒ 403.
3. Parse the `Update`. Handle:
   - `my_chat_member` / first `message` from an unknown chat ⇒ upsert
     `TelegramChat` (status ACTIVE; `left`/`kicked` ⇒ LEFT).
   - `message` with a command ⇒ `routeUpdate` (see §5); reply via `sendMessage`
     (best-effort, errors swallowed); audit row written **always**.
4. Always 200 within Telegram's timeout; processing is synchronous (commands are
   single-query cheap).

`telegram.connect` performs, synchronously in the mutation (7A challenge
precedent, `TELEGRAM_TIMEOUT_MS`-bounded): `getMe` (token validity, captures
`botUsername`) then `setWebhook(url = ${BETTER_AUTH_URL}/api/telegram/webhook/${id},
secret_token)`. Both OK ⇒ ACTIVE; either fails ⇒ connection saved with status
ERROR + `lastError` (admin can retry via `verify`). Local dev without a public
URL simply stays ERROR — documented, not worked around.

## 5. Command surface & permission ladder

Every inbound command writes a `TelegramBotCommandAudit` row, including denials.

| Command | Gate | Behaviour |
| --- | --- | --- |
| `/help` | none | static help text; lists commands and the linking requirement |
| `/link <code>` | valid unexpired unused `TelegramLinkCode` | binds sender's `telegramUserId` to the code's user (upsert `TelegramUserLink`, replacing the user's previous link); marks code used. Code already-linked-elsewhere ⇒ DENIED |
| `/search <q>` | linked **and** workspace member | case-insensitive **title** search (`contains`) over pages whose `collectionId` is in the set of collections subscribed **to this chat**, excluding trashed/archived pages and database item-pages (`excludeDatabaseRowPages`); top 5 as title + deep link |
| `/get <pageId>` | linked **and** workspace member **and** page's collection subscribed to this chat | one result: title, deep link, updatedAt. **Never page content.** Invalid UUID / non-visible ⇒ uniform "not found" (no existence oracle) |

Denial ladder (uniform Russian replies, audited with distinct `detail`):
not linked → "свяжите аккаунт"; linked but not a member of the connection's
workspace → denied; chat has no subscriptions → empty scope reply. PERSONAL
collections can never appear: subscriptions are TEAM-only at creation **and**
search/get filter by the subscribed-collection set (defence in depth).

## 6. Privacy & no-leak rules

- The **stored** delivery payload is the 7A metadata envelope (ids, actor id,
  sanitized hints) — `assertNoForbiddenKeys` applies; no titles at rest in
  `TelegramDelivery.payload`.
- The outgoing **message text** may include the page title, fetched at send
  time after a visibility **re-check** (page still exists, not deleted,
  collection still TEAM **and still equals the subscription's collection**).
  Re-check fails ⇒ delivery SKIPPED. Rationale: chat members were explicitly
  opted in by an admin per collection; a stale title in a crash-retried row is
  the leak vector this kills.
- Page **bodies** are never sent (notifications or commands).
- Bot tokens, webhook secrets, link codes: encrypted or hashed at rest, never
  returned by any read procedure, never logged.
- `argsSummary` in the audit stores the command argument truncated to 200 chars
  — search queries yes, page content never.

## 7. tRPC router `telegram.*` (packages/trpc)

Workspace-management procedures all gated `assertRole(OWNER|ADMIN)` +
`developerSpaceEnabled` (7A `assertWebhookAccess` pattern):

- `getConnection` — status, botUsername, failure info; **no secrets**.
- `connect { workspaceId, botToken }` — validates token shape (`^\d+:[\w-]{30,}$`),
  encrypts, creates connection (one per workspace; reconnect replaces token +
  re-runs getMe/setWebhook), returns status. Token never echoed back.
- `verify { workspaceId }` — re-runs getMe + setWebhook on an ERROR/PENDING connection.
- `disconnect { workspaceId }` — best-effort `deleteWebhook`, status DISABLED,
  cancels (SKIPPED) pending deliveries.
- `listChats`, `removeChat { chatId }` (delete chat + its subscriptions).
- `createSubscription { chatId, collectionId, events }` — collection must belong
  to the workspace and be `kind: TEAM` (else BAD_REQUEST); events ⊆ catalog;
  ≤ 50 subscriptions per connection.
- `updateSubscription { id, events }`, `deleteSubscription { id }`.
- `listSubscriptions`, `deliveries { cursor }` (keyset, 30/page, no payload
  internals beyond event/status/attempts/error), `auditLog { cursor }`.

Member-level (any workspace member; **not** plan-gated):
- `createLinkCode` — returns the plaintext code once (15-min TTL).
- `getMyLink` / `unlinkMe` — user-level identity status.

## 8. Settings UI (apps/web)

- **Workspace settings → «Telegram»** (slug `telegram`, after `webhooks`,
  `show: features.developerSpaceEnabled`, `canManage` = OWNER/ADMIN; non-managers
  see the info Alert with queries disabled — 7A pattern). Contents:
  connect card (token field with BotFather hint → bot username + status chip;
  Проверить/Отключить), chats list (title, type, status, remove), subscriptions
  table (chat × collection picker [TEAM collections via `collection.list`
  filtered client-side to kind=TEAM] × event checklist reusing the local
  `webhook-events.ts` labels), delivery log table, audit log table.
  testids: `telegram-connect`, `telegram-token-input`, `telegram-chat-row`,
  `telegram-subscription-create`, `telegram-subscription-row`, `telegram-audit`.
- **Personal `/settings/integrations`**: «Telegram» card — generate link code
  (one-time display + instructions `/link <code>`), linked status
  (`@username`, linkedAt), unlink button. testid: `telegram-link-code`.

## 9. Engines cron (apps/engines)

`apps/engines/src/apps/telegram/` — `TelegramModule` + `TelegramCronService`
(7A WebhookCronService verbatim style): `@Cron(TELEGRAM_CRON_EXPRESSION ?? '*/5 * * * * *')`
runs `runTelegramFanOutTick` then `runTelegramDeliveryTick`, errors caught+logged.
Env (all in `.env.example` **and** `turbo.json` globalEnv): `TELEGRAM_API_BASE_URL`,
`TELEGRAM_CRON_EXPRESSION`, `TELEGRAM_BATCH_SIZE`, `TELEGRAM_MAX_ATTEMPTS`,
`TELEGRAM_TIMEOUT_MS`.

## 10. Testing

No live Telegram anywhere (cl7.2 hard rule).

- `@repo/telegram` vitest (real DB, 7A fixture patterns incl. drain-loop +
  backdated `nextAttemptAt`): command router (the full §5 permission ladder,
  incl. personal-collection never searchable and unsubscribed-chat empty scope),
  fan-out (subscription/event filter, TEAM gate, LEFT chat and DISABLED
  connection receive nothing, deterministic eventId idempotency), deliver
  (mocked `fetchFn`: success, retry/backoff, 403⇒chat LEFT, decrypt-failure
  terminal, send-time title re-check skip), api client (token never in logs,
  timeout abort), secrets.
- tRPC router tests (dedicated plan fixture, 7A `wh-test-pro` pattern): role +
  plan gates on every workspace procedure, TEAM-only subscription enforcement,
  token-shape rejection, no-secret-exposure shapes, link-code lifecycle.
- Inbound route unit tests: secret-token mismatch 403, chat upsert, command
  dispatch + audit row, LEFT transition.
- E2E `apps/e2e/telegram.spec.ts`: plan-flag flip (7A beforeAll/afterAll
  try/finally pattern); Playwright webServer env sets
  `TELEGRAM_API_BASE_URL=http://127.0.0.1:9` (unroutable ⇒ connect fails fast,
  deterministic): connect with a well-formed fake token → status «Ошибка»
  visible; personal link-code card generates and displays a code.
- Changelog block «Телеграм-бот для пространств» in «Готовится».

## 11. Non-goals (this phase)

- share/publish commands from chat; inline queries; channel posts.
- Per-page subscriptions (collections only).
- Multiple connections per workspace; self-hosted Bot API servers beyond the
  `TELEGRAM_API_BASE_URL` override.
- Digest/batching of notification messages (one message per delivery; the 7A
  outbox burst characteristics apply).
- Localisation beyond Russian.
