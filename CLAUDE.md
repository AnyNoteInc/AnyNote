# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`README.md` covers product framing and quick-start. `AGENTS.md` covers commit
conventions and a one-line module tour. This file documents the things that
have actually broken work in this repo — cross-package wiring, RSC boundaries,
and toolchain quirks — that are not obvious from reading the code.

## Commands

All commands are run from the repo root and dispatched through Turborepo unless noted.

```bash
pnpm install                              # install workspace deps
pnpm dev                                  # run every app/package in dev (persistent, uncached)
pnpm build                                # turbo run build (fans out)
pnpm lint                                 # ESLint flat config, --max-warnings 0
pnpm check-types                          # next typegen → tsc --noEmit
pnpm test                                 # turbo run test
pnpm gates                                # check-types + lint + build + test (the merge gate)
pnpm format                               # prettier --write **/*.{ts,tsx,md}
```

Filter to one workspace:

```bash
pnpm --filter web dev                     # Next.js only (port 3000)
pnpm --filter @repo/yjs-server dev        # Hocuspocus only (port 1234)
pnpm --filter engines dev                 # NestJS engines (port 8082)
pnpm --filter agents dev                  # FastAPI agents (port 8080, uv-managed)
pnpm --filter @repo/db prisma:generate
pnpm --filter @repo/db exec prisma migrate dev --name <change>
```

Tests:

```bash
pnpm --filter web test                    # vitest, node env, test/ folder
pnpm --filter @repo/trpc test             # vitest
pnpm --filter engines test                # jest (ESM via NODE_OPTIONS=--experimental-vm-modules)
pnpm --filter engines test-int            # jest integration suite, separate config
pnpm --filter agents test                 # pytest, excludes -m integration
pnpm --filter agents test:integration     # pytest -m integration only
pnpm exec playwright test                 # browser E2E (config at repo root)
pnpm exec playwright test apps/e2e/auth.spec.ts
```

Local infra (postgres, minio, qdrant, **mailhog**) — must be up before `pnpm dev`:

```bash
docker compose up -d
```

## Architecture

### Monorepo shape

Turborepo + pnpm workspaces. Filters: `apps/*`, `packages/*`.

Apps:

- `apps/web` — Next.js 16 App Router, React 19, Turbopack, MUI v6. Only user-facing app.
- `apps/yjs` — Hocuspocus collaborative editor server (`@repo/yjs-server`). Verifies short-lived JWTs minted by `apps/web`.
- `apps/agents` — Python 3.13 / FastAPI / LangGraph / Dishka. LLM gateway with SSE streaming and an MCP tool-call loop. Has its **own** Postgres database via `AGENTS_DATABASE_URL` (note: separate from `DATABASE_URL`).
- `apps/engines` — NestJS 11. Hosts an MCP server (`@rekog/mcp-nest`) **and** the cron workers for vectorization, mail dispatch, and billing renewal. Same process, multiple `apps/*` modules: `mcp`, `indexer`, `mailer`, `billing`.
- `apps/e2e` — Playwright specs only.

Packages (selected):

- `packages/db` — Prisma 7 client + schema + migrations + seed. Singleton `prisma` using `PrismaPg` adapter.
- `packages/auth` — better-auth config (`auth`, `Session`, `getUserFromRequest`).
- `packages/trpc` — tRPC v11 router. Exports `appRouter` **and** `createCaller` for RSC.
- `packages/ui` — MUI v6 design system with subpath exports.
- `packages/editor` — Tiptap-based collaborative text editor (loaded via `next/dynamic`, `ssr: false`).
- `packages/excalidraw` — Excalidraw board renderer (same dynamic-import pattern).
- `packages/genogram` — React Flow genogram canvas.
- `packages/mail` — outbox-backed transactional email (`enqueueMailEvent`, `dispatchPending`, templates).
- `packages/storage` — typed S3/MinIO client.
- `packages/yookassa` — billing client + webhook signature verification.
- `packages/eslint-config`, `packages/typescript-config` — consumed via `workspace:*`.

`apps/web/next.config.js` is the source of truth for which workspace packages ship raw TS through Next:

```js
transpilePackages: [
  '@repo/ui', '@repo/trpc', '@repo/auth', '@repo/storage',
  '@repo/editor', '@repo/excalidraw', '@repo/genogram', '@repo/yookassa',
]
serverExternalPackages: ['pg', '@prisma/client']  // never bundle Prisma
```

If you add a new workspace package consumed by `apps/web`, you must list it in `transpilePackages` or Next will try to import its `dist/` (which doesn't exist in dev).

### App Router layout

`apps/web/src/app/` uses route groups to gate access. **Auth is enforced in layouts**, not HOCs:

- `(about)/` — public marketing pages. Root layout only.
- `(auth)/layout.tsx` — redirects to `/app` if a session already exists.
- `(protected)/layout.tsx` — calls `requireSession()` (which `redirect()`s to `/sign-in` on failure) and wraps children in `<TRPCReactProvider>` + `<EditorThemeBridge>`. tRPC and React Query are **only** loaded inside this subtree to keep the marketing bundle pure RSC.
- `layout.tsx` (root) — only `<UiProvider>` + fonts. No tRPC, no React Query.

### Session handling

`apps/web/src/lib/get-session.ts` is the single entry point and has `import "server-only"` at the top.

- `getSession()` is wrapped in React `cache()` so a single RSC render de-dupes `headers()` calls.
- `requireSession(redirectTo = "/sign-in")` narrows the return type to non-null because `redirect()` returns `never`. Don't replace this with a non-null assertion — it changes call-site semantics.

`apps/web/src/lib/auth-client.ts` has `"use client"` and must never be imported from a Server Component.

### tRPC dual client

Two entry points, **not** interchangeable:

- `apps/web/src/trpc/client.tsx` — `"use client"`. Exports `trpc = createTRPCReact<AppRouter>()` and `<TRPCReactProvider>`. Browser only, inside `(protected)`.
- `apps/web/src/trpc/server.ts` — `server-only`. Exports `getServerTRPC = cache(async () => createCaller(ctx))`. Use this in RSC pages to call procedures without an HTTP roundtrip.
- `apps/web/src/app/api/trpc/[trpc]/route.ts` — HTTP handler for the browser client (`runtime = "nodejs"`).
- `apps/web/src/trpc/query-client.ts` — singleton: fresh QueryClient on the server, cached singleton in the browser.

Procedures live in `packages/trpc/src/index.ts`. Context includes `prisma`, `user`, `headers`, `resHeaders` (used so better-auth can refresh session cookies on API responses).

### AI / RAG pipeline

Three services collaborate. Knowing which one owns what saves a lot of hopping:

```
browser
 └─ apps/web  POST /api/agents/generate
     └─ apps/agents  POST /api/v1/generate (SSE)
         └─ LangGraph: prepare_prompt → llm
                                       ↳ tools (MCP) → llm → … → END
             └─ apps/engines  /mcp  (search_workspace_pages, get_page, list_workspace_pages)
                  └─ Qdrant + Postgres
```

Indexing is decoupled via an outbox:

1. Page mutations in `apps/web` write rows to `outbox_events` (in the main Postgres).
2. `apps/engines` runs a cron (default `INDEXER_CRON_EXPRESSION="0 */5 * * * *"`) that drains the outbox and POSTs to `apps/agents /vectorization`.
3. `apps/agents` normalises + embeds via the workspace's configured embedding provider (OpenAI, GigaChat, or a self-hosted Ollama URL — connection details come from the request payload, no provider runs in the dev compose) and writes points to a per-workspace Qdrant collection.
4. `apps/agents` discovers MCP tools at request-start when the request payload includes `mcp.servers[*].url` — `apps/web` injects this from `ENGINES_MCP_URL`.

After schema or normalizer changes, re-enqueue with `pnpm --filter engines backfill:reindex`.

### Outbox pattern (mail + indexer)

Both transactional email and vectorization use the same shape: write a row in a transaction, drain via a NestJS cron in `apps/engines`. When debugging "the email never sent" or "the page wasn't indexed", check the outbox table first — it's almost always a stuck row, not a transport issue.

- Mail outbox: `packages/mail/src/dispatch.ts` (claim → render → send → mark sent/retry). Cron lives in `apps/engines/src/apps/mailer/`. Templates in `packages/mail/src/templates/` use the XSS-safe `escapeHtml` from `utils.ts`.
- Indexer outbox: `outbox_events` in the main DB; cron in `apps/engines/src/apps/indexer/`.

### Realtime collaboration (apps/yjs + PageRenderer)

Pages are collaboratively edited through Hocuspocus in `apps/yjs` (`@repo/yjs-server`):

- `NEXT_PUBLIC_YJS_URL` — websocket URL the browser connects to.
- `BETTER_AUTH_JWT_AUDIENCE` — audience claim used by `apps/web /api/yjs/token` to issue short-lived tokens; the yjs server verifies it.

`apps/web/src/components/page/page-renderer.tsx` is the **single dispatch point** for page rendering — it switches on `Page.type` (`TEXT` → `@repo/editor`, `EXCALIDRAW` → `@repo/excalidraw`). Both load via `next/dynamic` with `ssr: false`.

The block model has been removed; page content lives in `Page.contentYjs` (bytes) plus `Page.content` (JSON snapshot). Don't re-introduce blocks without first reading `docs/superpowers/specs/2026-04-16-collaborative-editor-design.md`.

`@repo/editor` and `@repo/excalidraw` are compiled with `moduleResolution: "Bundler"` (not the repo default `NodeNext`) because Next's `transpilePackages` consumes their `src/` directly. This is also why they use extensionless relative imports.

Known deviation: Excalidraw image assets are currently duplicated in S3 and in `Page.contentYjs`. See `packages/excalidraw/README.md` "Known limitations".

## Conventions that bite

### Prettier style

`.prettierrc`: `semi: false`, **single** quotes (TypeScript) / double quotes (some JSON-ish), trailing commas, 100-char print width. Run `pnpm format` if in doubt.

### RSC ↔ Client boundary

Functions cannot cross the Server → Client prop boundary. This has bitten the project repeatedly:

- **Do not** use `<Button component={Link}>` or `<Box component={Link}>` in a Server Component — `Link` is a function and prerender will fail with `"Functions cannot be passed directly to Client Components"`.
- Instead: wrap a `<Button>` in a `<Link>`, or pass `href` as a plain string.
- This error is only caught at build time for **static** routes. Dynamic routes (anything using `headers()`, `cookies()`, `getSession()`) pass `next build` and blow up at request time. After RSC prop wiring, run `pnpm dev` and curl the changed route before considering the task done.

`forwardRef` is a client-only API, so any component using it (e.g. `packages/ui/src/components/ui/button.tsx`) must have `"use client"`.

### UI imports

Import MUI through `@repo/ui/components` / `@repo/ui/widgets` — never through `@repo/ui` root or `@mui/material` directly from app code. The package root re-exports would kill tree-shaking. If a component is missing, add an explicit re-export to `packages/ui/src/components/index.ts` (or `widgets/index.ts`).

### Auth model

better-auth runs with:

- `additionalFields: { firstName, lastName }`
- `advanced.database.generateId: false` (Prisma generates UUID v7 ids)
- `emailVerification.sendOnSignUp: true` and `autoSignInAfterVerification: true`
- `socialProviders.google` (env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`)
- `captcha` plugin using reCAPTCHA v3 (`NEXT_PUBLIC_RECAPTCHA_SITE_KEY` + `RECAPTCHA_SECRET_KEY`)

Schema is tracked in `packages/db/prisma/schema.prisma`; do **not** let better-auth auto-generate tables.

`sendResetPassword`, `sendVerificationEmail`, and `afterEmailVerification` all enqueue rows via `enqueueMailEvent` — the actual SMTP send happens in `apps/engines` mailer cron. So locally, sign-up emails appear in **Mailhog** at http://localhost:8025, not in your terminal.

E2E note: `apps/e2e/helpers/auth.ts` exports `signUpAndAuthAs`, which clears cookies, signs up, polls Mailhog for the verification link, and signs in via the UI. `autoSignIn` produces a stale cookie that doesn't survive the `emailVerified` DB update, so the helper deliberately re-logs in. Don't "simplify" by trusting the auto-sign-in cookie.

### Prisma environment

`packages/db/prisma.config.ts` walks **upward** from the package directory looking for the first `.env` file — the repo root `.env` is authoritative. Do not add per-package `.env` files. `apps/agents` is the **only** exception: it owns its own DB pointed at by `AGENTS_DATABASE_URL`, which lives in the same root `.env`.

### Environment variables

`.env.example` at the repo root is the canonical list — copy it to `.env` for local setup. Every variable consumed by Turbo-cached tasks is mirrored in `turbo.json` `globalEnv` (currently 50+ keys) so cache invalidation tracks env changes. **If you add an env var, add it in both places** or you'll get stale builds.

### Docker compose services

`compose.yml` runs Postgres (5432), MinIO (9000/9001), Qdrant (6333/6334), and Mailhog (1025 SMTP / 8025 UI). All have health checks. Run `docker compose up -d` before `pnpm dev`. Mailhog has no persistence — restarting the container drops every message. No LLM provider runs in compose; configure embedding/LLM connections per-workspace in **Settings → AI агент**.

### Playwright

`playwright.config.ts` runs its **own** dev server on port 3100 via `webServer` with `BETTER_AUTH_URL`/`NEXT_PUBLIC_BASE_URL` overridden, `YOOKASSA_MOCK_ENABLED=true`, and `PLAYWRIGHT=true`. So you don't need `pnpm dev` running for `playwright test` — but you **do** need `docker compose up -d` (the dev server still talks to Postgres/Mailhog).

Specs in `apps/e2e/`. The `signUpAndAuthAs` helper above is the safe path for any spec that needs an authenticated user.

### Database seeding

`packages/db/prisma/seed.ts` populates integration providers (Yandex, GitHub, Telegram, AmoCRM, MangoOffice) and plans (Free, Personal, Corporate). Run after initial schema push (`pnpm --filter @repo/db exec prisma db seed`).

### Commits

Conventional Commits with scope: `feat(trpc): …`, `fix(auth): …`, `refactor(mail): …`, `test(e2e): …`. Husky runs lint-staged + the gates check on commit; do not bypass with `--no-verify`.
