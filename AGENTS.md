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

# [anynote] recent context, 2026-05-15 6:51am GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (17,938t read) | 396,943t work | 95% savings

### May 14, 2026
S478 /simplify review of feat/seo branch — three parallel subagents running: reuse review, quality review, efficiency review (May 14 at 8:03 PM)
1909 8:11p 🔵 OG image 404 bug in production build: Next.js hashes opengraph-image route names but og:image meta tags use unhashed paths
1910 8:12p 🔵 Root cause confirmed: e2e runs in dev mode (no hash), production uses hashed OG routes — defaultOgImagePath must be removed
1911 " 🔵 OG image 404 bug exists in both dev (Turbopack) and production — e2e tests only check tag presence, not URL reachability
1912 " 🔵 TypeError digest 3122224828 linked to both OG image 404 responses and legal doc page render — likely MDX module resolution failure
1913 8:18p ⚖️ SEO Branch Fixes Initiated — User Confirmed "Fix the Problems You Found"
1914 " 🔵 Next.js OG Image Hash Fix — Codex Consulting Official Docs Before Rewriting buildMetadata
1915 8:19p 🔵 Next.js Official Docs Confirm: opengraph-image Routes Are Served with Hashes in Production
1916 " 🔵 deploy.yml Env Block Missing SEO Verification Vars and SEO_NOINDEX_ALL
1917 " 🔵 Original SEO Spec Did Not Include openGraph.images Auto-Derivation in buildMetadata
1918 8:20p 🔴 TDD Red Phase: Three Failing Tests Written Before Implementation Changes
1920 " 🔴 Five SEO Issues Fixed Across Six Files in feat/seo Branch
1919 " 🔵 deploy/.env.template Missing YANDEX_VERIFICATION, GOOGLE_SITE_VERIFICATION, SEO_NOINDEX_ALL
1921 8:21p 🔴 All SEO Unit Tests Green — TDD Red-Green Cycle Complete for Five Fixes
1922 " 🔴 TypeScript Typecheck Passes After SEO Fixes — No Type Errors Introduced
1923 " 🔵 check-types Fails with TS6053 Due to Stale/Missing .next/types — Pre-existing, Not SEO-Related
1924 " 🔴 Production Build Succeeds — Hashed OG Image Routes Confirmed in Route Table
1925 8:22p 🔴 E2E SEO Tests Running Against Dev Server — First Test Failing
1926 " 🔴 E2E Homepage og:image Fails — openGraph.images: undefined Suppresses File-Convention Auto-Wiring
1927 8:23p ⚖️ Strategy Pivot: Restore defaultOgImagePath() — Un-hashed Paths Needed to Emit og:image Tags
1928 " 🔄 OG Image File Convention Replaced with Stable API Route Handlers for pricing and legal docs
1929 8:31p 🟣 feat/seo branch scope expanded by /simplify review pass
1931 " 🔄 Simplify skill launched async reuse-review subagent for feat/seo (8 targeted checks)
1930 8:32p 🔄 Simplify pass created commit a33b7c8 — OG images converted to route handlers, deployment files touched
1932 " 🔄 Second async subagent launched for quality review of feat/seo (agent a267d9ea0bdff2ebb)
S479 /simplify review of feat/seo — three parallel subagents running; quality review result received, waiting for reuse and efficiency reviews (May 14 at 8:33 PM)
1933 8:33p 🟣 New deploy-config.test.ts validates SEO env vars wired into Dockerfile and deploy.yml
S480 /simplify review of feat/seo — reuse review received, waiting for efficiency review (last of three) (May 14 at 8:33 PM)
S481 PR creation, CI wait, SonarQube fixes, merge to main, and release — user kicked off full release pipeline for feat/seo branch after /simplify refactors (May 14 at 8:34 PM)
1934 8:34p 🔄 Added siteDisplayHost constant to site-config.ts — eliminates displayHost regex duplication across 3 OG files
1935 8:35p 🔄 build-metadata.ts: added NOINDEX_METADATA export and simplified defaultOgImagePath
1936 " ⚖️ Post-SEO Merge Workflow Initiated
S483 Full release pipeline for feat/seo: deploy v1.17.0 completion confirmed (May 14 at 8:51 PM)
1937 8:52p 🟣 feat/seo Branch Pushed and PR #14 Created
1938 8:58p 🔵 PR #14 CI Checks All Green — SonarCloud Passed with No Issues
1939 8:59p 🔵 SonarCloud Found One Open Issue on PR #14 — String#replace() in json-ld.tsx
1940 " 🔵 SonarCloud PR #14 Has 7 Open Issues Across 4 Files
1941 " 🔵 json-ld.tsx Line 9 Uses .replace(/&lt;/g) with Escaped Backslash — Two SonarQube Fixes Needed
1942 9:00p 🔴 json-ld.tsx XSS Escape Rewritten to Satisfy S7780 + S7781
1943 " 🔵 String.raw Template Literal Written With Literal &lt; Instead of \u003c — XSS Fix Broken
1944 9:01p 🔵 Write Tool Persisting SCRIPT_TAG_ESCAPE Constant but Template Literal Still Contains Literal &lt; Not \u003c
1945 " 🔴 printf Workaround Correctly Wrote \u003c Bytes to json-ld.tsx; sitemap.ts Priority 1.0 → 1
1946 9:02p 🔴 schemas.test.ts and sitemap.test.ts SonarQube S4325/S7748 Fixes Applied
1947 " 🔵 All Gates Green After SonarQube Fixes — 25 Tests, Lint, Types All Pass
1948 " 🔵 E2E Suite 6/6 Green After json-ld.tsx XSS Fix — JSON-LD Rendering Unaffected
1949 " 🔴 SonarQube Fixes Committed as f5df285 and Pushed to feat/seo
1950 9:10p 🔵 PR #14 CI Re-Run Clean — SonarCloud Now Reports 0 Open Issues
1951 " 🟣 PR #14 Squash-Merged into main — SEO Feature Shipped
1952 " 🔵 Release Pipeline Uses semantic-release Triggered by Push to main
1953 9:11p 🟣 PR #14 Merge Confirmed on main — SHA 94376a1 — SEO Fully Landed
1954 9:19p 🟣 release.yml Workflow Completed Successfully — Semantic-Release Ran on Merge Commit
1955 " 🟣 AnyNote v1.17.0 Released — SEO Feature Ships as Minor Version Bump
1956 " 🟣 v1.17.0 CHANGELOG Published — Full SEO Feature Inventory Confirmed
1957 " 🟣 v1.17.0 Deploy Workflow Triggered and In-Progress
S484 Full release pipeline complete — feat/seo PR, CI, SonarQube fixes, merge, release v1.17.0, deploy to production (May 14 at 9:29 PM)
S482 Full release pipeline for feat/seo: PR → CI → SonarQube fixes → merge → release → deploy (May 14 at 9:29 PM)
S487 Kanban Board Feature Planning — designing KANBAN as a new page type in AnyNote (May 14 at 9:31 PM)
### May 15, 2026
1958 6:09a ⚖️ Kanban Board Feature Planning for AnyNote
S486 Kanban Board Feature Planning — designing KANBAN as a new page type in AnyNote (May 15 at 6:09 AM)
S485 Kanban Board Feature Planning — implementing a KANBAN page type for AnyNote (May 15 at 6:09 AM)
**Investigated**: The user has opened relevant project files including MEMORY.md, compose.yml, deploy.yml, and a recent SEO design spec. The request signals intent to first explore the existing database structure before committing to an implementation approach.

**Learned**: The Kanban board will follow the existing page creation pattern — users create a Kanban board as they would any other page, and the system differentiates it via a new KANBAN page type in the data model. No implementation details are finalized yet pending database schema review.

**Completed**: Nothing has been built yet. The session is at the requirements and planning stage — the user has articulated the core design decision (Kanban as a page type) and is preparing to investigate the database structure.

**Next Steps**: Exploring the database schema to understand existing page type modeling, then brainstorming what data structures are needed for Kanban (columns, cards, ordering, status), and deciding on implementation approach for the new KANBAN page type.


Access 397k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
