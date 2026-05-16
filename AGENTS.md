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

# [anynote] recent context, 2026-05-16 9:24pm GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (16,440t read) | 601,856t work | 97% savings

### May 16, 2026
S563 Kanban table-view sprint management: three-dot menu, complete/edit/delete dialogs, status translation, date display, active-sprint highlight, default filter (May 16 at 9:25 AM)
S564 Kanban table-view sprint management: three-dot menu with start/complete/edit/delete, status translation, inline dates, active-sprint highlight, default-to-current filter (May 16 at 9:27 AM)
S565 Add sprint lifecycle controls to kanban table view — start/complete/edit/delete via three-dot menu, Russian status labels, date display, active sprint accent, default-to-current filter. 14-task TDD plan being executed via subagent-driven development. (May 16 at 9:29 AM)
S567 Observer session monitoring primary Claude Code session: `/simplify` skill invoked after all 14 kanban sprint management plan tasks completed — code quality review of feat/kanban-p1 branch (22 files, 1145+/118- lines) (May 16 at 9:30 AM)
S568 Simplify kanban sprint subsystem via /simplify — security, DRY, efficiency, style improvements (May 16 at 5:06 PM)
S566 Observer monitoring primary session implementing kanban sprint management plan — all 14 tasks complete, finishing-a-development-branch workflow in progress, final holistic code review completed (May 16 at 5:06 PM)
S569 7-item kanban UI/UX bug batch + simplify refactor commit — anynote sprint table view (May 16 at 5:21 PM)
2222 5:44p 🔵 Pre-commit state clarified — manage-list-popover.tsx has unstaged changes; task-form.tsx has 12 deletions from HEAD
2223 5:45p 🔴 Kanban filter popover slowness fixed — complete changeset confirmed via git diff HEAD
2225 5:58p 🔵 Kanban Task Filters Work-in-Progress State
2230 5:59p 🔴 Next.js scroll-behavior warning fix requested
2226 " 🔵 Web Package TypeScript Check Passes Clean
2227 " 🔵 GanttView Component Implementation — gantt-task-react Integration
2228 " 🔵 Lint and Editor Type Checks Both Pass — Error Is Runtime or Build-Time
2229 " 🔵 GanttView SSR Safety Via Parent Dynamic Import — Not Individually Wrapped
2231 6:00p 🔵 Next.js Production Build Passes Webpack and TypeScript Phases
2233 " 🔵 Full Production Build Succeeds — Error Is Not Build-Time
2232 " 🔴 Fixed Next.js scroll-behavior warning in root layout
2234 " 🔵 kanban-task-filters.spec.ts — Performance and DOM Cleanliness Test for Filter Popovers
2235 " 🔵 Full Staged Changeset — Kanban Filter Refactor Scope
2236 6:01p 🔵 Full Monorepo Turbo check-types Passes — All 17 Packages Clean
2237 " ✅ layout.tsx — data-scroll-behavior="smooth" Added to html Element (Unstaged)
2238 " 🔄 manage-list-popover.tsx — DnD Removed, Custom VirtualizedRows Implemented
2239 " 🔴 kanban-board-page.tsx — Board Views Hidden When Task Detail Open (DOM Count Fix)
2240 " 🔵 Playwright Config — Root-Level, port 3100, Turbo Dev Server, No reuseExistingServer
2241 6:02p 🔴 kanban-task-filters e2e Test PASSES — Fix Verified in 21 Seconds
2242 " 🔵 Playwright Dev Server Conflict — reuseExistingServer:false Blocks If port 3000 Has Running Dev Server
S570 Fix 7 kanban UI/UX bugs + task card popover performance issues (May 16 at 6:06 PM)
2244 6:06p 🔵 task-side-panel showDetails defaults to true — should be false
2245 6:07p 🔵 Sprint filter X button logic and sprint-section header alignment root cause found
2246 " 🔵 Sprint filter "All" bug root cause: URL param deletion conflicts with defaultSprint='current'
2247 6:08p 🔵 task-form.tsx architecture: monolithic 660-line component with all popovers and mutations inline
2248 " 🔵 task-form.tsx parent task popover: unmemoized parentCandidates computed on every render
2249 " 🔴 Issues 1 & 3 fixed: showDetails default false, SprintMenu right-aligned
2250 6:09p 🔴 Issues 4 & 5 fixed: sprint filter X removed, "All" selection now works with defaultSprint='current'
2251 " 🔴 Issue 2 fixed: drag-drop flicker eliminated with optimistic update in TableView
2252 " 🔴 Type error in optimistic update: columnId/position not in task.update input type
2253 " 🔵 TS2589 persists on useMutation line 33 after removing invalid fields
2254 6:10p 🔴 Drag-drop flicker fix moved from onMutate to handleDragEnd to avoid TS2589
2255 " 🔴 TS2589 on setData: switched from object form to updater function form
2256 " 🔵 TS2589 persists on setData regardless of object vs updater form — type assertion likely needed
2257 " 🔵 Established pattern for tRPC setData TS2589: cast setData to explicit function type before calling
2258 " 🔴 TS2589 resolved in table-view.tsx: applied board-view setData cast pattern
2259 6:11p 🟣 Issue 6: task row context menu begun — adding MUI menu imports to sprint-section.tsx
2260 " 🟣 Issue 6: TaskRowMenu component added to sprint-section.tsx with "Remove from sprint" action
2261 " 🟣 TaskRowMenu passes type-check and lint — now needs wiring in TableView and SprintSection render
2262 " 🟣 table-view.tsx wiring point identified for onRemoveTaskFromSprint
2263 6:12p 🟣 Issue 6 complete: "Remove from sprint" fully wired — TableView → SprintSection → TaskRow → TaskRowMenu
2264 " 🔵 AnyNotePlainEditor is not memoized — re-renders on every TaskForm state change
2265 6:13p 🔴 Issue 7 perf fix begun: useMemo imported to task-form.tsx for parentCandidates memoization
S571 3 additional kanban fixes: TaskRowMenu icon missing, sprint menu alignment, sprint sort order (May 16 at 6:13 PM)
2266 6:17p 🔵 Sprint sort order uses position:asc in backend; TaskRowMenu icon is wrong
2267 6:24p 🔵 sprint-section.tsx imports MoreVertIcon but not DeleteIcon
2268 6:25p 🔴 TaskRowMenu "Удалить из спринта" now shows DeleteIcon in error color
2269 " 🔴 Sprint header menu now truly right-aligned via flexGrow spacer
2270 " 🔴 Sprint list now sorted by startDate desc, newest sprint first
S572 3 additional kanban fixes: TaskRowMenu missing DeleteIcon, sprint header alignment, sprint sort by startDate desc (May 16 at 6:26 PM)
2271 6:32p 🔵 Task disappears on drag-to-backlog due to active sprint filter
2272 6:33p 🔴 Task disappearing on drag-to-backlog fixed with sprint-agnostic tableViewTasks
2273 " 🔴 Drag-to-backlog disappearing task fixed and committed as f50de5b

Access 602k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
