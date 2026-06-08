# Integrations: webhooks, Telegram, developer portal

## Описание фазы

Эта фаза adds external automation and developer-facing surfaces: Notion-like API connections, outbound webhook subscriptions, AnyNote-specific Telegram workspace notifications and public developer portal/API documentation.

Notion alignment:

- Notion analogs for this phase are integrations/API connections, Developer Platform docs, connection webhooks, webhook actions in database/buttons automations, link previews/connectors and public API docs.
- Telegram is not a core Notion feature. Treat Telegram as an AnyNote-specific notification/integration channel that must reuse the same workspace permission and content-access rules as other integrations.
- Outbound webhook/API docs must be scoped like a developer platform: authentication, event catalog, versioned payloads, endpoint verification, HMAC signatures, retries, delivery logs, rate/security caveats and least-privilege content access.
- Preserve AnyNote constraints: no live external calls in tests, encrypted/hashed secrets, no leakage of personal/private documents, and workspace admin controls for external integrations.

## Полный ожидаемый результат

- Workspace admins can create developer/integration webhook subscriptions with selected events.
- Webhook delivery uses verified HTTPS endpoints, signed JSON payloads, retries, backoff and delivery logs.
- Automation-style webhook actions, if implemented in this phase, are scoped to explicit workspace/database automations and documented separately from developer webhook subscriptions.
- Telegram bot integration can connect/disconnect chats and subscribe chats to safe collection/page notifications.
- Telegram command permissions prevent personal/private document leaks.
- Public developer portal explains API keys/tokens, connection permissions, webhook event schemas, examples, versions, changelog and deprecation policy.

## Scope и ограничения

No tests should call live Telegram or arbitrary external services. Use mocked adapters. Secrets must be stored encrypted/hashed and never returned to the client. Webhook payloads must carry metadata/signals and stable resource IDs; do not include full private page content unless the event type explicitly allows it and the integration has content access.

## Рабочее задание фазы

Цель: добавить внешнюю автоматизацию и документацию API.

## Prompt 7.1 - outbound webhooks

```text
Цель: добавить developer-platform-style outbound webhook subscriptions for workspace integrations.

Notion parity boundary:
- Align with Notion connection webhooks: subscriptions live under an integration/connection surface, use selected event types, require endpoint verification, send secure HTTP POST JSON payloads and include signatures.
- Do not model Telegram as part of Notion parity.
- If adding automation webhook actions, keep them separate from subscriptions: action-triggered HTTP POST from a button/database automation can support custom headers and explicit property payload selection, but must be documented as automation action behavior, not the main developer webhook subscription API.

Ориентиры по коду и текущей реализации:
- packages/trpc/src/routers/integration.ts
- existing outbox/event patterns
- Notification/Event models if reusable
- apps/web/src/components/workspace/settings/**

Сделай:
1. Add models:
   - IntegrationConnection or equivalent if a generic connection container is missing;
   - WebhookSubscription;
   - WebhookDelivery;
   - WebhookEventSchemaVersion or payloadVersion field.
2. Add settings UI:
   - WebhooksSettingsPage;
   - connection/subscription list;
   - create/edit dialog;
   - event selector;
   - endpoint verification status;
   - secret rotate/copy only at creation/rotation time;
   - delivery log table.
3. Add dispatcher:
   - HTTPS-only validation;
   - endpoint verification challenge before activation;
   - signed payload with timestamp and event id headers;
   - replay-safe HMAC verification docs;
   - retries/backoff with attempt_number;
   - auto-disable after repeated failures.
4. Event catalog MVP:
   - page created/content_updated/properties_updated/moved/deleted/undeleted;
   - comment created/resolved;
   - collection created/updated;
   - database/data-source row changed if database exists;
   - document publication events only if AnyNote has a first-class publish workflow.
5. Security/content rules:
   - deliver only events for resources visible to the connection scope;
   - event payload contains ids, timestamps, actor metadata and changed-property hints, then consumers fetch details through authenticated API;
   - personal collections/private pages never emit to workspace-wide integrations unless explicitly shared with that connection;
   - document payload versioning and event ordering caveats.
6. Tests:
   - signature generated;
   - endpoint verification required before activation;
   - retry scheduled;
   - non-HTTPS rejected;
   - delivery log visible.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types

Критерий готовности:
- Workspace admins can connect reliable webhooks.
```

## Prompt 7.2 - Telegram integration

```text
Цель: добавить AnyNote-specific Telegram bot integration for notifications and carefully-scoped commands.

Notion parity boundary:
- Telegram is not a core Notion feature or parity requirement. Treat it as an AnyNote notification channel that follows Notion-like connection governance: workspace admin install, explicit content access, disconnect controls and auditability.
- Do not make Telegram the canonical developer platform. It should consume the same internal event/notification abstractions as webhooks, with stricter privacy defaults.

Ориентиры по коду и текущей реализации:
- packages/trpc/src/routers/integration.ts
- notification infrastructure
- workspace settings UI

Сделай:
1. Add models:
   - TelegramConnection;
   - TelegramCollectionSubscription;
   - TelegramBotCommandAudit.
2. Add settings UI:
   - connect/disconnect card;
   - chat picker;
   - collection -> chat subscriptions;
   - delivery/error log.
3. Add bot command router:
   - /help;
   - search only within explicitly exposed workspace collections;
   - fetch/share/publish only if the requesting Telegram identity is mapped to an AnyNote user with rights.
4. Add permissions:
   - who can connect bot;
   - which collections can be exposed;
   - personal collection must not leak.
5. Privacy and security:
   - never expose personal/private pages by default;
   - require explicit admin opt-in per collection/chat;
   - map Telegram users to AnyNote identities before command access;
   - audit every command that reads or shares content;
   - keep message payloads minimal and avoid sending full page bodies unless explicitly allowed.
6. Tests:
   - command permission checks;
   - collection update fanout;
   - disconnected chat receives nothing.

Не делай:
- Не коммить реальные bot token secrets.
- Не завязывай tests на live Telegram API; mock adapter.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types

Критерий готовности:
- Telegram integration is configurable and safe by default.
```

## Prompt 7.3 - public developer portal and API docs

```text
Цель: сделать внешнюю developer documentation сопоставимой с Notion Developer Platform.

Notion parity boundary:
- Cover API connections/integrations, public API authentication, selected-resource access, capabilities/scopes, webhook subscriptions, webhook actions if implemented, versioning/changelog and examples.
- Mention link previews/connectors as a future/deferred integration surface unless AnyNote already has first-class unfurl APIs.
- Do not document v2, OAuth, Marketplace listing or public app review as available unless actual AnyNote implementation exists.

Ориентиры по коду и текущей реализации:
- packages/trpc/src/routers/api-key.ts
- apps/e2e/public-api.spec.ts
- README docs around API keys
- app marketing/public routes

Сделай:
1. Add public developers route:
   - overview;
   - authentication with API keys/tokens;
   - connection permissions/scopes and selected-resource access;
   - API v1 current/stable;
   - API v2 preview placeholder only if actual API exists.
2. Generate or maintain OpenAPI artifact for public routes if current API shape
   supports it. If not, document exact supported endpoints manually.
3. Add examples:
   - curl;
   - JS fetch;
   - error handling;
   - pagination if applicable.
4. Add webhook docs:
   - event catalog and payload schema versions;
   - endpoint verification;
   - signature headers and replay protection;
   - retry/backoff semantics and idempotency guidance;
   - security caveats: secret storage, HTTPS, private content exclusion and fetching latest state through authenticated API.
5. Add changelog/deprecation policy page.
6. Add integration docs:
   - internal/private workspace integrations first;
   - public/OAuth/marketplace concepts only as future roadmap unless implemented;
   - link previews/connectors as deferred parity surface if not implemented in this phase.
7. Tests:
   - developers page renders;
   - examples match actual API auth behavior;
   - webhook docs match implemented signature/header names;
   - links are valid internal routes.

Проверки:
- pnpm --filter web lint
- pnpm check-types
- pnpm exec playwright test apps/e2e/public-api.spec.ts

Критерий готовности:
- External developers can understand and start using the public API.
```
