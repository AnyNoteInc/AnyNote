# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands are run from the repo root and dispatched through Turborepo unless noted.

```bash
pnpm install              # install workspace deps
pnpm dev                  # run every package/app in dev (persistent, uncached)
pnpm exec turbo run dev --filter=web   # run only the Next.js app
pnpm build                # turbo run build (fans out to each workspace)
pnpm lint                 # turbo run lint (ESLint flat config, --max-warnings 0)
pnpm check-types          # turbo run check-types (runs `next typegen` then `tsc --noEmit`)
pnpm format               # prettier --write **/*.{ts,tsx,md}
```

Infra for local dev (Postgres, MinIO, Weaviate, Redis) is in `compose.yml`:

```bash
docker compose up -d
```

Prisma (run inside `packages/db`):

```bash
pnpm --filter @repo/db prisma:generate
pnpm --filter @repo/db prisma:db-push
```

Playwright E2E (config at repo root, tests in `apps/e2e/`):

```bash
pnpm exec playwright test
pnpm exec playwright test apps/e2e/auth.spec.ts    # single spec
```

The dev server must be running on `http://localhost:3000` before Playwright — there is no `webServer` in `playwright.config.ts`.

## Architecture

### Monorepo shape

Turborepo + pnpm workspaces. Workspace filters: `apps/*`, `packages/*`.

- `apps/web` — the only Next.js 16 app (App Router, React 19, Turbopack). Everything user-facing lives here.
- `apps/e2e` — Playwright specs only.
- `packages/db` — Prisma 7 client + schema + migrations. Exports a global singleton `prisma` using the `PrismaPg` adapter. `prisma.config.ts` walks **upward** from the package dir to find `.env`, so `DATABASE_URL` is loaded from the repo root even when Prisma CLI runs inside `packages/db`.
- `packages/auth` — better-auth configuration. Exposes `auth`, `Session` type, and `getUserFromRequest(req, resHeaders)` helper that forwards the `set-cookie` header for session refresh.
- `packages/trpc` — tRPC v11 router + context. Exports both `appRouter` and `createCaller = createCallerFactory(appRouter)` so RSCs can invoke procedures without an HTTP roundtrip. `createServerContext(headers)` builds a synthetic `Request` for RSC.
- `packages/ui` — MUI v6 design system. Subpath exports (`@repo/ui/components`, `@repo/ui/widgets`, `@repo/ui/providers`, `@repo/ui/theme`). **Do not** re-export `@mui/material` from the package root — it kills tree-shaking; import through `@repo/ui/components` instead.
- `packages/eslint-config`, `packages/typescript-config` — shared config packages consumed via `workspace:*`.

`apps/web/next.config.js` sets `transpilePackages: ['@repo/ui', '@repo/trpc', '@repo/auth']` (workspace packages ship raw TS) and `serverExternalPackages: ['pg', '@prisma/client']` (Prisma must not be bundled).

### App Router layout

`apps/web/src/app/` uses route groups to gate access. Auth is enforced in **layouts**, not HOCs:

- `(about)/` — public marketing pages (landing, docs, pricing, contact, etc.). No providers beyond the root layout.
- `(auth)/layout.tsx` — redirects to `/app` if a session already exists.
- `app/layout.tsx` — calls `requireSession()` (which `redirect()`s to `/sign-in` on failure) and wraps children in `<TRPCReactProvider>`. The tRPC/React Query client is **only** loaded inside `/app` to keep the marketing bundle pure RSC.
- `layout.tsx` (root) — only `<UiProvider>` + fonts. No tRPC, no React Query.

Special files used across route groups: `loading.tsx`, `error.tsx`, `global-error.tsx`, `not-found.tsx`. Generated app icons live in `app/icon.tsx` (512×512) and `app/apple-icon.tsx` (180×180), both rendering shared SVG via `lib/brand-icon.tsx` and `next/og` `ImageResponse`.

### Session handling

`apps/web/src/lib/get-session.ts` is the single entry point and has `import "server-only"` at the top.

- `getSession()` is wrapped in React `cache()` so a single RSC render de-duplicates `headers()` calls.
- `requireSession(redirectTo = "/sign-in")` narrows the return type to non-null because `redirect()` returns `never`. Never replace this with a non-null assertion.

`auth-client.ts` has `"use client"` and must never be imported from a Server Component.

### tRPC dual client

There are two entry points, and they are **not** interchangeable:

- `apps/web/src/trpc/client.tsx` — `"use client"`. Exports `trpc = createTRPCReact<AppRouter>()` and `<TRPCReactProvider>`. Used only inside `/app` subtree.
- `apps/web/src/trpc/server.ts` — `server-only`. Exports `getServerTRPC = cache(async () => createCaller(ctx))`. Use this in RSC pages to call procedures directly.
- `apps/web/src/app/api/trpc/[trpc]/route.ts` — the HTTP handler for the browser client, `runtime = "nodejs"`.
- `apps/web/src/trpc/query-client.ts` — canonical singleton: fresh QueryClient on the server, cached singleton in the browser.

When adding procedures, edit `packages/trpc/src/index.ts`. The context includes `prisma`, `user`, `headers`, and `resHeaders` (used so better-auth can refresh session cookies on API responses).

## Conventions that bite

### No semicolons

Prettier is configured with `semi: false` project-wide (`.prettierrc`). Don't add semicolons — run `pnpm format` if in doubt.

### RSC ↔ Client boundary

Functions cannot cross the Server → Client prop boundary. This has bitten the project multiple times:

- **Do not** use `<Button component={Link}>` or `<Box component={Link}>` in a Server Component — the `Link` reference is a function and will fail prerender with `"Functions cannot be passed directly to Client Components"`.
- Instead: wrap a `<Button>` in a `<Link>`, or pass `href` as a plain string and let the MUI component handle navigation via its own prop.
- This error is only caught at build time for **static** routes. Dynamic routes (anything using `headers()`, `cookies()`, `getSession()`) will pass `next build` and blow up at request time. Always run `pnpm dev` + curl the changed route before considering RSC prop wiring done.

`forwardRef` is a client-only API, so any component using it (e.g. `packages/ui/src/components/ui/button.tsx`) must have `"use client"`.

### Prisma environment

`packages/db/prisma.config.ts` walks up from the package directory looking for the first `.env` file. The repo root `.env` is authoritative for local dev. Do not add per-package `.env` files.

### UI imports

Import MUI through the `@repo/ui/components` / `@repo/ui/widgets` subpaths — never through `@repo/ui` root or `@mui/material` directly from app code. If a component is missing, add an explicit re-export to `packages/ui/src/components/index.ts`.

### Auth model

better-auth runs with `additionalFields: { firstName, lastName }` and `advanced.database.generateId: false` (Prisma generates UUID v7 ids). Schema is tracked in `packages/db/prisma/schema.prisma`; do not let better-auth auto-generate tables.

`sendResetPassword` currently throws in production — wire a real email transport before enabling password reset flows.
