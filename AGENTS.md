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

# [anynote] recent context, 2026-05-25 9:56pm GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (15,090t read) | 506,328t work | 97% savings

### May 25, 2026
S754 Fix overlapping comment highlights on text pages — user confirmed issue is option 1: stacked amber highlight spans in editor text (May 25 at 4:04 PM)
S755 Fix overlapping comment highlights on text pages — diagnosis complete, awaiting user confirmation before implementing fix (May 25 at 4:13 PM)
S756 Fix overlapping comment highlights on text pages — COMPLETED: stacked amber decoration spans fixed via range-merging utility (May 25 at 4:16 PM)
S758 4-task comment UX redesign — full architecture design proposed, awaiting user approval before implementation (May 25 at 4:48 PM)
S757 4-task comment UX expansion: (1) Playwright visual check, (2) resolve button as icon, (3) #comment URL deep-link, (4) inline thread popover — starting new session after overlap fix (May 25 at 4:51 PM)
S759 User approved comment UX redesign — implementation starting with resolve icon → #comment hash → inline popover (May 25 at 5:06 PM)
S761 User committed prior changes and instructed to create branch feat/comments-popover and continue implementation there (May 25 at 5:09 PM)
S762 feat/comments-popover — implement inline comment UX (popover, active highlight, #comment deep-link, resolve/reopen) with full TDD gate pass and E2E verification, then merge to main (May 25 at 5:28 PM)
S760 Comment UX redesign — full spec written and finalized at docs/superpowers/specs/, awaiting user review before implementation plan (May 25 at 5:28 PM)
3331 5:44p 🟣 Task 1 Committed: feat(comments): resolve/reopen as a top-right corner icon
3332 " 🟣 Task 2 RED: comment-hash.test.ts Created with 3 Failing Tests
3333 5:45p 🟣 Task 2 RED Confirmed: comment-hash module not found, 0 tests collected
3334 " 🟣 comment-hash.ts Created: parseCommentHash Pure Utility Function
3335 " 🟣 use-comment-hash.ts Created: hashchange Listener Hook for #comment Deep-Links
3336 " 🟣 Task 2 GREEN: comment-hash Tests Pass, Lint Clean
3337 " 🟣 Task 2 Committed: feat(comments): parse #comment-&lt;id&gt; deep-link hash
3338 5:46p 🟣 Task 3 RED Start: comment-ranges.test.ts Import Updated for commentDecorationSpecs
3339 " 🟣 Task 3: commentDecorationSpecs Implemented in comment-ranges.ts (GREEN Phase)
3340 " 🟣 Task 3 comment-ranges GREEN: 12/12 Tests Pass; comments.ts Structure Confirmed
3341 " 🟣 comments.ts Fully Refactored: Active Anchor State + commentDecorationSpecs + setActiveCommentAnchor
3342 5:49p 🟣 Task 4: CommentPopover union type and context split — openThread replaced by openThreadPopover + openThreadInSidebar
3343 7:31p 🟣 CommentPopover gets stable CSS class for E2E targeting
3344 " 🟣 E2E spec extended with popover, highlight, and hash-navigation assertions
3345 " 🔵 E2E test environment has no Yjs server — comment-highlight spans absent after reload
3346 " 🔴 Strict-mode violation: `getByRole('button', { name: 'Комментарии' })` matched two elements
3347 7:45p 🔵 E2E spec confirmed at 143 lines with canonical (a)/(b)/(c) structure — `.comment-highlight` still checked after reload
3348 7:47p 🟣 E2E spec extended to verify inline comment popover, active highlight, and hash deep-link
3349 " 🔴 MUI Tooltip popper intercepts highlight click — fixed with Escape + mouse.move
3350 " 🟣 CommentPopover Paper tagged with className="comment-popover" for stable E2E targeting
3351 " 🔵 Playwright env has no Yjs/Hocuspocus server — editor content lost on reload
3352 " 🟣 feat/comments-popover branch complete — 9 commits, all gates green
3353 9:05p 🟣 feat/comments-popover fast-forward merged to main and branch deleted
3354 " ✅ Persistent memory note written: E2E no-yjs-persistence pattern and tooltip intercept gotcha
3355 " ✅ MEMORY.md index updated with E2E no-yjs-server entry
3356 9:12p 🔵 CommentsSidebar is sibling to main content box, inside the flex row below the toolbar
3357 " 🔵 CommentPopover onResolve does not close the popover after resolving a thread
3358 9:14p 🔴 CommentsSidebar now spans full viewport height alongside toolbar
3359 " 🔴 CommentPopover closes on resolve and reopen actions
3360 9:15p 🟣 E2E spec extended to verify popover closes on resolve
3361 9:17p 🔴 CommentsSidebar Layout Fix — Full-Height Sidebar
3362 " 🔴 Resolve/Reopen Thread Now Closes Comment Popover
3363 " 🟣 E2E Spec Extended to Verify Both Comment Bug Fixes
3364 " 🔵 Next.js 15 Single-Instance Lock Blocks Playwright WebServer Startup
3365 9:28p 🔵 PID 69867 Respawns After kill — Managed by Parent Process 69838
3366 " 🔵 E2E Test Ran But Failed — .comment-popover Not Found on Re-open Click
3367 " 🔴 E2E Spec Fix — Resolve Popover Test No Longer Re-opens Highlight
3368 9:29p 🔴 page-comments E2E Suite Passes — Both Fixes Verified
3369 9:30p ✅ Full CI Gate Passes After Comment Panel Bug Fixes
S763 Fix two comment panel bugs: (1) sidebar should span full viewport height beside toolbar, not below it; (2) clicking "Решить" should close the thread popover (May 25 at 9:30 PM)
3370 9:34p 🔵 Comments Panel Z-Index / Stacking Issue Identified
3371 " 🔵 Comments Feature Implementation Status on feat/comments-popover Branch
3372 " 🔴 Comments Sidebar Vertical Positioning Fixed via Layout Restructure
3373 " 🔴 Comment Popover Now Closes on Resolve/Reopen
3374 " 🔵 Comments Feature on main Branch — Recent Commit History
3375 " 🔴 Share Page Layout Also Fixed for Comments Sidebar Vertical Positioning
3376 9:35p ✅ All Four Fixes Pass TypeScript and ESLint Gates
3377 " 🔴 E2E Test Passes — All Comments Fixes Verified in Full Playwright Run
3378 9:36p ✅ share-page-content Class Added to Share Page Content Box
3379 " ✅ Share Page Sidebar Positioning Covered by E2E Test in page-sharing.spec.ts
3380 9:37p 🔴 Share Page Sidebar Positioning Verified via E2E Test for Anonymous Visitors

Access 506k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
