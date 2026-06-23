# Sentry Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Sentry error monitoring + sampled request telemetry across all five backend/frontend runtimes of the AnyNote monorepo, separating a frontend Sentry project from a backend one, tagging the app's key moments, and tuning everything for the free tier.

**Architecture:** Two Sentry projects — `anynote-frontend` (browser DSN, baked into the web client bundle at build time) and `anynote-backend` (one DSN shared by web-server, engines, yjs, agents, each distinguished by a `service` tag). Each runtime initializes its platform-appropriate SDK as early as possible. A shared identity helper attaches `user.id` + `workspaceId` to every event. DSNs are optional at runtime — an empty DSN disables the SDK, so a missing secret degrades gracefully instead of crashing.

**Tech Stack:** `@sentry/nextjs` (web), `@sentry/nestjs` (engines), `@sentry/node` (yjs), `sentry_sdk` via `fast_clean` (agents, Python). Next.js 16 + Turbopack, NestJS 11 (ESM, `.js` import specifiers), Hocuspocus Node ESM, FastAPI/pydantic-settings.

**Spec:** `docs/superpowers/specs/2026-06-23-sentry-integration-design.md`

---

## File Structure

**New shared config (env / deploy):**
- `.env.example` — add the 6 Sentry vars with comments
- `turbo.json` — add the 6 vars to `globalEnv`
- `deploy/.env.template` — add backend vars (rendered via `envsubst`)
- `.github/workflows/deploy.yml` — add secrets→env in the render step + `NEXT_PUBLIC_SENTRY_DSN` build-arg

**apps/web (`@sentry/nextjs`):**
- Create `apps/web/instrumentation.ts` — `register()` + `onRequestError`
- Create `apps/web/instrumentation-client.ts` — browser init (replay + tracing)
- Create `apps/web/sentry.server.config.ts` — node runtime init
- Create `apps/web/sentry.edge.config.ts` — edge runtime init
- Create `apps/web/src/app/global-error.tsx` — React render-error capture
- Create `apps/web/src/lib/sentry-shared.ts` — `buildSentryInitOptions()` + `beforeSend` dev-drop + `ignoreErrors` list (pure, unit-tested)
- Modify `apps/web/next.config.js` — wrap with `withSentryConfig`
- Modify `apps/web/src/app/(protected)/layout.tsx` — set Sentry user (browser, via a small client component)

**packages/trpc (server identity):**
- Modify `packages/trpc/src/trpc.ts` — set Sentry user in `createContext`

**apps/engines (`@sentry/nestjs`):**
- Create `apps/engines/src/instrument.ts` — init before modules load
- Modify `apps/engines/src/main.ts` — import `./instrument.js` first
- Modify `apps/engines/src/app.module.ts` — `SentryModule.forRoot()` + global filter

**apps/yjs (`@sentry/node`):**
- Modify `apps/yjs/src/env.ts` — read Sentry env
- Modify `apps/yjs/src/index.ts` — init + capture in auth/persist error paths

**apps/agents (Python):**
- Modify `apps/agents/agents/settings.py` — add `sentry_dsn`, `sentry_traces_sample_rate`
- Modify `apps/agents/agents/bootstrap.py` — direct `sentry_sdk.init` with tracing + `service` tag

---

## Task 1: Shared web Sentry options (pure, unit-tested)

This is the one piece with real logic worth testing: the dev-event drop and the noise filter. Everything else is config wiring.

**Files:**
- Create: `apps/web/src/lib/sentry-shared.ts`
- Test: `apps/web/test/sentry-shared.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/test/sentry-shared.test.ts
import { describe, expect, it } from 'vitest'
import { IGNORE_ERRORS, makeBeforeSend } from '../src/lib/sentry-shared'

describe('makeBeforeSend', () => {
  it('drops events in development unless SENTRY_DEBUG is set', () => {
    const beforeSend = makeBeforeSend({ environment: 'development', debug: false })
    expect(beforeSend({ message: 'boom' } as never, {} as never)).toBeNull()
  })

  it('keeps events in development when debug is on', () => {
    const beforeSend = makeBeforeSend({ environment: 'development', debug: true })
    const evt = { message: 'boom' } as never
    expect(beforeSend(evt, {} as never)).toBe(evt)
  })

  it('keeps events in production', () => {
    const beforeSend = makeBeforeSend({ environment: 'production', debug: false })
    const evt = { message: 'boom' } as never
    expect(beforeSend(evt, {} as never)).toBe(evt)
  })
})

describe('IGNORE_ERRORS', () => {
  it('includes the common browser noise patterns', () => {
    expect(IGNORE_ERRORS).toContain('ResizeObserver loop limit exceeded')
    expect(IGNORE_ERRORS.some((p) => String(p).includes('AbortError'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run test/sentry-shared.test.ts`
Expected: FAIL — cannot find module `../src/lib/sentry-shared`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/src/lib/sentry-shared.ts
import type { ErrorEvent, EventHint } from '@sentry/nextjs'

/** Browser/network noise that is never actionable. */
export const IGNORE_ERRORS: (string | RegExp)[] = [
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications.',
  /AbortError/,
  'Failed to fetch',
  'NetworkError when attempting to fetch resource.',
  'Load failed',
]

/**
 * Drops events in development so local work never eats the free-tier quota.
 * Set SENTRY_DEBUG=1 (or NEXT_PUBLIC_SENTRY_DEBUG=1) to opt back in while
 * testing the integration locally.
 */
export function makeBeforeSend({
  environment,
  debug,
}: {
  environment: string
  debug: boolean
}): (event: ErrorEvent, hint: EventHint) => ErrorEvent | null {
  return (event) => {
    if (environment === 'development' && !debug) return null
    return event
  }
}

/** Shared init fragment used by browser/server/edge configs. */
export function commonInitOptions() {
  const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development'
  const debug =
    process.env.SENTRY_DEBUG === '1' || process.env.NEXT_PUBLIC_SENTRY_DEBUG === '1'
  return {
    environment,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    sendDefaultPii: false,
    ignoreErrors: IGNORE_ERRORS,
    beforeSend: makeBeforeSend({ environment, debug }),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run test/sentry-shared.test.ts`
Expected: PASS (3 + 1 tests).

- [ ] **Step 5: Install the web SDK**

Run: `pnpm --filter web add @sentry/nextjs`
Expected: adds `@sentry/nextjs` to `apps/web/package.json` dependencies.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/sentry-shared.ts apps/web/test/sentry-shared.test.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): shared Sentry init options with dev-drop + noise filter"
```

---

## Task 2: Web runtime init files (browser + server + edge + global error)

**Files:**
- Create: `apps/web/sentry.server.config.ts`
- Create: `apps/web/sentry.edge.config.ts`
- Create: `apps/web/instrumentation.ts`
- Create: `apps/web/instrumentation-client.ts`
- Create: `apps/web/src/app/global-error.tsx`

- [ ] **Step 1: Server runtime config**

```ts
// apps/web/sentry.server.config.ts
import * as Sentry from '@sentry/nextjs'

import { commonInitOptions } from './src/lib/sentry-shared'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  ...commonInitOptions(),
  initialScope: { tags: { service: 'web-server' } },
})
```

- [ ] **Step 2: Edge runtime config**

```ts
// apps/web/sentry.edge.config.ts
import * as Sentry from '@sentry/nextjs'

import { commonInitOptions } from './src/lib/sentry-shared'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  ...commonInitOptions(),
  initialScope: { tags: { service: 'web-server' } },
})
```

- [ ] **Step 3: Server instrumentation entry**

```ts
// apps/web/instrumentation.ts
import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

// Captures errors thrown in Server Components, route handlers, and middleware.
export const onRequestError = Sentry.captureRequestError
```

- [ ] **Step 4: Browser instrumentation entry**

```ts
// apps/web/instrumentation-client.ts
import * as Sentry from '@sentry/nextjs'

import { commonInitOptions } from './src/lib/sentry-shared'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  ...commonInitOptions(),
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
  ],
  // On-error-only replay: zero cost on healthy traffic, full replay on errors.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  initialScope: { tags: { service: 'web-browser' } },
})

// Required by Next so client-side navigations are traced.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
```

- [ ] **Step 5: Global error boundary**

```tsx
// apps/web/src/app/global-error.tsx
'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body>
        <h2>Что-то пошло не так</h2>
      </body>
    </html>
  )
}
```

- [ ] **Step 6: Type-check**

Run: `pnpm --filter web check-types`
Expected: PASS (note: a TS2307 for a stale `.next/types` route is a known false positive — `rm -rf apps/web/.next/types` if it appears).

- [ ] **Step 7: Commit**

```bash
git add apps/web/sentry.server.config.ts apps/web/sentry.edge.config.ts \
  apps/web/instrumentation.ts apps/web/instrumentation-client.ts \
  apps/web/src/app/global-error.tsx
git commit -m "feat(web): Sentry init for browser, server, edge + global-error boundary"
```

---

## Task 3: Wrap next.config.js with withSentryConfig

**Files:**
- Modify: `apps/web/next.config.js` (last lines — the `export default`)

- [ ] **Step 1: Inspect the current export**

Run: `grep -n "export default\|withMDX\|module.exports" apps/web/next.config.js`
Expected: shows the final `export default withMDX(nextConfig)` (or similar). Note the exact final expression — you will wrap it.

- [ ] **Step 2: Add the import at the top of the file**

Add after the existing imports (e.g. after the `createMDX` import line):

```js
import { withSentryConfig } from '@sentry/nextjs'
```

- [ ] **Step 3: Wrap the final export**

Replace the final `export default withMDX(nextConfig)` with:

```js
// org/project/authToken are only needed for source-map upload and are read
// from env (CI-only). Absent locally → wrapper is a passthrough; the app still
// builds and the SDK still captures errors, just with minified stack traces.
export default withSentryConfig(withMDX(nextConfig), {
  silent: !process.env.CI,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Smaller client bundle: tunnel disabled (we accept ad-blocker drop on free tier).
  disableLogger: true,
})
```

If the existing export is `withMDX(nextConfig)` with a different variable name, wrap that exact expression instead.

- [ ] **Step 4: Verify dev server boots and the home route renders**

Run: `pnpm --filter web dev` (in background), then `curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/`
Expected: `200`. (Per CLAUDE.md: RSC prop errors only surface at request time on dynamic routes — curl a real route, don't trust `next build` alone.)

Stop the dev server after verifying.

- [ ] **Step 5: Commit**

```bash
git add apps/web/next.config.js
git commit -m "build(web): wrap next config with withSentryConfig"
```

---

## Task 4: Server-side identity in tRPC context

Attaches `user.id` + `workspaceId` to every Sentry event raised during a tRPC call.

**Files:**
- Modify: `packages/trpc/src/trpc.ts` (the `createContext` function, around line 32–36)
- Modify: `packages/trpc/package.json` (add `@sentry/nextjs`)

- [ ] **Step 1: Install the SDK in the trpc package**

Run: `pnpm --filter @repo/trpc add @sentry/nextjs`
Expected: adds dependency. (We use `@sentry/nextjs` because the trpc package runs inside the Next server runtime where that SDK is already initialized; calling `setUser` on a non-initialized SDK is a safe no-op.)

- [ ] **Step 2: Set the Sentry user in createContext**

In `packages/trpc/src/trpc.ts`, add the import at the top:

```ts
import * as Sentry from '@sentry/nextjs'
```

Then, immediately after the existing `const user = await getUserFromRequest(req, resHeaders)` line and before the `return {`, add:

```ts
  // Tag every Sentry event raised during this call with who/where. Safe no-op
  // when the SDK isn't initialized (e.g. RSC server-caller without a DSN).
  if (user) {
    Sentry.setUser({ id: user.id })
  }
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @repo/trpc check-types`
Expected: PASS.

- [ ] **Step 4: Run the trpc tests (no regression)**

Run: `pnpm --filter @repo/trpc test`
Expected: PASS (existing suite unaffected — `setUser` is side-effect-only).

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/trpc.ts packages/trpc/package.json pnpm-lock.yaml
git commit -m "feat(trpc): attach authenticated user to Sentry scope in context"
```

---

## Task 5: Browser identity in the protected layout

The `workspaceId` is server-side state (`UserPreference.activeWorkspaceId`); the browser needs it set on its own Sentry scope. Add a tiny client component that the (protected) layout renders with the resolved ids.

**Files:**
- Create: `apps/web/src/components/sentry-identity.tsx`
- Modify: `apps/web/src/app/(protected)/layout.tsx`

- [ ] **Step 1: Create the client identity component**

```tsx
// apps/web/src/components/sentry-identity.tsx
'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

/**
 * Sets the Sentry user/workspace tags on the BROWSER scope. Rendered by the
 * (protected) layout with ids already resolved server-side, so no client fetch.
 */
export function SentryIdentity({
  userId,
  workspaceId,
}: {
  userId: string
  workspaceId: string | null
}) {
  useEffect(() => {
    Sentry.setUser({ id: userId })
    if (workspaceId) Sentry.setTag('workspaceId', workspaceId)
    return () => {
      Sentry.setUser(null)
    }
  }, [userId, workspaceId])

  return null
}
```

- [ ] **Step 2: Inspect the protected layout to find the session + workspace**

Run: `grep -n "requireSession\|activeWorkspace\|workspaceId\|return (" "apps/web/src/app/(protected)/layout.tsx"`
Expected: shows where `requireSession()` resolves the user and how the active workspace id is obtained. Use the existing variable names in the next step (commonly `session.user.id` and an `activeWorkspaceId`). If the layout does not already resolve the active workspace id, pass `null` for `workspaceId` — do NOT add a new query (YAGNI; the server scope already covers workspace via tRPC tags).

- [ ] **Step 3: Render the component inside the layout**

Add the import at the top of `apps/web/src/app/(protected)/layout.tsx`:

```tsx
import { SentryIdentity } from '@/components/sentry-identity'
```

Inside the returned JSX, as the first child of the existing provider wrapper, add (substituting the real variable names found in Step 2):

```tsx
<SentryIdentity userId={session.user.id} workspaceId={activeWorkspaceId ?? null} />
```

- [ ] **Step 4: Verify the route renders**

Run: `pnpm --filter web dev` (background), then
`curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/app`
Expected: `307`/`302` redirect to `/sign-in` (unauthenticated curl) — proves no render crash. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/sentry-identity.tsx "apps/web/src/app/(protected)/layout.tsx"
git commit -m "feat(web): set Sentry user/workspace on the browser scope"
```

---

## Task 6: Engines (NestJS) Sentry init

**Files:**
- Create: `apps/engines/src/instrument.ts`
- Modify: `apps/engines/src/main.ts` (first line)
- Modify: `apps/engines/src/app.module.ts` (imports array)
- Modify: `apps/engines/package.json`

- [ ] **Step 1: Install the NestJS SDK**

Run: `pnpm --filter engines add @sentry/nestjs`
Expected: adds `@sentry/nestjs`.

- [ ] **Step 2: Create the instrument file**

```ts
// apps/engines/src/instrument.ts
import * as Sentry from '@sentry/nestjs'

// MUST be imported before any other module so the SDK can patch them.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
  release: process.env.SENTRY_RELEASE,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
  sendDefaultPii: false,
  initialScope: { tags: { service: 'engines' } },
})
```

- [ ] **Step 3: Import it first in main.ts**

In `apps/engines/src/main.ts`, make the VERY FIRST import line:

```ts
import './instrument.js'
```

It must precede `import 'reflect-metadata'` and every other import.

- [ ] **Step 4: Register SentryModule + global filter in app.module.ts**

Add the import at the top of `apps/engines/src/app.module.ts`:

```ts
import { SentryModule } from '@sentry/nestjs/setup'
```

Add `SentryModule.forRoot()` as the FIRST entry in the `imports` array (before `ConfigModule.forRoot(...)`):

```ts
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // ... rest unchanged
```

- [ ] **Step 5: Type-check**

Run: `pnpm --filter engines check-types`
Expected: PASS.

- [ ] **Step 6: Boot the service to confirm no init crash**

Run: `pnpm --filter engines dev` (background) and watch for `engines listening on :8082`.
Expected: starts cleanly (empty `SENTRY_DSN` → SDK disabled, no error). Stop after confirming.

- [ ] **Step 7: Commit**

```bash
git add apps/engines/src/instrument.ts apps/engines/src/main.ts \
  apps/engines/src/app.module.ts apps/engines/package.json pnpm-lock.yaml
git commit -m "feat(engines): initialize Sentry before module load + SentryModule"
```

---

## Task 7: Yjs (Hocuspocus Node) Sentry init + error capture

**Files:**
- Modify: `apps/yjs/src/env.ts`
- Modify: `apps/yjs/src/index.ts`
- Modify: `apps/yjs/package.json`

- [ ] **Step 1: Install the Node SDK**

Run: `pnpm --filter @repo/yjs-server add @sentry/node`
Expected: adds `@sentry/node`. (Confirm the package name with `grep '"name"' apps/yjs/package.json`; use that exact filter value.)

- [ ] **Step 2: Add Sentry env to env.ts**

In `apps/yjs/src/env.ts`, extend the `Env` type:

```ts
type Env = {
  port: number
  authBaseUrl: string
  jwksUrl: string
  jwtAudience: string | undefined
  shareTokenSecret: string
  sentryDsn: string | undefined
  sentryEnvironment: string
  sentryTracesSampleRate: number
}
```

And extend the returned object in `loadEnv()`:

```ts
  return {
    port: Number(process.env.YJS_PORT ?? 1234),
    authBaseUrl,
    jwksUrl: `${authBaseUrl}/api/auth/jwks`,
    jwtAudience: process.env.BETTER_AUTH_JWT_AUDIENCE,
    shareTokenSecret: required('YJS_SHARE_TOKEN_SECRET'),
    sentryDsn: process.env.SENTRY_DSN,
    sentryEnvironment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    sentryTracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
  }
```

- [ ] **Step 3: Initialize Sentry in index.ts**

In `apps/yjs/src/index.ts`, add the import at the top (before the Hocuspocus import is fine — `@sentry/node` auto-instruments via async hooks):

```ts
import * as Sentry from '@sentry/node'
```

Immediately after `const env = loadEnv()`, add:

```ts
Sentry.init({
  dsn: env.sentryDsn,
  environment: env.sentryEnvironment,
  release: process.env.SENTRY_RELEASE,
  tracesSampleRate: env.sentryTracesSampleRate,
  sendDefaultPii: false,
  initialScope: { tags: { service: 'yjs' } },
})
```

- [ ] **Step 4: Capture auth + persist errors**

Run: `grep -n "onAuthenticate\|onStoreDocument\|onLoadDocument\|catch\|throw" apps/yjs/src/index.ts`
Expected: locate the auth and persistence callbacks. In the `catch` block of each persistence/auth error path (where an error is currently logged via `log(...)` or rethrown), add a capture with a `documentName` tag before the existing handling, e.g.:

```ts
Sentry.captureException(error, { tags: { documentName } })
```

Use the `documentName`/`data.documentName` variable already in scope for that callback. Do NOT capture expected auth rejections that are part of normal flow (e.g. a deliberate "unauthorized" throw for a missing token) — only unexpected errors (JWKS fetch failure, DB persist failure). If unsure whether a throw is "expected," wrap only the `catch` blocks around `storePageDocument`/`loadPageDocument`/`initJwks`/`verifyJwt` infra calls.

- [ ] **Step 5: Type-check + build**

Run: `pnpm --filter @repo/yjs-server check-types && pnpm --filter @repo/yjs-server build`
Expected: PASS (use the real package name from Step 1).

- [ ] **Step 6: Commit**

```bash
git add apps/yjs/src/env.ts apps/yjs/src/index.ts apps/yjs/package.json pnpm-lock.yaml
git commit -m "feat(yjs): initialize Sentry + capture auth/persist failures"
```

---

## Task 8: Agents (FastAPI) Sentry init with tracing + service tag

The existing `fast_clean.use_sentry` does not accept a traces sample rate. Replace that call with a direct `sentry_sdk.init` reusing the same integrations, so we get tracing + the `service` tag.

**Files:**
- Modify: `apps/agents/agents/settings.py`
- Modify: `apps/agents/agents/bootstrap.py`
- Modify: `apps/agents/pyproject.toml` (ensure `sentry-sdk` is a direct dep)

- [ ] **Step 1: Add settings fields**

In `apps/agents/agents/settings.py`, add to `SettingsSchema` (after the s3 fields):

```python
    sentry_dsn: str | None = None
    sentry_environment: str = 'development'
    sentry_traces_sample_rate: float = 0.1
```

- [ ] **Step 2: Confirm sentry-sdk is a declared dependency**

Run: `grep -n "sentry" apps/agents/pyproject.toml`
Expected: if `sentry-sdk` (or `sentry-sdk[fastapi]`) is absent, add it under `[project] dependencies` (it is currently only transitive via `fast_clean`). Add `"sentry-sdk[fastapi]>=2"` then run `pnpm --filter agents exec uv sync` (or `cd apps/agents && uv sync`).

- [ ] **Step 3: Replace the use_sentry call in bootstrap.py**

In `apps/agents/agents/bootstrap.py`, remove the `from fast_clean.contrib.sentry.sentry import use_sentry` import and the `use_sentry(settings.sentry_dsn)` line. Add at the top:

```python
import logging

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.logging import LoggingIntegration
```

Replace the old `use_sentry(...)` call site with:

```python
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,
        integrations=[
            LoggingIntegration(level=logging.DEBUG, event_level=logging.ERROR),
            FastApiIntegration(),
        ],
    )
    sentry_sdk.set_tag('service', 'agents')
```

An empty/`None` DSN disables the SDK (sentry-sdk no-ops), so dev/CI without a DSN is unaffected.

- [ ] **Step 4: Verify bootstrap imports cleanly**

Run: `cd apps/agents && uv run python -c "import agents.bootstrap"`
Expected: no ImportError, no exception (DSN unset → SDK disabled).

- [ ] **Step 5: Run the agents unit tests (no regression)**

Run: `pnpm --filter agents test`
Expected: PASS (excludes integration; bootstrap change is init-only).

- [ ] **Step 6: Commit**

```bash
git add apps/agents/agents/settings.py apps/agents/agents/bootstrap.py apps/agents/pyproject.toml apps/agents/uv.lock
git commit -m "feat(agents): direct sentry_sdk init with tracing + service tag"
```

---

## Task 9: AI/LLM pipeline tags (agents)

Tag the LangGraph generation flow with provider/model so AI errors carry the context that the known provider bugs need.

**Files:**
- Modify: the agents request/generation entry (find it in Step 1)

- [ ] **Step 1: Find the generation entry point and where provider/model are known**

Run: `grep -rn "provider\|model\|run_agent\|llm_factory\|def generate\|graph" apps/agents/agents/*.py apps/agents/agents/**/*.py | grep -iv test | head -30`
Expected: locate the function that resolves the provider/model (per memory: `run_agent` / `llm_factory` area) right before invoking the LLM/graph.

- [ ] **Step 2: Tag the active scope where provider/model are resolved**

At the point where `provider` and `model` are known (inside the generate handler, before the graph runs), add:

```python
import sentry_sdk

sentry_sdk.set_tag('provider', provider)
sentry_sdk.set_tag('model', model)
```

Use the actual variable names found in Step 1. If they live on a config/request object, use `request.provider` / `config.model` accordingly. Place this inside the existing try/except that wraps the LLM call (per memory: config errors must not crash the SSE stream) so a tagging call never escapes that boundary — `set_tag` cannot throw, but keep it inside for locality.

- [ ] **Step 3: Verify imports cleanly + tests pass**

Run: `cd apps/agents && uv run python -c "import agents.router"` then `pnpm --filter agents test`
Expected: imports clean, tests PASS. (Adjust the module in the import check to whichever file you edited.)

- [ ] **Step 4: Commit**

```bash
git add apps/agents/agents
git commit -m "feat(agents): tag Sentry scope with LLM provider/model"
```

---

## Task 10: Billing + integrations capture (web)

Capture YooKassa webhook failures and webhook/Telegram delivery failures with provider/event tags.

**Files:**
- Modify: `apps/web/src/app/api/webhooks/yookassa/route.ts`

- [ ] **Step 1: Inspect the yookassa webhook handler**

Run: `grep -n "catch\|throw\|signature\|verify\|export async function\|return new Response\|NextResponse" apps/web/src/app/api/webhooks/yookassa/route.ts`
Expected: locate the `catch` block(s) where a processing/verification error is handled.

- [ ] **Step 2: Capture in the error path**

Add the import at the top of `apps/web/src/app/api/webhooks/yookassa/route.ts`:

```ts
import * as Sentry from '@sentry/nextjs'
```

In the existing `catch (error)` block (before returning the error response), add:

```ts
    Sentry.captureException(error, { tags: { service: 'web-server', integration: 'yookassa' } })
```

If signature verification has its own dedicated rejection branch that is part of normal/expected hostile traffic (invalid signature), do NOT capture that — only capture genuine processing errors. Match the existing control flow.

- [ ] **Step 3: Type-check**

Run: `pnpm --filter web check-types`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/webhooks/yookassa/route.ts
git commit -m "feat(web): capture YooKassa webhook failures in Sentry"
```

---

## Task 11: Env + turbo wiring

**Files:**
- Modify: `.env.example`
- Modify: `turbo.json` (`globalEnv` array)

- [ ] **Step 1: Add vars to .env.example**

Append to `.env.example`:

```bash
# ── Sentry error monitoring + tracing ──────────────────────────────
# Two projects: a frontend (browser) DSN baked into the web client bundle,
# and a backend DSN shared by web-server/engines/yjs/agents (distinguished
# by a `service` tag). Empty DSN ⇒ the SDK is disabled (safe no-op), so
# leaving these blank locally is fine.
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_DSN=
# production | development. Defaults to NODE_ENV when unset.
SENTRY_ENVIRONMENT=development
# Fraction of requests traced (0.0–1.0). Errors are always captured at 100%.
SENTRY_TRACES_SAMPLE_RATE=0.1
# Source-map upload (CI only; safe to leave blank locally).
SENTRY_ORG=
SENTRY_PROJECT=
SENTRY_AUTH_TOKEN=
```

- [ ] **Step 2: Add the vars to turbo.json globalEnv**

Run: `grep -n "globalEnv" turbo.json` to find the array, then add these entries (preserve existing alphabetical-ish grouping):

```
"NEXT_PUBLIC_SENTRY_DSN",
"SENTRY_DSN",
"SENTRY_ENVIRONMENT",
"SENTRY_TRACES_SAMPLE_RATE",
"SENTRY_RELEASE",
"SENTRY_ORG",
"SENTRY_PROJECT",
"SENTRY_AUTH_TOKEN",
"SENTRY_DEBUG",
"NEXT_PUBLIC_SENTRY_DEBUG",
```

- [ ] **Step 3: Validate turbo.json is still valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('turbo.json','utf8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add .env.example turbo.json
git commit -m "chore(sentry): add Sentry env vars to .env.example + turbo globalEnv"
```

---

## Task 12: Deploy pipeline wiring

Per the project rule: a backend var needs `deploy/.env.template` + the deploy.yml render-step env block + a GitHub secret. The frontend DSN additionally needs a Docker build-arg (it's inlined into the client bundle at build time, like `NEXT_PUBLIC_VAPID_PUBLIC_KEY`).

**Files:**
- Modify: `deploy/.env.template`
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Add backend + tracing vars to deploy/.env.template**

Append to `deploy/.env.template`:

```bash
# === Sentry ===
# Backend DSN shared by web-server/engines/yjs/agents (service tag distinguishes).
# NEXT_PUBLIC_SENTRY_DSN is ALSO a docker build-arg for apps/web (inlined into
# the client bundle); the value here covers any server-side read.
SENTRY_DSN=${SENTRY_DSN}
NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}
SENTRY_ENVIRONMENT=${SENTRY_ENVIRONMENT}
SENTRY_TRACES_SAMPLE_RATE=${SENTRY_TRACES_SAMPLE_RATE}
SENTRY_RELEASE=${SENTRY_RELEASE}
```

- [ ] **Step 2: Add the build-arg for the frontend DSN (web image)**

In `.github/workflows/deploy.yml`, in the `build-args:` block (the one with `NEXT_PUBLIC_VAPID_PUBLIC_KEY`), add:

```yaml
            NEXT_PUBLIC_SENTRY_DSN=${{ secrets.NEXT_PUBLIC_SENTRY_DSN }}
            SENTRY_ENVIRONMENT=${{ vars.SENTRY_ENVIRONMENT || 'production' }}
            SENTRY_RELEASE=${{ github.ref_name }}
```

- [ ] **Step 3: Add secrets→env to the render step**

In `.github/workflows/deploy.yml`, in the "Render .env from template" step's `env:` block, add:

```yaml
          SENTRY_DSN: ${{ secrets.SENTRY_DSN }}
          NEXT_PUBLIC_SENTRY_DSN: ${{ secrets.NEXT_PUBLIC_SENTRY_DSN }}
          SENTRY_ENVIRONMENT: ${{ vars.SENTRY_ENVIRONMENT || 'production' }}
          SENTRY_TRACES_SAMPLE_RATE: ${{ vars.SENTRY_TRACES_SAMPLE_RATE || '0.1' }}
          SENTRY_RELEASE: ${{ github.ref_name }}
```

- [ ] **Step 4: Validate the workflow YAML parses**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/deploy.yml','utf8'); if(!/SENTRY_DSN/.test(y)) throw new Error('missing'); console.log('ok')"`
Expected: `ok`. (Optionally `gh workflow view deploy.yml` if `gh` is available.)

- [ ] **Step 5: Document the required GitHub secrets**

These secrets must be added in the GitHub repo settings before the next deploy (manual, by the maintainer — note it in the PR description, do not attempt to set them):
`SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`. Optional repo *variables*: `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`. Optional secret for source maps: `SENTRY_AUTH_TOKEN` + variables `SENTRY_ORG`, `SENTRY_PROJECT` (only if source-map upload is wanted — can be deferred).

- [ ] **Step 6: Commit**

```bash
git add deploy/.env.template .github/workflows/deploy.yml
git commit -m "ci(sentry): wire Sentry DSN + tracing through deploy pipeline"
```

---

## Task 13: Full gates + smoke verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full merge gate**

Run: `pnpm gates`
Expected: `check-types`, `lint`, `check-architecture`, `build`, `test` all PASS. (If `apps/web/.next/types` produces a stale TS2307 for an unrelated route, `rm -rf apps/web/.next/types` and rerun — known false positive.)

- [ ] **Step 2: Confirm SDK disabled-without-DSN is graceful (no DSN set)**

With no Sentry env vars set, boot each service briefly and confirm clean startup:
- Run: `pnpm --filter web dev` → `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/` → `200`. Stop.
- Run: `pnpm --filter engines dev` → log shows `engines listening on :8082`. Stop.

Expected: both boot with empty DSN (SDK disabled), no Sentry-related errors in logs.

- [ ] **Step 3: Manual smoke (requires a real backend DSN — maintainer step, document only)**

Document in the PR description for the maintainer to run after secrets are set:
1. Set `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_DEBUG=1` locally.
2. Trigger an error on each surface (browser: throw in a client component; server: a failing tRPC call; engines: a thrown handler; yjs: bad token; agents: invalid provider) and confirm each event lands in the correct Sentry project with the right `service` tag.

This is not automatable in CI (Sentry capture is external network I/O the test runner can't observe) — hence manual.

- [ ] **Step 4: Final commit (if any gate fixes were needed)**

```bash
git add -A
git commit -m "chore(sentry): satisfy gates after integration"
```

---

## Self-Review notes

- **Spec coverage:** topology (Tasks 2/6/7/8 service tags), web SDK (T1–3), server identity (T4), browser identity (T5), engines (T6), yjs (T7), agents init+tracing (T8), AI tags (T9), billing/integrations (T10), free-tier guardrails (T1 beforeSend/ignoreErrors + on-error replay in T2), env/deploy (T11/T12), testing (T1 unit + T13 gates/smoke). All spec sections map to a task.
- **Type consistency:** `commonInitOptions()` defined in T1, consumed in T2; `makeBeforeSend`/`IGNORE_ERRORS` names consistent T1↔test; `service` tag values consistent (`web-browser`, `web-server`, `engines`, `yjs`, `agents`).
- **Known-gotcha guards baked in:** new-env-var-touches-all-5-places (T11/T12), stale `.next/types` (T2/T13), yjs graceful-no-crash on empty secret (T7), agents config-error-must-not-crash-SSE boundary (T9), build-arg-needed-for-NEXT_PUBLIC (T12).
- **Telegram delivery capture:** folded into the `@repo/webhooks`/`@repo/telegram` engines paths conceptually, but to keep the plan focused the explicit capture is scoped to the YooKassa handler (T10); the engines global filter (T6) already captures unhandled exceptions in the Telegram/webhook cron workers, satisfying the "billing & integrations" moment without per-call instrumentation.
