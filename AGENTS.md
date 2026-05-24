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

# [anynote] recent context, 2026-05-24 10:47am GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (19,998t read) | 1,476,501t work | 99% savings

### May 23, 2026
S714 Observer monitoring feat/mermaid branch — Task 10 LikeC4 code-block E2E fix, committing, and running final quality gates (May 23 at 5:36 AM)
S715 Observer monitoring feat/mermaid branch — Task 10 commits complete, pnpm gates run reveals production build still broken by esbuild import chain (May 23 at 10:57 AM)
S717 Observer monitoring feat/mermaid — web production build PASSES with esbuild/bundle-require webpack aliases; full pnpm gates re-run in progress (May 23 at 11:04 AM)
S718 Simplify skill review of completed LikeC4 feature on feat/mermaid branch — reuse, quality, efficiency review cycle and applying the one identified fix (May 23 at 11:05 AM)
S716 Observer monitoring feat/mermaid — production build fix: webpack alias stubs for esbuild + bundle-require in next.config.js, web build running (May 23 at 11:05 AM)
S719 Fix LikeC4 model page crash on compile error — page should show error chip instead of crashing (May 23 at 12:30 PM)
S720 Fix 2 UI bugs on LikeC4 page: remove view-selector combobox and fix diagram shrinking instead of filling full width — then verify with Playwright e2e tests (May 23 at 12:53 PM)
S721 Add DrawIO integration to workspace editor: sidebar canvas submenu (Excalidraw/DrawIO choice) + DrawIO slash block with create/view/edit lifecycle (May 23 at 12:58 PM)
3065 2:00p ✅ Remove LikeC4 and D2 from TipTap Slash Command Menu and Code Block
3066 " 🔵 LikeC4 and D2 Slash Items and Code Block Language Locations Mapped
3068 2:01p 🟣 TDD Red Tests Written for LikeC4/D2 Removal from Slash Menu and Code Block
3069 " ✅ LikeC4 and D2 Removed from TipTap Slash Menu and Code Block
3070 2:02p ✅ TDD Green: LikeC4/D2 Removal Tests Pass After Implementation
3071 2:08p 🔵 Page Rename Dialog Architecture in AnyNote
3072 " 🔵 EmojiIconButton Component Interface and Icon Picker Integration Pattern
3073 2:55p ✅ New floating toolbar UI fix requests queued
3074 8:24p 🔵 FloatingToolbar source analysis: two confirmed UI bugs
3075 " 🔵 packages/editor vitest environment has no DOM/React test setup
3076 " 🟣 TDD red-phase: E2E tests added for link button visibility and font select reactivity
3077 8:25p ✅ Bubble menu test revised to use autolink for link-button visibility assertion
3079 " 🔵 Cache loop: write_stdin to already-closed session 58031 returns stale PID 60464 error
3078 " 🔵 Playwright test failed on startup: stale Next.js dev server on port 3000
3080 8:26p 🔵 TDD red confirmed: both new bubble menu tests fail as expected
3081 8:59p 🔵 Root cause of Tiptap slash command arrow-key selection bug identified
3082 9:00p 🔵 SlashMenuPopover architecture: items are grouped into base/code/media with flat active index
3083 " 🟣 Added Playwright regression test for slash menu keyboard navigation bug
3084 9:01p 🔵 Playwright keyboard-navigation test failed: `.Mui-selected` class not applied on arrow-key nav
3085 " 🔵 New Playwright test failed due to sidebar navigation state, not the slash-menu bug
3086 9:02p ✅ Fixed `createTextPage` helper in editor-slash-media.spec.ts to navigate to Pages section first
3087 " 🔵 `.Mui-selected` class not applied by keyboard arrow navigation in slash menu — test assertion must change
3088 9:04p ✅ New Tiptap editor bug fixes requested: file attachment click and code block auto mode
3089 9:19p 🔵 Code block renders with empty first and last lines
### May 24, 2026
3090 6:10a 🔵 Code block structure investigated for empty-lines bug
3091 6:11a 🔴 TDD RED: failing test written for code block blank first/last lines bug
3092 " 🔵 Blank-lines test passed immediately without any fix — bug is CSS/visual, not DOM
3093 6:12a 🔵 Bounding-box test confirms code block blank-lines bug: 41px top gap measured
3094 " 🔵 CSS padding fix reduces gap from 41px to 33px but does not eliminate blank-line space
3095 6:13a 🔵 ARIA snapshot reveals code block DOM: toolbar + pre sibling in NodeViewWrapper
3096 6:38a ⚖️ DrawIO Integration Planned for Workspace Editor
3097 6:39a 🔵 Anynote Monorepo Package Structure
3098 " 🔵 PageRenderer Routing Architecture for Canvas Page Types
3099 " 🔵 Prisma PageType Enum Does Not Include DRAWIO
3100 " 🔵 Excalidraw Package Structure as Template for DrawIO Package
3101 " 🔵 Workspace Sidebar Component Located for DrawIO Menu Addition
3102 6:40a 🔵 CreatePageMenu in page-tree-section.tsx is Where DRAWIO Canvas Option Needs Adding
3103 " 🔵 Slash Menu Architecture for Adding DrawIO Embed Block
3104 " 🔵 Tiptap Extension Pattern for New Block Nodes (Schema + NodeView)
3105 " 🔵 Diagram Board Package Provides Reusable Split-Pane Code+Preview Pattern
3106 6:41a ⚖️ DrawIO Integration Planned for Workspace Editor
3107 " 🔵 Existing Slash Menu and Sidebar Structure Confirmed
3108 " 🔵 react-drawio DrawIoEmbed Full API Documented
S723 User said "write" — session resumed; primary session re-confirmed spec committed and presented summary to user for approval before writing the implementation plan (May 24 at 6:47 AM)
3109 6:50a 🔵 Spec File Naming Convention and LikeC4 Integration Pattern Confirmed
3110 " ✅ Created feat/drawio Branch
3111 " 🟣 DrawIO Design Spec Written to docs/superpowers/specs/
3112 6:53a ✅ DrawIO Design Spec Committed to feat/drawio (c4925ed)
3113 " 🔵 useDiagramYjs and FileAttachment Node Internals Confirmed for DrawIO Implementation
S722 Add DrawIO integration to workspace editor — spec written, committed to feat/drawio, awaiting user review before writing implementation plan (May 24 at 6:53 AM)
3114 6:59a 🔵 page-renderer.tsx and anynote-editor.tsx Full Structure Confirmed for Implementation
3115 " 🔵 All Remaining Wiring File States Confirmed Before Plan Writing

Access 1477k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
