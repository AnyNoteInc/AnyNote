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

# [anynote] recent context, 2026-05-13 2:59pm GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (20,105t read) | 647,461t work | 97% savings

### May 13, 2026
1639 4:39a 🔵 MAX_COLUMNS=3 Constant Enforced in Drop Placement Plugin at Two Points
1641 4:40a 🔵 CSS Column Grid Has Hardcoded Rules Only for 1–3 Columns
1642 " 🔵 Existing E2E Column Tests Use Six-Dot Button to Initiate Drags
1643 4:45a 🔵 Tiptap Drag Handle is Custom Implementation, Not npm Package
1644 " 🔵 Tiptap Drag Handle Package Uses pnpm, Not Symlinked to node_modules Root
1645 4:46a 🔵 Tiptap DragHandle v3.22.3 Uses Rule-Based Scoring System to Select Drag Targets
1646 5:01a 🔵 Prior Tiptap Column Layout Spec Exists from 2026-05-12
1647 " ✅ Design Spec Written: Column Layout Unlimited Columns + Resizable Dividers
1648 " ✅ Spec Refined: Column Divider Decoration Uses data-right-index and Position Walking
1649 5:02a ✅ Spec Doc Staged on feat/tiptap-column-layout Branch, Implementation About to Begin
S418 Observer session monitoring primary session implementing 11-task plan for anynote Tiptap editor: unlimited columns, draggable dividers, hidden controls, Playwright tests, pnpm gates (May 13 at 5:02 AM)
1650 5:04a 🔵 column-layout.schema.test.ts Has Explicit 4-Column Rejection Test That Must Be Inverted
1651 " 🔵 Dissolve Test Already Tests 3-Column Logic; Only 4-Column Case Needs Adding
1652 5:05a 🔵 content.test.ts Has Four Regex Assertions That Will Break After CSS Grid-to-Flex Migration
1653 " 🔵 Prior Tiptap Column Layout Implementation Plan Exists at docs/superpowers/plans/
S420 Fix column layout bugs with taskList/taskItem nodes — drag-to-column fails to create layout, and checkbox splits from text during drag (May 13 at 5:07 AM)
1654 5:52a 🔵 Bug report: column layout breaks with taskList nodes
S421 Fix column layout bugs with taskList/taskItem nodes — drag-to-column fails, divider missing, checkbox splits from text on drag (May 13 at 5:52 AM)
S419 Implement unlimited columns + resizable dividers for anynote Tiptap editor, then fix newly reported bug: column layout broken when dragging taskList/taskItem nodes (May 13 at 5:53 AM)
S422 Fix two bugs when combining task lists with drag-to-column: invalid schema (bare taskItem in column without taskList wrapper) and content duplication when source is nested inside target (May 13 at 7:48 AM)
1655 7:49a 🔵 TaskItemWithCheckbox extension uses ReactNodeViewRenderer with composite DOM structure
1656 " 🔵 TaskItem schema has `defining: true` and content `paragraph+`, nested inside taskList
1657 " 🔵 TaskList is a top-level block (group: 'block list') but taskItem is not — only whole-list drag can create columns
1658 7:50a 🔵 Drag handle defaultRules target taskItem nodes; dragHandler at depth-0 promotes drag to top-level taskList
1659 7:51a 🔵 Drag handle plugin in non-nested mode always targets the top-level block via getOuterDomNode/getOuterNode
1660 " 🔵 page-columns.spec.ts yjsExtensions missing TaskList/TaskItem — seeding task list pages will fail
1662 " 🔵 StarterKit does not include TaskList or TaskItem extensions
1661 " 🔵 Editor registers TaskList + TaskItemWithCheckbox with nested:true; test yjsExtensions missing both
1663 7:52a 🔵 No dev server running on port 3000 or 3100 — Playwright tests not yet started for taskList bug
1664 " 🔵 Root cause confirmed: drop-placement.ts PLACEABLE_TYPES excludes taskList — drops are silently rejected
1665 " 🟣 Repro test added to page-columns.spec.ts for taskList column drag debugging
1666 7:54a 🔵 Repro test fails: taskList input rule '[ ] ' does not trigger reliably in Playwright headless typing
S423 Fix taskItem+column drag bugs (schema-invalid bare taskItem in column, content duplication) — then /simplify the committed changes (May 13 at 7:54 AM)
S424 /simplify review of commit 0c77c82 on feat/tiptap-column-layout — code reuse, quality, and efficiency cleanup of the drop-placement task-item bug fixes (May 13 at 2:16 PM)
S425 Add mandatory marketing newsletter consent checkbox to the "Особое решение" (special solutions) contact section on the main page, matching the registration form pattern (May 13 at 2:16 PM)
1667 2:30p 🔵 TipTap Column Layout Bugs with Task Lists Identified
1668 2:31p 🔵 Column Layout + Task List Bug Root Cause: React NodeView Serialization Gap
1669 2:32p 🔵 Column Layout Architecture: Full System Map of Key Files and CSS
1670 " 🔵 E2E Tests for Task List Column Bugs: First 6 of 13 Tests Passing
1671 2:33p 🟣 TipTap Column Layout with Task Lists: All 13 E2E Tests Pass (13/13)
1672 " 🟣 New E2E Test: Checkbox Preserved When Dragging Task Item Out of Column
1673 " 🔵 New Test Reveals Bug: Dragging Task Item Out of Column Creates 3 Checkboxes Instead of 2
1674 " 🔵 Drag-Handle Source Package Not Found in node_modules; Bug Isolated to Second Drag
1675 2:35p 🔵 Search for "особые решения" section found no matching files
1676 " 🔵 "Особое решение" section located in home-contact component
1677 2:36p 🔵 ContactForm has privacy consent but lacks marketing newsletter checkbox
S427 Add mandatory marketing newsletter consent checkbox to the "Особое решение" contact form on the main page, matching the registration form pattern — COMPLETED (May 13 at 2:36 PM)
1678 2:37p 🟣 Added mandatory marketing consent state and validation to ContactForm
1679 " 🟣 Mandatory marketing newsletter consent checkbox added to ContactForm on main page
1680 " 🟣 Marketing consent checkbox feature passes TypeScript and ESLint checks
S426 Add mandatory marketing newsletter consent checkbox to the "Особое решение" contact form on the main page, matching the registration form pattern (May 13 at 2:38 PM)
1681 2:43p 🔵 Tiptap Column Layout — Editing Bar Visibility Bug Identified
1682 2:44p 🔵 Column Layout Architecture: Divider Widgets vs Drop-Placement Decorations in anynote Editor
1683 " 🟣 New E2E Test: Task Item Drag-Out of Column Preserves Checkbox
1684 2:45p 🟣 E2E Test Added: Column Dividers Positioned Between Every Non-First Column Pair
1685 " 🔵 Column Divider Bug Confirmed: Divider Renders at Wrong DOM Position (Left of First Column)
1686 " 🔴 First Fix Attempt for Column Divider Position: Widget Anchor +1 and CSS left -18px
1687 " 🔴 Column Divider Bug Fixed: Widget Anchor +1 and CSS left -18px Combination Passes E2E Test
1689 " 🔵 Full E2E Suite Reveals Pre-existing or Introduced Regression: Empty Column Not Dissolved After Drag-Out
1688 2:46p 🔴 All Three Divider E2E Tests Pass After Fix: Positioning, Width Redistribution, and Drag Clamp

Access 647k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
