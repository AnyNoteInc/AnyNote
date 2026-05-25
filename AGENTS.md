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

# [anynote] recent context, 2026-05-25 9:04am GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (20,929t read) | 1,465,381t work | 99% savings

### May 24, 2026
3118 11:01a 🔵 Database Schema Has No Sharing Models Yet
3119 " 🔵 Share Button Target: PageActionsToolbar rightSlot in WorkspaceToolbar
3120 " 🔵 tRPC Page Router Architecture and Auth Pattern
3122 11:02a ⚖️ Page Sharing Feature Specification Defined
3123 11:04a 🔵 Next.js App Router Structure Mapped for Sharing Route Implementation
3124 11:22a 🟣 feat/page-sharing Branch Created — Implementation Starting
3125 11:23a 🟣 Page Sharing Design Spec Written to docs/superpowers/specs/
3126 11:26a ⚖️ User approved spec; requesting implementation plan for page sharing
3128 " 🔵 apps/web/.env is a symlink to root .env — share token secret auto-available in E2E
3129 " 🟣 Task 15: Playwright E2E spec for page sharing — apps/e2e/page-sharing.spec.ts
3127 11:33a 🟣 Complete implementation plan written for page sharing feature
3130 12:27p 🔵 Primary session resumed at 15:00 after ~3.5h pause — user issued "продолжи"
3131 12:28p 🟣 Task 15 E2E test PASSED — page-sharing.spec.ts green on first run in 31.1s
3133 4:00p 🟣 Task 16 COMPLETE — pnpm gates all green: 35 tasks, 230 web tests + 105 agent tests passed
3134 " 🔵 Branch state confirmed clean — 678958f HEAD, 18 commits ahead of main, working tree clean
3135 4:01p 🔵 Full page-sharing branch commit history and UI diff stat revealed
3132 4:02p 🟣 Task 15 committed — git commit 678958f "test(e2e): public page sharing access flow"
S730 Spec 2 (inline anchored comments) — full data model and auth/permissions layer designed; user asked to confirm author model and moderation rules (May 24 at 4:18 PM)
S731 Spec 2 (inline anchored comments) — complete architecture finalized including editor integration, UI layout, realtime strategy, test plan, and 6-phase implementation roadmap; user asked to confirm or amend before spec is written (May 24 at 4:21 PM)
S732 Spec 2 (inline anchored comments) — user confirmed full architecture ("фиксируй спеку"); primary session now writing spec document (May 24 at 4:22 PM)
S734 Spec 2 implementation underway — feat/page-comments branch active, spec being written; full architecture confirmed by user (May 24 at 4:40 PM)
S733 Spec 2 implementation started — feat/page-comments branch created; user confirmed full architecture ("фиксируй спеку") (May 24 at 4:43 PM)
S735 Spec 2 (inline page comments) design phase complete — spec committed, awaiting user review before implementation planning (May 24 at 4:48 PM)
3136 4:49p ⚖️ User approved Spec 2 and directed implementation planning
S736 Spec 2 (inline page comments) complete and committed — user approved, proceeding to implementation planning (May 24 at 4:49 PM)
S738 Observer session monitoring feat/page-comments — Spec 2 inline page comments, post-code-review security fix, branch finishing in progress (May 24 at 4:54 PM)
3137 4:54p 🔵 Existing kanban comment router pattern discovered as template for page comments
3138 " 🔵 notify.commentCreated and notify.pageMention pre-wired stubs confirmed in notifications package
3139 " 🔵 KanbanBus and subscription pattern confirmed as direct clone source for pageCommentBus
3140 " 🔵 drop-placement.ts Decoration.node pattern inspected as reference for comment anchor decorations
3141 4:55p 🔵 y-prosemirror RelativePosition API confirmed available in installed package (v1.3.7)
3142 " 🔵 Editor extension registry (extensions/index.ts) and BuildExtensionsOptions shape confirmed
3143 5:00p 🟣 Full implementation plan written for inline page comments (15 tasks, 6 phases)
3144 " ⚖️ Inline Page Comments Implementation Plan Accepted and Committed
3145 " ⚖️ actorId Relaxation Must Precede Comment Router Implementation
3200 5:44p 🟣 Task 10: @mention autocomplete added to CommentComposer
3201 " 🟣 Task 9 fan-out test + Task 10 write committed; branch at 5a0ebde
3202 6:05p 🔵 Branch feat/page-comments advanced to 8 commits past expected HEAD
3203 6:06p 🔵 Full merge gate passes: 35 tasks, 235 tests, FULL TURBO cache
3218 6:26p 🔵 Six UI/UX Issues Identified for Page-Comments Feature
3219 " 🔵 Full Test Suite Passes on feat/page-comments HEAD (277a29b)
### May 25, 2026
3204 4:36a 🔵 AGENTS.md dirty file is a claude-mem context refresh (10:47am → 8:52pm)
3205 " 🔵 Complete feat/page-comments commit range confirmed: 11 commits since ce51fba
3206 4:37a 🔵 Full feature diff stat: 15 files, 1070 insertions, 192 deletions across Spec 2
3207 4:39a 🟣 Task 11: comment-access.ts implements anonymous identity + public-link resolution
3208 " 🟣 Tasks 11–13: comment router adds requireAnonymousAuthorIdentity, events.subscribe, and bus emissions
3209 " 🟣 Tasks 12–13: share route passes role to PageRenderer; use-page-comments wires SSE subscription
3210 " 🟣 CommentComposer final form (247 lines): Context provider, race-safe async search, full ARIA keyboard nav
3211 " 🔴 floating-toolbar: lastCommentAnchorRef preserves anchor when Tiptap clears selection on click
3212 " 🔴 comment-anchor.ts: switch import from y-prosemirror to @tiptap/y-tiptap
3213 " 🟣 page-renderer wraps TEXT page in CommentMentionSearchProvider and hardens mentionSearch with try/catch
3214 4:41a 🔵 @tiptap/extension-collaboration 3.22.3 imports ySyncPluginKey from @tiptap/y-tiptap (not y-prosemirror)
3215 " 🟣 comment-access.test.ts extended: 4 new tests for public-link + anonymous resolution paths
3216 " 🟣 comment-router.test.ts extended: 4 new tests for anonymous public link + realtime subscription boundaries
3217 " 🟣 E2E test: apps/e2e/page-comments.spec.ts — full inline comment creation and persistence flow
S737 Observer session monitoring feat/page-comments branch — Spec 2 inline page comments implementation through code review, security fix, and branch finishing (May 25 at 4:42 AM)
S739 Observer session monitoring feat/page-comments — Spec 2 inline page comments complete, post-review security fix committed, branch finishing awaiting user direction (May 25 at 4:47 AM)
3220 8:51a 🔵 PlantUML Render Route Requires Authentication — Root Cause of Issue #1
3221 " 🔵 Comment UI Component Locations and Current Button Labels
3222 8:52a 🔵 Full Source Structure Mapped for All Six Comment UI Fixes

Access 1465k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
