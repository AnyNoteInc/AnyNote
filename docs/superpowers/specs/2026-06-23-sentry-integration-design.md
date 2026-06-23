# Sentry integration — design

Date: 2026-06-23
Status: approved (brainstorm), pending implementation plan

## Goal

Wire Sentry error monitoring + request telemetry across the AnyNote monorepo,
separating frontend from backend, tagging the app's key moments, and tuning
everything for the **free tier** (one org, shared monthly event/transaction
quota). "Squeeze the maximum" means: capture every error with rich context,
sample tracing cheaply, record a replay only when something breaks — without
burning the quota.

## Sentry project topology

Two projects under the free org:

- **`anynote-frontend`** — the browser. DSN already provisioned:
  `https://90c796703ae6e26d5690edc15fdf6293@o4511613297623040.ingest.de.sentry.io/4511613305290832`
  → wired as `NEXT_PUBLIC_SENTRY_DSN`.
- **`anynote-backend`** — every server-side runtime: Next.js server + edge,
  engines, yjs, agents. **One** DSN (`SENTRY_DSN`), but every event carries a
  `service` tag so you filter within the project:
  `web-server | engines | yjs | agents`.

The backend DSN must be created in the Sentry UI before deploy. Until it is set,
every backend SDK init is a no-op (empty DSN → SDK disabled), so the app runs
unchanged.

`apps/desktop` is a thin Electron client that loads the remote web app; the
browser SDK already covers it. No separate wiring.

## Per-service wiring

### apps/web — `@sentry/nextjs` (browser + server + edge)

One SDK, three runtimes. Next.js 16 + Turbopack.

Files to add at `apps/web/`:

- `instrumentation.ts` — `register()` dynamic-imports server/edge config by
  `NEXT_RUNTIME`; `export const onRequestError = Sentry.captureRequestError`
  (captures Server Component / middleware / route errors).
- `instrumentation-client.ts` — browser `Sentry.init` (current Next convention,
  replaces the legacy `sentry.client.config.ts`). Uses `NEXT_PUBLIC_SENTRY_DSN`.
  Includes `browserTracingIntegration` + `replayIntegration`.
- `sentry.server.config.ts` — Node runtime `Sentry.init`, `service=web-server`.
- `sentry.edge.config.ts` — edge runtime `Sentry.init`, `service=web-server`.
- `src/app/global-error.tsx` — `"use client"`, `Sentry.captureException` for
  React render errors (App Router has no error boundary above this).

`next.config.js` is wrapped with `withSentryConfig(nextConfig, { silent:
!process.env.CI, ... })`. `org`/`project` slugs and `authToken` are only needed
for **source-map upload** and are read from env (`SENTRY_ORG`, `SENTRY_PROJECT`,
`SENTRY_AUTH_TOKEN`) — all CI-only. When absent (local dev), the wrapper is a
no-op passthrough: the app builds and the SDK still captures errors, just with
minified stack traces and no upload. So the wrapper is always safe to apply.

tRPC procedures and route handlers are auto-instrumented by the Next SDK — no
per-procedure code needed for baseline spans.

### apps/engines — `@sentry/nestjs`

- `src/instrument.ts` — `Sentry.init` with `service=engines`. **Imported as the
  very first line of `src/main.ts`** (before `reflect-metadata` side effects and
  `AppModule`), because the SDK must patch modules before they load.
- Register `SentryModule.forRoot()` in `AppModule` and add the Sentry global
  filter so unhandled exceptions in HTTP handlers **and** the cron workers
  (indexer, mailer, billing) are captured.

### apps/yjs — `@sentry/node`

Plain Node Hocuspocus server, ESM. `Sentry.init` at the top of `src/index.ts`
(after `loadEnv`, since DSN comes from env), `service=yjs`. Manual
`Sentry.captureException` in the error paths of `onAuthenticate` (JWT failures)
and `onStoreDocument`/`onLoadDocument` (persist/load failures), tagged with
`documentName`.

### apps/agents — reuse existing `fast_clean.use_sentry`

`bootstrap.py` already calls `use_sentry(settings.sentry_dsn)`, but
`settings.py` has **no** `sentry_dsn` field, so it currently reads as missing.
Add the field (pydantic-settings, env `SENTRY_DSN`), plus `environment` /
`traces_sample_rate` passthrough if `use_sentry` accepts them (verify the
`fast_clean` signature during implementation; if it doesn't, init the
`sentry_sdk` directly with the FastAPI integration). Tag `service=agents`.

## Common config (all services)

- `environment` — `production` / `development` from `NODE_ENV` (web/engines/yjs)
  or agents settings. Overridable via `SENTRY_ENVIRONMENT`.
- `release` — app version (`package.json` `version`, currently `0.1.0`) or git
  SHA in CI, so errors group by release + you get regression detection.
- `tracesSampleRate` — `0.1` default, per-service override via
  `SENTRY_TRACES_SAMPLE_RATE`. **Errors always captured at 100%** (sampling only
  affects tracing/transactions).
- `sendDefaultPii` — **off**. We attach user **id** + workspace id as context,
  never raw request bodies (the app has PII-processing consents to respect).
- No profiling. No continuous session replay.

## Key-moment instrumentation

A shared helper sets identity on the active scope:
`setSentryUser({ userId, workspaceId })` → `Sentry.setUser({ id })` +
`Sentry.setTag('workspaceId', …)`. Called from:

1. **User & workspace context** — tRPC context creation (server),
   `(protected)` layout (browser), engines request scope, yjs auth context,
   agents request middleware. Highest-value tag: every error says who/where.
2. **AI / LLM pipeline** (agents) — spans around the LangGraph flow; tags
   `provider`, `model`, `tool`; SSE stream errors captured. Ties into the known
   provider-error failure modes (DeepSeek tool-calling, connection-config).
3. **Realtime / Yjs** — JWT auth failures + doc load/persist errors with
   `documentName` tag (see yjs wiring above).
4. **Billing & integrations** — capture in the YooKassa webhook handler +
   `@repo/webhooks` / `@repo/telegram` delivery failures, tagged
   `provider` / `eventId`.

## Free-tier guardrails

- `tracesSampleRate=0.1` (env-tunable), no profiling, no continuous replay.
- **Session Replay: on-error only** — `replaysSessionSampleRate=0`,
  `replaysOnErrorSampleRate=1.0`. Near-zero cost on healthy traffic; full
  "watch the bug happen" replay when an error fires.
- `ignoreErrors` noise filter: `ResizeObserver loop`, network aborts
  (`AbortError`, `Failed to fetch` from navigation), browser-extension noise.
- `beforeSend` drops events when `environment === 'development'` unless an
  explicit `SENTRY_DEBUG=1` is set, so local dev never eats quota.

## Env & deploy wiring (the part that bites)

New vars. Each must land in **all** of: `.env.example`, `turbo.json`
`globalEnv`, `deploy/.env.template`, `deploy.yml` env block, and a GitHub
secret (per the established "new required env var → deploy pipeline" rule).

| Var | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | web browser | frontend project DSN (provided) |
| `SENTRY_DSN` | web server, engines, yjs, agents | backend project DSN |
| `SENTRY_ENVIRONMENT` | all | defaults to NODE_ENV; explicit in deploy |
| `SENTRY_TRACES_SAMPLE_RATE` | all | default `0.1` |
| `SENTRY_AUTH_TOKEN` | CI only | source-map upload; optional |
| `SENTRY_ORG` / `SENTRY_PROJECT` | CI only | source-map upload target; optional |

The DSN vars are **optional at runtime** — empty DSN disables the SDK, so a
missing secret degrades gracefully rather than crashing (contrast with the
YJS_SHARE_TOKEN_SECRET crash-loop). This must be true on every service.

## Testing

- **Unit**: the shared `setSentryUser` helper + `beforeSend` dev-drop filter
  (pure functions, no network). Assert dev events are dropped and user/tag
  shape is correct.
- **Build/type**: `pnpm gates` must stay green; `withSentryConfig` and the new
  instrumentation files must type-check. Confirm `serverExternalPackages` /
  `transpilePackages` don't conflict with the Sentry webpack/turbopack plugin.
- **Smoke**: a temporary `/api/sentry-check` (or equivalent) that throws, hit
  once per service in dev with a real DSN, confirm the event lands in the right
  project with the right `service` tag — then remove the throw route.
- No E2E: Sentry capture is side-effecting network I/O the Playwright server
  can't observe; covered by the manual smoke instead.

## Out of scope (YAGNI for this cycle)

- Profiling, continuous session replay, cron monitoring (Sentry Crons),
  user-feedback widget, custom dashboards/alerts beyond defaults.
- `apps/desktop` Electron-main-process SDK (renderer is covered by browser SDK).
- Migrating agents off `fast_clean.use_sentry` if it already works.
