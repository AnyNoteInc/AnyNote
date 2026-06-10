# Notion-parity Phase 7A — Outbound webhook subscriptions

**Date:** 2026-06-10
**Branch:** `feat/notion-phase-7a-webhooks`
**Status:** approved design (cl7 prompt 7.1)
**Siblings:** 7B Telegram bot (reuses this event substrate), 7C public developer portal
(documents this API). Each ships separately.

## 1. Goals and non-goals

**Goals**

1. Workspace admins create webhook subscriptions with selected event types;
   delivery is HTTPS-only, HMAC-signed, verified before activation, retried with
   backoff, logged per delivery, and auto-disabled after repeated failures.
2. Event catalog (payload version 1): the page lifecycle
   (`page.created`, `page.content_updated`, `page.properties_updated`,
   `page.moved`, `page.deleted`, `page.undeleted`) and comments
   (`comment.created`, `comment.resolved`). Collection/database-row events are
   documented as «coming» in the catalog and added only if trivially cheap
   during execution.
3. **Privacy rule:** payloads are metadata-only (ids, timestamps, actor id,
   changed-property hints — NEVER titles or content). Subscriptions receive
   events only for workspace-visible (TEAM/null-collection) resources; personal
   collections and pages shared to specific users never fan out. Consumers
   fetch details through the existing authenticated public API
   (`apps/engines /v1/*`, `Bearer ank_…`).
4. Settings UI («Вебхуки») gated on `Plan.developerSpaceEnabled` (plan) and
   owner/admin (mutations).

**Non-goals**

- Automation webhook actions (buttons/database automations) — out of cl7A;
  the catalog/docs note them as a separate future surface.
- Telegram (7B), the developer portal content (7C).
- API-key scopes/workspace-scoped keys — keys stay personal full-access; 7C
  documents reality.
- No changes to the skeleton `Integration`/`IntegrationProvider` tables —
  `WebhookSubscription` is the self-contained connection record.

## 2. Data model (additive migration)

```prisma
enum WebhookSubscriptionStatus { PENDING ACTIVE DISABLED FAILED }
enum WebhookDeliveryStatus     { PENDING PROCESSING DELIVERED FAILED }

model WebhookSubscription {
  id                  String  @db.Uuid            // gen_random_uuid()
  workspaceId         String  @db.Uuid
  createdById         String  @db.Uuid
  name                String                       // ≤100
  url                 String                       // https:// enforced
  secretEnc           Json                         // EncryptedPayload (AES-256-GCM via @repo/auth encryptSecret)
  events              String[]                     // subset of the catalog
  status              WebhookSubscriptionStatus @default(PENDING)
  payloadVersion      Int     @default(1)
  verifiedAt          DateTime?
  consecutiveFailures Int     @default(0)
  createdAt/updatedAt
  // relations: workspace (Cascade), createdBy (Cascade), deliveries
  // @@index([workspaceId, status])
}

model WebhookDelivery {
  id              String @db.Uuid
  subscriptionId  String @db.Uuid                  // Cascade
  eventType       String
  eventId         String @db.Uuid                  // stable id (uuid) carried in headers/payload
  payload         Json                             // the exact body sent (metadata-only)
  status          WebhookDeliveryStatus @default(PENDING)
  attempts        Int @default(0)
  nextAttemptAt   DateTime @default(now())
  lockedAt/lockedBy                                 // SKIP-LOCKED claim (NotificationDelivery pattern)
  responseStatus  Int?
  responseSnippet String?                          // first ≤500 chars
  latencyMs       Int?
  lastError       String?
  createdAt
  // @@index([status, nextAttemptAt]), @@index([subscriptionId, createdAt])
}
```

The signing secret: generated server-side (`whsec_` + 32 base62), returned to
the client **exactly once** at create/rotate, stored only as `secretEnc`. `list`
and every other read path never include it.

## 3. Event emission (dual outbox rows)

The indexer cron consumes (marks DONE) `aggregate_type='page'` rows, so webhook
fan-out gets its OWN rows: mutation sites that already enqueue indexing events
additionally enqueue `aggregateType: 'webhook_event'` rows via a small helper
(`enqueueWebhookEvent(tx, { event, resourceType, resourceId, workspaceId,
actorId, hints })` in `packages/db` next to `enqueueOutboxEvent`; the
`OutboxAggregateType` union gains `'webhook_event'`). Payload carries the
DERIVED event name:

- `pages.repository.ts` call sites map their mutation kind →
  `page.created | page.content_updated | page.properties_updated | page.moved |
  page.deleted | page.undeleted` (the repository methods know which mutation
  they are — create/update-title-icon/move/trash/restore; content saves from
  the yjs path flow through the existing `page.upserted` site used by indexing —
  the WEB yjs persistence does not write outbox rows, so `page.content_updated`
  derives from the tRPC/page-service content writes and the import/restore
  paths; document the caveat that realtime collab edits coalesce through cl5
  revisions, not per-keystroke webhooks).
- `comment` router: new emissions `comment.created`, `comment.resolved`
  (pageId as resourceId, commentId/threadId in hints).
- Item pages of databases (rows) intentionally do NOT produce page.* webhook
  deliveries in 7A: the FAN-OUT pass (which already resolves the resource for
  the visibility gate) excludes pages whose parent is a DATABASE page —
  one authority, one query. `database.row_changed` is a documented «coming» event.

`hints` examples: `{ changed: ['title'] }`, `{ from: parentId, to: parentId }`,
`{ threadId, commentId, resolved: true }`.

## 4. Fan-out pass (engines WebhookModule, pass 1)

New `apps/engines/src/apps/webhook/` NestJS module, cron
`WEBHOOK_CRON_EXPRESSION` (default every 5s like the notifier):

1. Claim a batch of `webhook_event` outbox rows (SKIP LOCKED).
2. For each: load ACTIVE subscriptions of that workspace whose `events`
   contains the type. None → DONE.
3. **TEAM-visibility gate:** resolve the resource (pageId) and require its
   collection kind to be TEAM or null AND not personal-shared-only; trashed →
   only `page.deleted` itself passes. Personal/none-visible → DONE, zero
   deliveries (THE no-leak invariant; integration-tested).
4. Create one `WebhookDelivery` per matching subscription with the
   metadata-only payload:

```json
{
  "version": 1,
  "id": "<eventId>",
  "event": "page.moved",
  "timestamp": "2026-06-10T18:00:00.000Z",
  "workspaceId": "…",
  "actor": { "id": "…" },
  "resource": { "type": "page", "id": "…" },
  "hints": { "from": "…", "to": "…" }
}
```

No `title`, `content`, `body`, `text`, `name` keys anywhere (regression test
asserts the forbidden-key list).

## 5. Delivery pass (pass 2) + security

1. Claim PENDING deliveries past `nextAttemptAt` (SKIP LOCKED, batch env).
2. **Send-time visibility re-check** (resource may have moved to personal or
   trash since enqueue) → terminal FAILED with
   `lastError: 'resource no longer workspace-visible'`, no retry, does NOT
   count toward auto-disable.
3. **SSRF guard:** URL must be https (validated at create AND here); resolve
   the hostname per attempt and refuse private/loopback/link-local/CGN/
   metadata ranges (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16 incl.
   169.254.169.254, ::1, fc00::/7, fe80::/10, 100.64/10). The resolver +
   range check live in a pure, unit-tested helper.
4. POST JSON with headers:
   - `X-AnyNote-Signature: sha256=<hex HMAC-SHA256(secret, "{timestamp}.{body}")>`
   - `X-AnyNote-Event`, `X-AnyNote-Delivery` (delivery id),
     `X-AnyNote-Timestamp` (unix seconds), `X-AnyNote-Payload-Version: 1`,
     `Content-Type: application/json`, 10s timeout (env).
   Replay protection is the consumer's check (reject stale timestamps,
   verify HMAC over `timestamp.body`) — documented in 7C.
5. 2xx → DELIVERED (+responseStatus/latencyMs/snippet); else retry
   `60s * 2^attempts` capped 30 min, `WEBHOOK_MAX_ATTEMPTS` (default 8) →
   FAILED. Terminal FAILED increments `consecutiveFailures`; any DELIVERED
   resets it; reaching 10 → subscription `status: FAILED` (auto-disabled; the
   UI shows «Ошибки» and offers re-enable, which re-verifies). `DISABLED` is
   the MANUAL pause state (admin toggle): fan-out skips it, no verification
   needed to resume — `setEnabled` flips DISABLED↔ACTIVE only if verifiedAt set.
6. The fetch adapter is injected (constructor/provider) so tests never call
   the network.

## 6. Verification (challenge-response)

Create → status PENDING + an immediate challenge delivery: POST
`{ "type": "verification", "challenge": "<32 base62>", "subscriptionId": "…" }`
(signed like a normal delivery, `X-AnyNote-Event: verification`). The endpoint
must return 2xx with the challenge string contained in the response body
(first 4KB) within 10s → `status: ACTIVE`, `verifiedAt` set. Otherwise stays
PENDING; the UI offers «Отправить проверку ещё раз» (tRPC `verify`). URL change
on update → back to PENDING + re-challenge. No event deliveries while not
ACTIVE (fan-out only matches ACTIVE).

## 7. tRPC router + settings UI

`webhook` router — every procedure: workspace member + OWNER/ADMIN role +
`developerSpaceEnabled` plan flag (list/deliveries allow EDITOR read? — NO:
owner/admin only, webhooks are an admin surface):

- `create({ workspaceId, name, url, events[] })` → validates https + catalog
  membership + ≤20 subscriptions per workspace; returns `{ id, secret }` —
  the only time the secret crosses the wire.
- `update({ id, name?, url?, events? })` — url change resets to PENDING +
  re-challenges.
- `rotateSecret({ id })` → new secret returned once; old signatures invalid
  immediately (documented).
- `verify({ id })` — re-send the challenge.
- `setEnabled({ id, enabled })` — manual pause/resume (DISABLED↔ACTIVE;
  resume without re-verification when `verifiedAt` is set).
- `delete({ id })`.
- `list({ workspaceId })` — no secrets; includes status/verifiedAt/
  consecutiveFailures/events/url.
- `deliveries({ subscriptionId, cursor? })` — paginated log (eventType,
  status, attempts, responseStatus, latencyMs, createdAt, lastError).

Settings section «Вебхуки» (`apps/web/src/components/workspace/settings/webhooks-section.tsx`),
registered with `show: features.developerSpaceEnabled && isOwnerOrAdmin`:
subscription cards/table (status chip: Ожидает проверки / Активен / Отключен /
Ошибки), create/edit dialog with the event checklist + per-event ru
descriptions, the one-time secret dialog (copy button, «секрет показывается
только один раз»), re-verify + rotate + delete actions, and a per-subscription
delivery log table (paginated).

## 8. Testing

- **Unit:** HMAC format (`sha256=<hex>` over `timestamp.body`); SSRF range
  classifier (each blocked range + happy public IP + DNS-resolution injection);
  event-name derivation map; payload builder (forbidden-key regression:
  title/content/body/text/name absent); secret generation format.
- **Integration (real DB, injected fetch mock):** challenge flow (echo →
  ACTIVE; wrong echo / non-2xx → stays PENDING); fan-out: TEAM page event →
  delivery rows per matching subscription; PERSONAL page event → ZERO rows
  (the leak test); event filter respected; send-time re-check (move page to
  personal between fan-out and send → FAILED no-retry, no auto-disable count);
  retry/backoff scheduling (attempts increment, nextAttemptAt grows); max
  attempts → FAILED + consecutiveFailures + auto-disable at 10; success resets
  the counter; non-HTTPS create rejected; subscription cap; secret never in
  `list`/`deliveries` output; rotate invalidates (signature computed with new
  secret).
- **E2E:** settings UI flow — create subscription (mock receiver not needed:
  assert PENDING status + one-time secret dialog), delivery log renders seeded
  rows. No live network calls anywhere.

## 9. Env / config

`WEBHOOK_CRON_EXPRESSION` (default `*/5 * * * * *`), `WEBHOOK_BATCH_SIZE`
(default 20), `WEBHOOK_MAX_ATTEMPTS` (default 8), `WEBHOOK_TIMEOUT_MS`
(default 10000). All added to `.env.example` + `turbo.json globalEnv` (the
4-place deploy rule applies at release time; deploy templates are out of this
phase's scope but flagged in the PR description). `SECRETS_ENCRYPTION_KEY`
already exists.
