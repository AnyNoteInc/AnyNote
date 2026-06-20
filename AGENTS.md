# Repository Guidelines

## Project Structure & Module Organization

AnyNote is a pnpm/Turbo monorepo. Application code lives in `apps/`: `web` is the Next.js product UI, `yjs` handles collaborative editing, `agents` is the FastAPI/LangGraph LLM service, `engines` is the NestJS MCP/vectorization service, `desktop` is the Electron thin-client that loads the remote server (macOS/Windows/Linux), and `e2e` contains Playwright specs. Shared TypeScript packages live in `packages/`, including `db`, `domain` (framework-agnostic business logic shared by `trpc` and `engines`), `auth`, `trpc`, `ui`, `editor`, `excalidraw`, `genogram`, `storage`, `mail`, and `yookassa`. Architecture notes and implementation plans belong in `docs/`; Docker support lives in `docker/`.

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

# [anynote] recent context, 2026-06-07 1:27pm GMT+3

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (20,405t read) | 671,937t work | 97% savings

### Jun 7, 2026
S1187 Anynote sidebar UI: pill-shaped buttons with animation + CommentIcon swap from ChatBubbleOutline to Comment — both changes implemented and verified (Jun 7 at 10:46 AM)
S1186 Anynote sidebar button UI polish: rounder pill shape, no shadows, animated switching + CommentIcon swap from ChatBubbleOutline to Comment on all pages (Jun 7 at 10:49 AM)
S1188 AnyNote Marketplace Expansion — deep investigation complete, data model design presented for approval (Jun 7 at 10:50 AM)
S1189 AnyNote Marketplace Expansion — permissions + tRPC/domain layer design presented for Section 3 approval (Jun 7 at 10:54 AM)
S1190 AnyNote Marketplace Expansion — full design across 5 sections complete, spec doc being written before implementation (Jun 7 at 10:55 AM)
S1192 AnyNote Marketplace Expansion — design spec committed (second commit attempt, duplicate), implementation plan phase starting (Jun 7 at 10:56 AM)
S1191 AnyNote Marketplace Expansion — design spec committed, awaiting final review before implementation plan (Jun 7 at 10:58 AM)
S1193 AnyNote Marketplace Expansion — design spec minor title edit, still awaiting user spec review before implementation plan (Jun 7 at 10:59 AM)
S1194 AnyNote Marketplace Expansion — design spec finalized with permission matrix, awaiting user approval before implementation plan (Jun 7 at 11:01 AM)
S1195 Write implementation plan for AnyNote Marketplace/Templates 6-part expansion (Jun 7 at 11:09 AM)
5395 11:09a ✅ Marketplace Worktree Initialized with Env Symlink and Dependencies
5396 " ✅ Marketplace Worktree Bootstrap Complete: Prisma Client Generated, ESLint Config Built
5397 " 🔵 Docker Compose Container Name Conflict in Worktree
5398 11:10a 🔵 Domain Test Baseline: 225 Tests Pass in Worktree
5399 " 🔵 tRPC Template Router Test Baseline: 11 Tests Pass
5400 " 🔵 Subagent-Driven Development Skill: Three-Phase Review Per Task
5401 " 🔵 @repo/ui Already Exports Card, CardActionArea, Chip, StarIcon — Task 1 Scope Narrower Than Expected
5402 " 🔵 AnyNote Phase 1 Feature Plan: Collections, Personal Space, Drafts, Archive
5407 " ⚖️ AnyNote Notion-Parity Review: Parallel Agent Per Phase File (cl1–cl9)
5403 11:11a 🟣 Task 1 Complete: 5 Marketplace Tag Icons Added to @repo/ui
5404 " 🟣 Task 1 Complete: @repo/ui Type-Check Passes with New Icons
5405 " 🟣 Task 1 Shipped: Marketplace Tag Icons Committed to feat/marketplace-templates
5406 " 🟣 Task 1 Spec-Compliance Review: DONE — Subagent Confirmed No Regressions
5429 11:12a ✅ Task 9: listMarketplace and listTags procedures added to tRPC router
5430 " 🔴 Pre-existing test "forbids a normal user from creating GLOBAL template" is failing — contradicts product decision
5408 11:15a 🔵 AnyNote Full 9-Phase Roadmap Structure Confirmed
5409 11:16a ⚖️ Agent "Planck" Dispatched to Rewrite cl1.md Against Notion's Actual Model
5411 " 🔵 All cl{1..9}.md Files Are Untracked in Git; Pre-Edit Content Audit Completed
5412 " 🔵 All 6 Active Agents Timed Out After 60s; cl7/cl8/cl9 Still Unspawned; No Files Modified Yet
5413 " ✅ cl6.md Updated: Imports/Exports Aligned to Notion Model; Yandex Wiki Labeled as AnyNote Extension
5410 11:17a 🔵 Parallel Agent Dispatch: 6 of 9 Spawned Successfully, cl7/cl8/cl9 Failed on Thread Limit
5414 11:19a 🔵 Agent Euler Closed After Completion to Free Thread Slot for cl7/cl8/cl9
5415 11:20a ✅ cl1.md Rewritten: Fake DRAFT→TEAM_PUBLISHED Lifecycle Replaced with Notion Location/Access Model
5416 " ✅ cl2.md Rewritten: Share vs Publish Split; Password/Scheduled Publish Marked as AnyNote Extensions
5417 " ✅ cl3.md Rewritten: Database Rows Now Backed by Real Page Records; Inline Views as Linked Views
5418 " ✅ cl5.md Rewritten: Subscriptions Replaced with Notion "Notify Me" Preferences; History Aligned to Notion Version Model
5419 " 🟣 Agents Hubble and Bohr Spawned for cl7 and cl8 After Thread Slots Freed
5420 11:21a ✅ cl4.md Rewritten: Property-Level ACL Replaced with Notion Page-Level Access and Structure Lock
5421 " 🟣 Agent Maxwell Spawned for cl9 (Editor/AI/PWA/Meetings/Dashboards)
5422 " ✅ cl7.md Updated: Telegram Marked AnyNote-Specific; Webhooks Reframed as Developer Platform Integration
5423 11:22a ✅ cl8.md Updated: Guest Model, Domain Verification, SAML/SCIM, and Per-Seat Billing Aligned to Notion
5424 11:23a ✅ cl9.md Updated: PWA Labeled AnyNote-Specific; AI/Meetings/Dashboards Aligned to Notion AI and Charts Model
5425 " ✅ All 9 AnyNote Phase Specs (cl1–cl9) Notion-Aligned via Parallel Agent Review
5426 11:24a ✅ All 9 Phase Specs Prettier-Formatted and Verified Clean; DRAFT/PropertyACL/Yonote Patterns Fully Eliminated
5427 " ✅ Manual Polish Applied to cl3/cl4/cl9 After Agent Work: Property-Level ACL Clarification and Formatting Fixes
5428 " ✅ Second Polish Pass: "Property Permissions" Language Replaced with "Property Visibility" in cl5/cl6/cl9
5436 11:25a 🔵 Archive as First-Class Page State in AnyNote/Notion Model
5431 11:59a 🟣 Task 10: isTemplateBacking=false filter added to all page list endpoints
5432 " 🟣 Task 10: 4 new unit test suites verify backing-page visibility rules in page-ordering.test.ts
5433 12:12p 🟣 Task 10 committed: backing-page filter at commit 8e92f701
5434 " 🟣 Playwright e2e test for marketplace feature added
5435 1:17p 🔵 Playwright marketplace test blocked by port 3100 conflict
5437 1:20p 🔵 marketplace.spec.ts fails with 60s timeout on workspace creation redirect
5438 " 🔵 Workspace creation redirects to pages (not /chats/new) without subscription upgrade
5439 " 🔴 marketplace.spec.ts: broadened waitForURL to fix workspace-creation redirect mismatch
5440 1:21p 🟣 marketplace.spec.ts passing and committed at 1aabad37
5441 " 🔵 Task 15 spec compliance review: PASSED with one minor note
5442 " 🔵 pnpm check-types: agents package has 4 pre-existing mypy errors unrelated to marketplace feature
5443 1:22p 🔵 pnpm lint: all 36 tasks pass clean on feat/marketplace-templates
5444 " 🔵 pnpm test: SaveAsTemplateDialog unit tests fail due to missing listTags tRPC mock

Access 672k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
