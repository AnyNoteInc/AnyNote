# Playwright Smoke Test of AnyNote Core Flows — 2026-05-30

## Goal

Drive the running AnyNote app through Playwright (MCP browser tools) to manually
exercise three core user journeys and report what works / what breaks:

1. **Create different page types and edit them** (UI sidebar → page renderer).
2. **Create a page via the AI chat** (chat → LLM → `createPage` MCP tool → confirmation).
3. **Delete a page via the AI chat** (chat → LLM → `archivePage` MCP tool → confirmation).

This is exploratory manual testing, not an automated `apps/e2e/*.spec.ts` suite.
No spec files are committed; findings are reported in-conversation.

## Environment & Preconditions

The full stack must run locally:

| Service        | Port | Start command                          |
| -------------- | ---- | -------------------------------------- |
| infra (pg/minio/qdrant/gotenberg) | 5432/9000/6333/3001 | `docker compose up -d` (already up) |
| web (Next.js)  | 3000 | `pnpm --filter web dev`                |
| yjs (Hocuspocus) | 1234 | `pnpm --filter @repo/yjs-server dev`  |
| engines (NestJS MCP) | 8082 | `pnpm --filter engines dev`      |
| agents (FastAPI) | 8080 | `pnpm --filter agents dev`            |

- **Test 1** needs web + yjs (page rendering/editing is collaborative).
- **Tests 2 & 3** additionally need engines (MCP `/mcp`) + agents (LLM loop).

`apps/agents` must start with `--env-file .env` (per memory
`project_agents_local_env_file`) and its `.env` must carry `QDRANT__AUTH__*`
(memory `project_agents_qdrant_auth_env`).

## Account & AI-Provider Setup (reconciling "fresh user" + "existing config")

A fresh user gets a clean slate but **no** AI provider and the `personal` plan
(`chats_enabled=f`). Tests 2 & 3 need both. So after sign-up we graft the
existing working config onto the fresh user via direct Prisma/SQL:

1. **Sign up a fresh user** through the UI; mark `emailVerified=true` and write
   the 5 consent rows directly (mirrors `apps/e2e/helpers/auth.ts`
   `signUpAndAuthAs` + `writeConsentsForUserId`) so the onboarding gate is
   cleared. Capture `userId` and the auto-created `workspaceId`.
2. **Grant a `pro` subscription** — insert one `subscriptions` row
   (`userId`, `planId` = pro, `status='ACTIVE'`, period now…+1mo). Plan resolves
   per-user (`active-subscription.ts`), so this unlocks `chats_enabled` for the
   user's workspace.
3. **Point the fresh workspace's AI settings at the existing seed models** —
   insert a `workspace_ai_settings` row for the new `workspaceId` with
   `default_model_id = 019e1287-0924-…` (GigaChat chat) and
   `embeddings_model_id = 019e1287-0935-…` (GigaChat embeddings), the same
   models every existing workspace uses. These seed providers carry GigaChat
   credentials in plaintext `connection`. Set `allow_destructive=true` so the
   chat may call `archivePage` (test 3).

If the GigaChat credentials are **expired/invalid**, tests 2 & 3 will fail at
the real LLM call. That is an acceptable, reportable outcome — we drive the chat
UI to the point of failure and report the exact provider error rather than
faking a result. (The two workspace-scoped `My OpenAI` providers store their key
in `connection_enc`, which we cannot decrypt without the app key, so they are
not usable as a copy source.)

## Test Flows

### Test 1 — Create & edit page types (UI)

For a representative subset of `PageType` (full set: TEXT, EXCALIDRAW, GENOGRAM,
MERMAID, PLANTUML, LIKEC4, DRAWIO, KANBAN — DATABASE/FORM are not creatable from
the sidebar menu), via the **Страницы** sidebar `+` → `CreatePageMenu`:

- **TEXT** — type a heading + paragraph in the Tiptap editor; verify text persists in-DOM.
- **KANBAN** — add a column + a card.
- **MERMAID** (diagram board) — type valid Mermaid source in the Monaco pane; verify preview renders.
- **EXCALIDRAW** (holst) — draw/place one shape; verify it appears.
- **GENOGRAM** — open it; verify the React Flow canvas mounts (lighter edit).

Editing assertion strategy: assert in-editor/in-DOM state. Do **not** rely on
reload to confirm persistence beyond what yjs round-trips — the local yjs server
IS running here (unlike Playwright's bare `next dev`), so a reload *should*
survive, but we assert live state first to avoid coupling to yjs timing
(memory `feedback_e2e_no_yjs_persistence` is about the E2E harness, which has no
yjs; here we do have one).

Each page is created at root (`parentId: null`). Page titles are edited via the
page header where applicable.

### Test 2 — Create a page via chat

1. Navigate to the workspace `…/chats` (redirects to `…/chats/new`).
2. Type: `Создай страницу "Тест от Playwright" с текстом про список покупок`.
3. The agent should call `createPage`; a **confirmation dialog**
   (`ConfirmationDialog.tsx`) appears. Approve it.
4. Verify the new page appears in the Страницы sidebar and opens with the content.

### Test 3 — Delete a page via chat

1. In the same chat, reference the page created in Test 2.
2. Type: `Удали страницу "Тест от Playwright"`.
3. The agent should call `archivePage` (delete == archive); approve the
   confirmation.
4. Verify the page disappears from the sidebar (it is archived, not hard-deleted —
   verify via sidebar absence; optionally confirm `archived_at` set in DB).

## How tests are driven

Playwright MCP browser tools (`browser_navigate`, `browser_snapshot`,
`browser_click`, `browser_type`, `browser_wait_for`, `browser_evaluate`,
`browser_take_screenshot`). Prefer `browser_snapshot` (accessibility tree) for
locating elements over screenshots. For widget-overlay click issues use
`el.evaluate(e => e.click())` (memory `feedback_playwright_click_under_widget_overlay`).

## Out of Scope

- No committed Playwright spec files / CI wiring.
- No new app features or bug fixes (if a flow breaks, report it; fix only if trivial and you ask first).
- DATABASE / FORM page types (not creatable from the sidebar menu).
- Real S3 image round-trips for Excalidraw beyond "shape appears".

## Risks / Known Pitfalls

- **GigaChat creds may be dead** → tests 2 & 3 stop at LLM call (reported, not faked).
- **Cold Next compile** → first navigation to heavy routes may be slow; wait generously (memory `feedback_e2e_cold_compile_retries`).
- **Diagram packages dynamic-import (`ssr:false`)** → wait for client mount before asserting.
- **Server start ordering** → engines/agents must be up before chat tests; start all four dev servers and health-check before Test 2.
