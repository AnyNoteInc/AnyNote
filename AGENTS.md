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

# [anynote] recent context, 2026-05-07 9:10pm GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (17,364t read) | 827,574t work | 98% savings

### May 7, 2026

S266 Repeated investigation reads — no new findings; primary session still pre-plan (May 7 at 6:45 AM)
S267 Design and document a complete server-side page export system for Anynote Next.js app — spec + 27-task implementation plan (May 7 at 6:52 AM)
S268 Observer session monitoring 27-task TDD implementation of server-side page export for Anynote — all tasks complete, PR opened (May 7 at 7:06 AM)
S269 Merge and deploy: push feat/server-page-export branch and create PR for server-side page export feature (May 7 at 11:15 AM)
S270 Merge and deploy: push feat/server-page-export, create PR #6, verify CI, and squash-merge to main (May 7 at 11:23 AM)
S271 мердж и делай деплой — merge feat/server-page-export PR and deploy AnyNote v1.5.0 to production (May 7 at 11:36 AM)
S272 Add Gotenberg PDF export service to production deployment — compose.yml, env template, deploy workflow, and GitHub secrets (May 7 at 11:58 AM)
S273 Commit Gotenberg deploy integration to main and deploy to production — completed as v1.6.0 (May 7 at 12:05 PM)
S274 Migrate email notifications in @repo/mail from SMTP (nodemailer) to Sendsay API provider with synchronous sends, removing transactional outbox and cron patterns (May 7 at 12:31 PM)
1166 8:00p 🟣 A4 Standard Margin PDF Export — All 5 Vitest Tests Pass
1167 " ⚖️ Email Delivery Migrated from SMTP to Sendsay API
1168 " 🔵 Full Audit of Existing SMTP Mail Architecture Before Sendsay Migration
1169 8:04p 🔵 Sendsay API Package Investigation: No Official TypeScript Types, CJS-Only Distribution
1170 8:05p ⚖️ Email Provider Migration: SMTP → Sendsay API
1171 8:11p 🔵 Sendsay API: `issue.send` method with `users.list` for transactional email
1172 8:20p 🔵 Sendsay API: Authoritative request shape for transactional email via `issue.send`
1173 8:21p 🔵 Current SMTP dependencies in anynote monorepo lockfile
1174 " ⚖️ Email Notification Mechanism Migration: SMTP → Sendsay API
1175 " ✅ Detailed 14-Task Implementation Plan Written for SMTP→SendSay Migration
1176 8:29p 🔵 Git Worktree Directory Pattern for anynote Project
1177 " 🔵 .env.example Already Contains SENDSAY Vars — No SMTP Vars Present
1178 " ✅ Feature Worktree Created for SendSay Migration Branch
1181 8:30p ✅ Migration Worktree Fully Initialized — .env Symlinked, Dependencies Installed
1182 " 🔵 Baseline @repo/mail Tests: dispatch and enqueue Fail Due to Missing Prisma Client in Worktree
1179 8:31p 🔵 Migration Worktree Has No .env File — Subagents Need Symlink or Copy
1180 " 🟣 Multi-Task UI Enhancement Sprint Planned
1183 " 🔵 Anynote Project Structure Mapped for UI Enhancement Tasks
1184 " 🔵 Clean Baseline Established After Prisma Client Generation — 24/24 Tests Pass
1189 " 🔄 Task 1 Complete: packages/mail/package.json Swapped nodemailer for sendsay-api
1201 " 🔴 PDF Export: Zero @page Margin Fixed to 20mm in Print Stylesheet
1185 " 🔵 PDF Export Margin Bug: @page margin Explicitly Set to Zero
1186 " 🔵 Date Slash Command Uses Plain MUI TextField, Not MUI X DatePicker
1187 " 🔵 Task Item View Has No Explicit Vertical Centering CSS
1188 " 🟣 Four Parallel Subagents Dispatched for UI Enhancement Sprint
1193 8:32p ✅ pnpm install Completed — sendsay-api Downloaded, nodemailer Removed from Lockfile
1190 " 🔵 PDF Margin Conflict: Gotenberg API Sets Margins But CSS @page Overrides Them
1191 " 🔵 Theme System Architecture: UiProvider Supports system/light/dark, ThemeSection Has Full Implementation
1192 " 🔵 @repo/ui Missing @mui/x-date-pickers Dependency for MUI X DatePicker
1194 8:33p ✅ Lockfile Verified Clean — sendsay-api@2.4.0 Present, nodemailer Fully Removed
1195 " ✅ Task 1 Committed — Dependency Swap Landed on feat/mail-sendsay-migration
1199 " 🔵 packages/mail Source File Inventory Before sendsay Migration Tasks 2-5
1196 " 🔴 PDF Export Margins Fixed: @page margin: 0 Changed to margin: 20mm
1197 " 🔵 Other Three Agents Still Running — New Test Files Already Created
1200 " ✅ Task 2: sendsay.test.ts Written — TDD Red Phase Started
1198 " 🔴 TipTap Task List Vertical Alignment Fixed: align-items: center + margin-top: 0
S275 SendSay email migration: complete @repo/mail SMTP→SendSay HTTP API migration on feat/mail-sendsay-migration branch (May 7 at 8:35 PM)
1202 8:36p 🟣 MUI X DatePicker Integration via /date Slash Command
1203 " 🔴 Vertical Centering of Task List Control Buttons in Tiptap
1204 " 🔴 PDF Export Page Margin Fix with Playwright Verification
1205 " 🟣 Workspace Sidebar User Profile Menu Redesign
1206 8:40p ✅ Updated E2E tests for /date slash command to expect MUI X DateCalendar picker
1207 " ✅ Refined MUI DateCalendar selector in E2E test for slash /date command
1208 " ✅ E2E test for workspace user menu updated to assert theme switcher and vertical divider
1209 8:41p ✅ E2E test for PDF export now asserts A4 margins of 20mm in @page CSS rule
1210 " 🔵 Playwright test run reveals 2 failures: slash date picker and workspace theme menu not yet implemented
1211 " 🔵 Full Playwright run: 10/12 passed; 2 specific failures with detailed error messages
1212 8:42p 🔵 MUI X DateCalendar selected day uses ARIA `selected` attribute not CSS class; confirm button is "Ок" (Cyrillic)
1213 " 🔴 Fixed workspace welcome heading assertion: page is now in Russian ("Добро пожаловать в AnyNote")
1214 " 🔵 workspace-flow happy path now passes; slash date test fails at insertion step — picker works but date isn't inserted into editor
1215 8:43p 🔵 @mui/x-date-pickers not at standard node_modules path; installed via pnpm virtual store

Access 828k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
