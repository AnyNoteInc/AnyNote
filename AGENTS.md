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

# [anynote] recent context, 2026-05-19 1:45pm GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (19,411t read) | 811,202t work | 98% savings

### May 19, 2026
S653 E2E create-page-from-chat with GigaChat-2 Pro — test confirmed passing, services stopped, git commit still pending (May 19 at 6:20 AM)
S654 E2E create-page-from-chat GigaChat-2 Pro — test passing, services stopped, git status reveals uncommitted changes ready to commit (May 19 at 6:47 AM)
S657 Stale wakeup for completed task — no new work; new bug investigation ("create page from text above") is the active task (May 19 at 6:47 AM)
S655 Fix Qdrant 401 Unauthorized error in the anynote agents service on dev (May 19 at 6:49 AM)
S656 New bug reported: "create page from text above" chat flow broken with GigaChat — verify with Playwright and fix (May 19 at 7:34 AM)
S658 Fix two-turn banya chat bug: "расскажи мне про русскую баню" → confirm → "создай страницу с текстом, который описан выше" → ONE confirmation, ONE page with content. Verify with Playwright E2E and fix all issues. (May 19 at 7:37 AM)
S659 Fix two-turn banya chat bug + verify with E2E: "расскажи мне про русскую баню" → "создай страницу с текстом, который описан выше" → ONE confirmation, ONE page with full content (May 19 at 11:00 AM)
S660 Fix two-turn banya chat scenario (turn 1: banya description, turn 2: create page with that content) — verified with Playwright plugin (May 19 at 11:16 AM)
2811 11:26a 🟣 Live Banya Test — Turn 1 Confirmed DONE in DB
2812 " 🟣 Live Banya Test — Second Turn Sent
2813 " 🟣 Live Banya Test — Confirmation Dialog Appeared for createPage
2814 " 🔵 Live Browser Test — Send Button Clicked Instead of Разрешить
2815 " 🟣 Live Banya Test — Confirmation Approved, Agent Resumed
2816 11:28a 🔵 Confirmation Dialog Still Visible After Multiple Разрешить Clicks
2817 " 🟣 Live Banya Browser Test — Page Created with Content, Scenario Fully Verified
2818 11:29a 🔴 planner.j2: Forbid trailing "respond to user" steps that cause duplicate confirmations
2819 " 🔵 Live banya test: turn 2 completes in ~27s, page pre-exists from previous run
2820 11:31a 🔵 Banya turn 2 regression: critic rejects response, plan stuck at state=pending with no page created
2821 11:41a 🔵 Planner JSON parse failure causes verbatim user message as plan step, then critic loop gets stuck
2822 " 🔵 Agent log confirms last run for turn 2 at 10:31:22; subsequent browser resends at 10:36 and 10:41 produced no new runs
2823 " 🔵 UI shows confirmation dialog at state=Pending with critic text above it — user must click Confirm to proceed
2824 11:43a 🔵 Turn 2 executor made zero MCP tool calls — only 2 GigaChat completions in the entire run
2825 " 🔵 executor.j2 confirmed current state: chat_history block present, MUST-use-markdown rule present
2826 11:44a 🔵 New banya test attempt started: fresh chat a9fbedeb, turn 1 banya completed, turn 2 typed
2827 " 🔴 Confirmation poll query fixed: now watches for state=required OR state=running
2828 11:45a 🔵 Third banya attempt: planner produced valid plan, ONE confirmation at state=required — but args_preview shows only title, no markdown
2829 11:46a 🔵 _preview_default includes markdown in args_preview — its absence confirms createPage was called with title only, no markdown
2830 " 🔵 Third banya test: page created with NULL content AND 2 confirmations appeared — both core issues remain unfixed
2831 " 🔵 Full 4-part ASSISTANT message reveals planner split create+content into two createPage calls, both with title only
2832 11:47a 🔵 tool_runner.py confirms args_preview == actual tool args: interrupt() passes meta.preview(args) where args are the real tool call arguments
2833 11:48a 🔴 tool_runner.py: deduplication layer added to suppress duplicate createPage calls from 2-step plans
2834 11:49a 🔵 Fourth banya test attempt launched with dedup-enabled agents service on fresh chat 552b98a4
2835 " 🔵 Confirmation dialog appeared within ~29 seconds of turn 2 send; Разрешить clicked without waiting for poll
2836 11:51a 🔵 Multiple Разрешить clicks pattern: session approving confirmations as fast as they appear, now polling for 2 DONE ASSISTANT messages
2837 " 🔵 BREAKTHROUGH: Page created with content (4442 chars) and markdown in args_preview — executor correctly included banya text in createPage call
2838 11:53a 🔴 SKEW_SECONDS increased 60→600 in agents-internal-auth.guard.ts to fix resume 401
2839 " 🔴 executor.j2 chat_history rendering removed; LLM now reads history from seeded message context
2840 " 🔵 Single-step plan generated and confirmation fired with full banya markdown in args_preview
2841 " 🔵 Engines watch-mode spawns duplicate process causing EADDRINUSE on every restart attempt
2842 12:12p 🟣 Banya two-turn create-page scenario working end-to-end: page created with content
2843 " 🔵 Chat sidebar shows 7+ banya-titled chats and 3+ banya pages from repeated test loop
S661 Fix and verify banya two-turn chat scenario (turn 1: describe banya, turn 2: create page with that content) — verified with Playwright plugin, then committed all fixes (May 19 at 12:14 PM)
2844 12:15p 🔄 tool_runner.py: removed debug log lines after verification complete
2845 " ✅ Full set of modified files ready for commit after banya two-turn fix
2846 " ✅ agents package.json dev script: added --env-file .env to uvicorn command
2847 " 🔴 Committed engines fixes: null tool args tolerance + HMAC skew widening (5a43d31)
2848 12:16p 🔴 Committed agents fixes: reliable create-page-from-chat on GigaChat-2 Pro (2b1b766)
2849 " 🟣 Committed e2e specs: banya repro spec added + create-page spec migrated to GigaChat-2-Pro (6b2bb88)
2850 " ✅ Three-commit banya fix series landed on main; working tree clean
2851 12:22p 🔴 Sidebar Pages Section Vertical Stretch Fix
2852 12:23p 🔵 WorkspaceSidebar Architecture: Two Separate Implementations Discovered
2853 " 🔵 PageTreeSection Hard-Capped at 300px maxHeight
2854 12:24p 🔵 FavoritesSection Also Hard-Capped at 200px maxHeight
2855 " 🔴 PageTreeSection Outer Box Converted to Flex Column
2856 12:27p 🔴 PageTreeSection Inner List Box: maxHeight:300 Replaced with Flex-Fill
2857 " 🔴 Flex Spacer Removed from WorkspaceSidebar Between PageTree and Trash
2858 12:28p ✅ Sidebar Stretch Fix Type-Checks Clean
S662 Fix workspace sidebar vertical stretch — page output area not reaching trash section when sidebar is open with many pages (May 19 at 12:29 PM)
2859 1:13p 🔵 AnyNote workspace chat "create page from chat" bug investigation started
2860 " 🔵 Full create-page-from-chat architecture mapped: executor→tool_runner→MCP→confirmation interrupt

Access 811k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
