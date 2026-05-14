# Repository Guidelines

## Project Structure & Module Organization

AnyNote is a pnpm/Turbo monorepo. Application code lives in `apps/`: `web` is the Next.js product UI, `yjs` handles collaborative editing, `agents` is the FastAPI/LangGraph LLM service, `engines` is the NestJS MCP/vectorization service, and `e2e` contains Playwright specs. Shared TypeScript packages live in `packages/`, including `db`, `auth`, `trpc`, `ui`, `editor`, `excalidraw`, `genogram`, `storage`, `mail`, and `yookassa`. Architecture notes and implementation plans belong in `docs/`; Docker support lives in `docker/`.

## Build, Test, and Development Commands

- `pnpm install` installs workspace dependencies.
- `docker compose up -d` starts local Postgres, MinIO, Qdrant services. No LLM provider runs in compose — `apps/agents` uses per-workspace LLM/embedding connections configured in **Settings → AI агент**.
- `pnpm dev` runs all app dev servers through Turbo.
- `pnpm --filter web dev` runs only the Next.js app.
- `pnpm build`, `pnpm lint`, `pnpm check-types`, and `pnpm test` run the corresponding Turbo tasks.
- `pnpm gates` runs type checks, lint, build, and tests together.
- `pnpm exec playwright test` runs root Playwright e2e tests.
- `pnpm --filter @repo/db exec prisma migrate dev` applies Prisma migrations locally.

## Coding Style & Naming Conventions

Use TypeScript for `apps/web`, `apps/yjs`, `apps/engines`, and `packages/*`; use Python 3.13 tooling in `apps/agents`. Prefer workspace imports such as `@repo/ui`, `@repo/db`, and `@repo/trpc`. Run `pnpm format` for Prettier on `ts`, `tsx`, and Markdown. TypeScript workspaces use ESLint with zero warnings. Python uses Ruff formatting with single quotes and 120-column lines, plus strict mypy settings.

## Testing Guidelines

Vitest covers most TypeScript packages and `apps/web`; Jest is used in `apps/yjs` and `apps/engines`; Pytest covers `apps/agents`; Playwright covers browser flows in `apps/e2e`. Keep tests near package-level `test/` folders or beside source files using existing `*.test.ts`, `*.spec.ts`, and `test_*.py` patterns. For focused runs, use `pnpm --filter @repo/trpc test`, `pnpm --filter engines test`, or `pnpm --filter agents test`. Mark live-service integration tests clearly.

## Commit & Pull Request Guidelines

Follow Conventional Commits with scopes, for example `feat(trpc): enforce soft downgrade workspace guards`, `fix(auth): show reset token failures consistently`, or `test(mail): isolate outbox dispatch tests`. PRs should describe the user-visible change, list verification commands run, link relevant issues or specs, and include screenshots for UI changes.

## Security & Configuration Tips

Copy `.env.example` to `.env` for local setup and keep secrets out of commits. Update service environment variables before debugging database, Better Auth, S3, Qdrant, engines, agents, or YooKassa behavior. LLM/embedding provider connections (OpenAI, GigaChat, Ollama) are configured per-workspace in the UI, not via env.

<claude-mem-context>
# Memory Context

# [anynote] recent context, 2026-05-14 8:18pm GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (20,128t read) | 448,809t work | 96% savings

### May 14, 2026
1863 11:28a 🔴 Added posOf() helper to placement.test.ts to replace ! assertions with type-safe position lookup
1864 11:29a 🔵 PR #13 CI Status: SonarCloud Passed, lint-and-test Still Pending
1865 11:40a 🔵 SonarCloud API Reports 20 Total Issues But 0 Open — All Are CLOSED
1866 " 🟣 PR #13 All CI Checks Passed — Ready to Merge
1867 11:41a 🟣 feat/genogram Branch Merged into main via PR #13
1868 1:09p 🔵 SEO Implementation Planned for Next.js Project at anynote
1869 " 🔵 anynote Next.js App Router Structure and Existing SEO State Mapped
1870 1:10p 🔵 anynote Root Metadata and Base URL Configuration Examined
1871 1:23p 🔵 Anynote Next.js App Structure for SEO Implementation
S464 SEO Option B design — All 5 sections now presented; Section 5 covers env vars, error handling, security, and testing strategy (May 14 at 1:32 PM)
S466 SEO Option B design — All 5 sections fully presented; spec file about to be written; discovered existing spec naming convention (May 14 at 1:33 PM)
S470 SEO implementation prep — vitest config, turbo.json globalEnv, .env.example format, and test style inspected before writing implementation plan (May 14 at 1:34 PM)
S471 SEO implementation prep — pricing page structure, turbo.json full globalEnv, e2e test conventions, and web package scripts all inspected (May 14 at 1:35 PM)
S469 SEO design spec committed to git; awaiting user review before writing implementation plan (May 14 at 1:35 PM)
S473 SEO production implementation for Anynote Next.js app — executing 22-task plan targeting Yandex + Google (May 14 at 1:38 PM)
1872 1:41p ✅ SEO Implementation Plan Written — 22 Tasks, TDD-first
S474 SEO production implementation for Anynote Next.js app — executing 22-task plan targeting Yandex + Google (May 14 at 1:42 PM)
S472 SEO implementation for Anynote Next.js app (Russian search engines: Yandex + Google) — executing 22-task implementation plan (May 14 at 1:42 PM)
S475 Observer session monitoring feat/seo SEO implementation — checking for git push and PR creation after all 22 tasks complete (May 14 at 1:49 PM)
1873 1:50p 🔵 SEO implementation base SHA and lib directory state confirmed
1874 " 🟣 Task 1 complete: apps/web/src/lib/seo/site-config.ts created
1875 1:51p 🟣 Task 1 shipped: site-config.ts committed to feat/seo (8fe1fd6)
1876 " 🟣 Task 1 implementer subagent completed: DONE, all checks passed
1877 1:52p 🟣 Task 1 spec compliance review passed — proceeding to Task 2
1878 " 🟣 Task 1 fully approved — all three review gates passed, proceeding to Task 2
1879 " 🔴 T19 legal document OG image fixed to use async params (Next.js 15/16 convention)
1880 2:27p 🔵 Severe replay loop: T19 async params fix applied 3+ times with identical edit patches
1881 7:39p 🔴 T19 async params fix committed: SHA 3899549
1882 " 🔵 apps/e2e directory contains 21 existing spec files — no seo.spec.ts yet
1883 " 🟣 T21: apps/e2e/seo.spec.ts created — 5 Playwright E2E smoke tests for SEO routes
1884 7:40p 🔵 playwright.config.ts: E2E suite runs Next.js dev server on port 3100 with PLAYWRIGHT=true env
1885 " 🔵 Anynote plans table: 3 rows — Персональный, ПРО, МАКС
1886 " 🔵 Next.js dev server conflict: port 3000 already running (PID 50926) blocks new dev instance on 3100
1887 " 🔴 Existing Next.js dev server (PID 50926) killed to unblock Playwright E2E test run
1888 7:41p 🔵 buildMetadata utility: canonical + OG metadata builder used across all public pages
1889 " 🔵 Homepage page.tsx: renders Organization + WebSite + SoftwareApplication JSON-LD in one JsonLd call
1890 " 🔵 CRITICAL: T21 canonical assertion will fail — actual href is `http://localhost:3100` (no trailing slash)
1891 7:42p 🔵 Homepage JSON-LD confirmed live: 3-schema array with Organization, WebSite+SearchAction, SoftwareApplication
1892 " 🔵 og:image absent from homepage SSR HTML — file-based opengraph-image.tsx not auto-injecting meta tag
1893 7:43p 🔵 Next.js 16.2.0 canonical URL rendering strips trailing slash — metadata.js uses canonical.url.toString() directly
S476 Observer monitoring feat/seo SEO implementation — checking git push and PR status after all 22 tasks complete (May 14 at 8:03 PM)
1894 8:07p 🔵 AnyNote feat/seo branch audit initiated
1895 " 🔵 feat/seo branch commit history fully reconstructed
1896 8:08p 🟣 AnyNote feat/seo branch implements complete SEO infrastructure for public web pages
1897 " 🔵 AnyNote SEO architecture: buildMetadata, robots.ts, sitemap.ts implementation details confirmed
1898 " 🔵 SEO integration confirmed across all public pages and protected layouts
1899 8:09p 🔵 SEO unit tests and e2e spec fully examined — test strategy and key gotchas confirmed
1900 " 🔵 SEO env vars missing from CI workflows and deploy pipeline — production wiring gap identified
1901 " 🔵 Brand assets confirmed: logo.png exists for Organization schema, icon/apple-icon generated via brand-icon component
1902 " 🔵 WebSite SearchAction target URL /app/search does not exist as a real route
1903 8:10p 🔵 /registration and /sign-out routes missing from robots.txt disallow list
1904 " 🔵 All 24 SEO unit tests pass — feat/seo branch is green
1905 " 🔵 TypeScript type-check and ESLint both pass clean on feat/seo branch
1906 " 🔵 Server-side TypeError during legal doc e2e test — swallowed error with digest 3122224828
1907 8:11p 🔵 All 6 Playwright SEO e2e tests pass — branch fully verified end-to-end
1908 " 🔵 Next.js production build succeeds — route table confirms SEO routes deployed correctly, standalone output caveat noted
1909 " 🔵 OG image 404 bug in production build: Next.js hashes opengraph-image route names but og:image meta tags use unhashed paths
1910 8:12p 🔵 Root cause confirmed: e2e runs in dev mode (no hash), production uses hashed OG routes — defaultOgImagePath must be removed
1911 " 🔵 OG image 404 bug exists in both dev (Turbopack) and production — e2e tests only check tag presence, not URL reachability
1912 " 🔵 TypeError digest 3122224828 linked to both OG image 404 responses and legal doc page render — likely MDX module resolution failure

Access 449k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
