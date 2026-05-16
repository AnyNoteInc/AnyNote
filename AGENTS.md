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

# [anynote] recent context, 2026-05-16 5:58pm GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (19,090t read) | 966,803t work | 98% savings

### May 16, 2026
2174 9:19a 🔵 Sprint Router Already Has activate/complete/delete Mutations
2175 " 🔵 BoardData Type Missing startDate/endDate in Sprint Interface
2177 " 🔵 Complete Sprint Feature Architecture Map for Implementation
S559 Add sprint management features to Kanban table view — Section 2 design: sprint-section.tsx header redesign with dates, status badge, menu button, and active sprint accent (May 16 at 9:24 AM)
S561 Add sprint management features to Kanban table view — Sections 3 and 4 design: SprintMenu component and three new dialog components (Edit, Complete, Delete) (May 16 at 9:24 AM)
S562 Add sprint management features to Kanban table view — Section 5 (final design): default-to-current-sprint filter behavior via useKanbanFilters hook enhancement (May 16 at 9:24 AM)
S560 Add sprint management features to Kanban table view — Section 3 design: SprintMenu component with four actions gated by sprint status (May 16 at 9:24 AM)
S563 Kanban table-view sprint management: three-dot menu, complete/edit/delete dialogs, status translation, date display, active-sprint highlight, default filter (May 16 at 9:25 AM)
2178 9:25a 🔵 Design Spec Naming Convention in docs/superpowers/specs/
2179 " 🟣 Sprint Management Design Spec Written to docs/superpowers/specs/
S564 Kanban table-view sprint management: three-dot menu with start/complete/edit/delete, status translation, inline dates, active-sprint highlight, default-to-current filter (May 16 at 9:27 AM)
S565 Add sprint lifecycle controls to kanban table view — start/complete/edit/delete via three-dot menu, Russian status labels, date display, active sprint accent, default-to-current filter. 14-task TDD plan being executed via subagent-driven development. (May 16 at 9:29 AM)
S567 Observer session monitoring primary Claude Code session: `/simplify` skill invoked after all 14 kanban sprint management plan tasks completed — code quality review of feat/kanban-p1 branch (22 files, 1145+/118- lines) (May 16 at 9:30 AM)
2180 9:40a 🟣 Task 12: useKanbanFilters defaultSprint option wired from hasActiveSprint
2181 " 🔵 Task 12 reviewer verified URL-param vs defaultSprint precedence logic
2182 4:59p 🔵 Task 12 reviewer subagent enters caching loop (same agentId a27893f7b7a98a947)
2183 " 🔵 Docker infrastructure confirmed healthy for E2E test environment
2184 " 🔵 Existing kanban-board.spec.ts read as context for Task 13 sprint lifecycle spec
2185 5:00p 🟣 Task 13: sprint-lifecycle.spec.ts E2E test created
2186 5:01p 🟣 Task 13: sprint-lifecycle.spec.ts passes green in 10s
2187 5:02p 🔴 E2E: getByText('Выполнено') strict-mode violation — substring matched 'Не выполнено'
2188 " 🟣 Task 13 committed: sprint-lifecycle.spec.ts at b6dc2b6
2189 " 🔵 Task 13 reviewer: MuiPaper-root XPath selector is moderately brittle but team-accepted pattern
2191 " 🟣 Task 14: pnpm gates passes — 47 test files, 173 tests all green
2192 " 🔵 Final kanban sprint management file structure confirmed post-implementation
2190 5:03p 🟣 Kanban sprint management plan: complete 15-commit implementation on feat/kanban-p1
S566 Observer monitoring primary session implementing kanban sprint management plan — all 14 tasks complete, finishing-a-development-branch workflow in progress, final holistic code review completed (May 16 at 5:06 PM)
2193 5:15p 🔄 Sprint Router Security and Performance Hardening
2194 " 🔄 Parallelized DB Lookups in Sprint Complete Transaction
2195 5:16p 🔄 Sprint Delete Mutation Switched to deleteMany with PageId Scope
2196 " ⚖️ P2002 Error Handling Re-added to Sprint Activate After Simplify Review
2197 5:17p 🔄 pluralize-ru Utility Moved to Shared kanban/lib Directory
2198 " 🔄 Import Paths Updated and pluralDays Inline Function Removed from task-side-panel
2199 " 🔵 Type Check and Lint Pass After Sprint Router and pluralize-ru Refactoring
2200 " 🔄 Shared toDate Utility and SprintLike Interface Extracted to kanban/lib and sprint/types
2201 5:18p 🔄 Sprint Components Now Import Shared SprintLike and toDate Instead of Inline Definitions
2202 " 🔄 sprint-section.tsx Adopts Shared toDate and Removes JSX IIFE Pattern
2203 " 🔵 Sprint Activate Test Fails After pageId Added to Prisma Where Clause
2204 5:21p 🔵 kanban-sprint.test.ts Line 63 Needs Where Clause Updated to Include pageId
2206 " 🔵 All Gates Pass After Full Simplify Session
S568 Simplify kanban sprint subsystem via /simplify — security, DRY, efficiency, style improvements (May 16 at 5:21 PM)
2205 5:22p 🔴 kanban-sprint.test.ts Updated to Match pageId-Scoped Sprint Activate Assertion
2207 5:29p 🔵 Kanban Filter Dropdown Slowdown Root Cause Identified
2208 " 🔴 Fixed Progressive Dropdown Slowdown in Kanban Card Detail
2209 " ✅ TypeCheck and Lint Pass After Kanban Performance Fix
2210 5:34p 🔴 E2E Test Confirms Kanban Filter Popover Slowdown Is Fixed
2211 " 🔵 Real Kanban Architecture Uses tRPC, Not Zustand — Different Root Cause
2212 " 🔵 Double Board Invalidation — Every Filter Click Triggers Two Board Refetches
2213 " 🔴 Debounced Board Invalidation in task-form.tsx Fixes Progressive Filter Slowdown
2214 5:42p 🔵 Kanban filter popover still slow after initial fixes — further investigation requested
2215 " 🔵 Filter popover still slow after initial fixes — second investigation phase started
2216 " 🔵 task-form.tsx still uses un-debounced invalidateBoard — previous debounce fix was never saved
2217 5:43p 🟣 E2E test gains DOM-count assertion to catch un-virtualized popover rendering
2218 " 🔵 Playwright confirms ManageListPopover renders all 252 items in DOM — root cause of slowness confirmed
2219 " 🟣 ManageListPopover gains custom scroll-based virtual list to fix un-virtualized rendering
2220 " 🔴 Playwright test passes GREEN after VirtualizedRows fix — kanban filter popover DOM nodes reduced from 252 to &lt;80
2221 5:44p ✅ Web gates passing — TypeScript, ESLint, and git diff all clean after VirtualizedRows fix
2222 " 🔵 Pre-commit state clarified — manage-list-popover.tsx has unstaged changes; task-form.tsx has 12 deletions from HEAD
2224 " 🔵 Filter menu slowness persists after VirtualizedRows fix — deeper root cause investigation requested
2223 5:45p 🔴 Kanban filter popover slowness fixed — complete changeset confirmed via git diff HEAD

Access 967k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
