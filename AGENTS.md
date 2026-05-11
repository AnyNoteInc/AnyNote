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

# [anynote] recent context, 2026-05-11 9:08pm GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (17,209t read) | 1,260,022t work | 99% savings

### May 11, 2026
1495 9:49a 🔄 Notifications fully removed from WorkspaceUserMenu, NotificationsBell imported into workspace-sidebar
1496 9:50a 🟣 NotificationsBell wired into full sidebar user row and mini sidebar (imports added)
1497 " 🟣 NotificationsBell added to mini sidebar above user avatar
1498 " 🟣 Notifications bell iteration 2 passes check-types and lint — changes staged
1499 " 🟣 Iteration 2 Task 9 committed — notifications bell in sidebars, commit ae2171d on feat/sidebar-mini
1500 9:51a 🔵 workspace-shell.tsx current state — SidebarMode only 'mini' | 'full', no hidden state
1501 " 🟣 workspace-shell.tsx updated — SidebarMode gains 'hidden', sidebar column omitted when hidden
1502 10:11a 🔵 feat/sidebar-mini branch has 15 commits ahead of main
1503 10:16a 🟣 feat/sidebar-mini branch pushed to GitHub remote
1504 " 🟣 Pull Request #10 created: sidebar redesign — full/hidden modes, notifications bell, trash + ⌘, shortcuts
1505 10:24a 🔵 PR #10 CI Failure on feat/sidebar-mini
1506 " 🔵 CI Failure Isolated to apps/web Test Suite
1507 10:25a 🔵 Root Cause: Settings Shortcut Changed from ⌘S to ⌘, in useSearchHotkey
1508 " 🔵 Commit d2ebd1c Changed Hotkey But Forgot to Update Tests
1509 " 🔵 Only Remaining 's' Hotkey References Are in the Test File
1510 10:26a 🔴 Fixed Failing Tests: Updated Settings Hotkey from 's' to ',' in search-hotkeys.test.tsx
1511 " 🔴 Fix Verified: All 3 search-hotkeys Tests Now Pass Locally
1512 " 🔴 Full Web Test Suite Passes: 36 Files, 120 Tests All Green
1513 " 🔴 TypeScript Type Check Passes After Fix
1514 " 🔴 Fix Committed and Pushed: test(web): align settings hotkey tests with ⌘,/Alt+, binding
1515 10:42a 🔵 Task List Editor Structure in anynote
1516 " 🔵 PageView Component with Fullscreen Mode and Page Properties Menu
1517 10:53a 🔵 anynote Database Schema: users Table Uses snake_case, user_consents Has Specific Schema
1518 10:54a 🔵 anynote Auth Flow: New Users Redirected to /workspaces/new After Sign-In
1519 " 🔵 Page View UI Structure: Header Buttons and Page Properties Dialog
1520 4:32p 🟣 Reminder Slash Command Feature Specification for TipTap Page Editor
1521 " 🔵 Anynote Editor Package Structure for /reminder Feature Implementation
1522 " 🔵 Existing Notification Infrastructure and Settings Matrix in Anynote
1523 4:33p 🔵 TipTap Inline Node Pattern: PageLink as Template for Reminder Extension
1524 " 🔵 Notification Architecture: EVENT_CATALOG Controls Defaults and Channel Locks
1525 " 🔵 Slash Command Registration Pattern: Handler Injection via SlashMediaHandlers
1526 4:34p 🔵 AnyNoteEditor Popover System: Exact Integration Point for Reminder UI
1527 " 🔵 Notification Emit() API and Outbox Pattern for Reminder Dispatch
1529 " ⚖️ Reminder Feature Architecture Decisions Finalized After Full Codebase Exploration
1528 " 🔵 Editor Package Uses TipTap v3.22.3 with MUI v7 and Hocuspocus Provider
S364 Implement /reminder slash command in AnyNote TipTap editor — spec fully finalized with two additional refinements (May 11 at 5:10 PM)
S365 Implement /reminder slash command in AnyNote TipTap editor — spec finalized with pre-fire validity check added to notification dispatcher (May 11 at 5:11 PM)
S366 Implement /reminder slash command in AnyNote TipTap editor — spec fully finalized and sent to user for review before implementation plan (May 11 at 5:11 PM)
S367 Implement /reminder slash command in AnyNote TipTap editor — spec committed, moving to implementation plan (May 11 at 5:12 PM)
S368 Implement /reminder slash command in AnyNote TipTap editor — spec committed to main, moving to implementation plan (May 11 at 5:13 PM)
S369 Implement /reminder slash command — exploring packages/notifications and packages/trpc structure for implementation planning (May 11 at 5:14 PM)
S370 Implement /reminder slash command — exploring key source files for implementation planning (catalog, emit, resolve-preferences, dispatcher, types, trpc/index) (May 11 at 5:14 PM)
S373 Page Reminders — subagent-driven execution confirmed, environment validated, ready to dispatch Task 1 (May 11 at 5:15 PM)
1530 5:19p ⚖️ Reminder notification payload includes workspaceId field
1531 5:22p 🟣 Page Reminders Implementation Plan Committed
S371 Page Reminders feature — implementation plan written and committed, awaiting execution approach decision (May 11 at 5:22 PM)
S372 Page Reminders feature — implementation plan committed, feature branch created, subagent-driven execution approach selected and being prepared (May 11 at 5:23 PM)
1532 5:24p 🟣 REMINDER_DUE Added to NotificationEventType Enum
1533 " 🟣 User Model Extended with Reminder Relations
1534 5:25p 🟣 Reminder and ReminderRecipient Models Added to Prisma Schema
1535 " 🔵 Task 1 Subagent Did Not Commit — Schema Changes Uncommitted
1536 " 🔴 MUI v9 DateTimePicker Playwright Locator Fix
1537 " 🟣 E2E Spec: /reminder Slash Command Golden Path
1538 " 🟣 feat/page-reminders Branch Complete — 18 Commits
1539 6:23p 🔵 Primary Session Entering Branch-Completion Workflow
1540 " 🔵 Final Implementation: reminders.ts Delivery Logic
1541 " 🔵 Final Implementation: tRPC Reminder Router
1542 " 🔵 Final Implementation: Reminder Chip NodeView
1543 " 🔵 Final Implementation: PageRenderer Reminder Wiring
1544 " 🔵 Prisma Migration: 20260511162530_reminders

Access 1260k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
