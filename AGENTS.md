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

# [anynote] recent context, 2026-05-23 2:14pm GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (18,931t read) | 1,875,063t work | 99% savings

### May 23, 2026
S713 Add LikeC4 as a new diagram type in the anynote monorepo — both as a LIKEC4 collaborative page (Monaco + live preview) and as a ```likec4 code block in the Tiptap editor with Код↔Просмотр toggle defaulting to rendered diagram (May 23 at 5:34 AM)
S714 Observer monitoring feat/mermaid branch — Task 10 LikeC4 code-block E2E fix, committing, and running final quality gates (May 23 at 5:36 AM)
S711 LikeC4 API verification complete — checking plans directory naming convention before writing implementation plan (May 23 at 5:36 AM)
S712 LikeC4 API verification complete — writing implementation plan to docs/superpowers/plans/ (May 23 at 5:36 AM)
S715 Observer monitoring feat/mermaid branch — Task 10 commits complete, pnpm gates run reveals production build still broken by esbuild import chain (May 23 at 10:57 AM)
S717 Observer monitoring feat/mermaid — web production build PASSES with esbuild/bundle-require webpack aliases; full pnpm gates re-run in progress (May 23 at 11:04 AM)
S718 Simplify skill review of completed LikeC4 feature on feat/mermaid branch — reuse, quality, efficiency review cycle and applying the one identified fix (May 23 at 11:05 AM)
S716 Observer monitoring feat/mermaid — production build fix: webpack alias stubs for esbuild + bundle-require in next.config.js, web build running (May 23 at 11:05 AM)
3021 11:55a ⚖️ DiagramConfig extended with optional Preview component for React-based previews
3022 " 🟣 @repo/likec4 package: complete LikeC4 diagram integration for anynote
3023 " 🔵 Direct @mui/material imports in packages are the established convention, not a violation
3026 11:57a 🔄 DiagramConfig Discriminated Union Type Enforcement
3027 " 🟣 LikeC4 Integration — Full Feature Complete on feat/mermaid
3028 " 🔵 @likec4/core ViewId Is a Branded String — `as never` Cast Required
3029 " 🔵 Vectorization Pipeline Handles Non-TEXT Page Types Gracefully
3030 12:28p 🔵 LikeC4 feature scope: 28 files, 635 insertions
3031 " 🟣 Likec4Diagram: browser-side parse/layout/render component with StrictMode-safe generation counter
3032 " 🟣 DiagramBoardInner supports dual preview backends: SVG render fn or React Preview component
3033 " 🟣 Editor code-block bypasses SVG render pipeline for LikeC4, renders Likec4Diagram directly
3034 12:30p 🔵 DiagramPreview uses lastSource dedup safely; Likec4Diagram intentionally omits it
3035 " 🔵 Likec4BoardProps and Likec4User are thin type aliases over DiagramBoardProps/DiagramUser
S719 Fix LikeC4 model page crash on compile error — page should show error chip instead of crashing (May 23 at 12:30 PM)
3036 12:41p 🔵 LikeC4 Model Page Crashes Instead of Showing Compilation Error
3037 " 🔵 LikeC4 Package Source Structure in Anynote Monorepo
3038 12:42p 🔵 LikeC4 Git Context: feat/mermaid Branch with Recent LikeC4 Feature Work
3039 " 🔵 Likec4Diagram Has Async Error Handling But Lacks React Error Boundary
3040 " 🔵 LikeC4 Rendering Chain: Likec4Board → DiagramBoard → Likec4PagePreview
3042 " 🔵 @likec4/language-services v1.57.0 Has Separate browser/ and node/ Dist Directories
3041 " 🔵 DiagramPreview Uses Safe SVG Pattern; Likec4Diagram Uses React Components — Different Error Surfaces
3043 12:43p 🔵 fromSource Wraps Single Source as Named File; Does Not Throw on Parse Errors at API Level
3044 12:44p 🔵 Root Cause Confirmed: fromSource Resolves Successfully Even on Parse Errors; Crash Happens in layoutedModel()
3045 " 🔵 LikeC4.getErrors() Returns Structured Array with message, line, range, sourceFsPath
3046 " 🔵 layoutedModel() Returns Promise&lt;LikeC4Model.Layouted&gt; — Not a Result Type
3047 12:45p 🔵 Reproduction Confirms: Both fromSource and layoutedModel Resolve Successfully on Parse Errors — ReactLikeC4 Gets Broken Model
3048 " 🔵 Existing LikeC4 E2E Test Only Covers Happy Path; No Error Handling Test Exists
3049 " 🔵 No React ErrorBoundary Exists Anywhere in the Codebase
3050 " 🔵 ErrorBoundary Exists Only in Next.js Build Output, Not in Source Code
3051 12:49p 🟣 TDD: Red Tests Written for formatLikec4Errors Helper Function
3052 " 🟣 Implemented formatLikec4Errors in view-utils.ts
3053 " 🔴 Unit Tests Green; formatLikec4Errors Wired into Likec4Diagram Import
3054 " 🔴 Fixed: Likec4Diagram Now Guards Against Invalid Models Before Calling layoutedModel()
3055 12:50p 🟣 E2E Test: INVALID_MODEL Constant Added to Cover Parse Error Regression
3056 " 🟣 E2E Regression Test Added: "shows a compile error for invalid source instead of crashing"
3057 " 🔴 LikeC4 Parse Error Fix Passes TypeScript Type Check and ESLint
3059 " 🔴 Both E2E Tests Pass: LikeC4 Parse Error Now Shows Error Chip Instead of Crashing (Confirmed Live)
3060 " 🔴 LikeC4 Parse Error Bugfix Complete: 4 Files Changed, 66 Insertions
3058 12:51p 🔵 E2E Test Infrastructure Ready: Docker Services Up, Playwright Uses Next.js Dev Server on Port 3100
3061 12:52p ✅ Project Memory Saved: fromSource No-Throw Gotcha Documented for Future Sessions
3062 12:53p ✅ MEMORY.md Index Updated with LikeC4 fromSource No-Throw Entry
3063 12:57p 🔵 Two UI Issues Identified on LikeC4 Page Type
3064 " 🔵 Likec4Diagram JSX: Combobox Location and ReactLikeC4 Width Issue Identified in Source
S720 Fix 2 UI bugs on LikeC4 page: remove view-selector combobox and fix diagram shrinking instead of filling full width — then verify with Playwright e2e tests (May 23 at 12:58 PM)
3065 2:00p ✅ Remove LikeC4 and D2 from TipTap Slash Command Menu and Code Block
3066 " 🔵 LikeC4 and D2 Slash Items and Code Block Language Locations Mapped
3067 " 🔵 E2E Tests Exist for LikeC4 Code Block That Must Be Removed or Updated
3068 2:01p 🟣 TDD Red Tests Written for LikeC4/D2 Removal from Slash Menu and Code Block
3069 " ✅ LikeC4 and D2 Removed from TipTap Slash Menu and Code Block
3070 2:02p ✅ TDD Green: LikeC4/D2 Removal Tests Pass After Implementation
3071 2:08p 🔵 Page Rename Dialog Architecture in AnyNote
3072 " 🔵 EmojiIconButton Component Interface and Icon Picker Integration Pattern

Access 1875k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
