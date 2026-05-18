# Create Page From Chat — Design

## Problem

A user is chatting with the AI agent about some topic (e.g. how to fry an egg)
through several turns. At the end, the user writes "Создай страницу из
разговора" / "Make a page from this conversation". The agent should:

1. Summarize the full dialog into structured markdown.
2. Create a new page in the workspace (defaulting to the root) populated with
   that summary as the page body.
3. Return a clickable link to the newly created page in the assistant's final
   message.

Today the `createPage` MCP tool only accepts `title` and creates an empty page —
content has to be supplied through a separate `updatePage` call as a hand-rolled
Tiptap JSON document. That forces two confirmation modals and makes the LLM
construct ProseMirror JSON by hand, which is fragile and burns tokens.

## Goals

- One MCP tool call → one confirmation → one populated page.
- LLM passes summary as plain **markdown**; engines converts to Tiptap JSON.
- Final assistant message contains a working in-app link to the page.
- Round-trip with the existing `MarkdownRenderer` (page → markdown) is lossless
  for the supported subset.
- End-to-end coverage via a new Playwright spec.

## Non-goals

- Markdown features beyond what `MarkdownRenderer` already serializes (tables,
  images, footnotes, task lists, math, etc.). Those can be added later when the
  inverse renderer learns them too.
- A dedicated "summarize" MCP tool. The LLM already has `chat_history` in
  context — calling out to a tool that just echoes the same conversation back
  as text is pure overhead.
- Block-pages, kanban pages, excalidraw pages — only TEXT pages.
- Concurrent yjs awareness: the page is created from the server, so anyone with
  the link will load it via the normal Hocuspocus flow.

## Architecture

```
┌──────────┐  /api/agents/generate (SSE)   ┌────────────────────┐
│ Chat UI  │ ─────────────────────────────▶│ apps/web proxy     │
└──────────┘                               └──────┬─────────────┘
                                                   │
                                                   ▼
                                        ┌─────────────────────────┐
                                        │ apps/agents (LangGraph) │
                                        │   executor → tool_runner│
                                        └──────┬──────────────────┘
                                               │ MCP tools/call
                                               │ name=createPage
                                               │ args={title, markdown,
                                               │       parentId?, ownership}
                                               ▼
                                        ┌─────────────────────────┐
                                        │ apps/engines (NestJS)   │
                                        │  PageTools.createPage   │
                                        │    │                    │
                                        │    ▼                    │
                                        │  MarkdownParser.parse() │
                                        │    │ Tiptap doc         │
                                        │    ▼                    │
                                        │  PageWriter.createPage  │
                                        │    (incl. content)      │
                                        └─────────────────────────┘
                                               │
                                               ▼ { pageId, url }
                              ┌─── LLM final message ───┐
                              │ Готово! [«…»](/workspaces/{ws}/pages/{id})
                              └─────────────────────────┘
```

## Changes by package

### 1. `apps/engines` — markdown→Tiptap parser

**New file** `apps/engines/src/apps/mcp/services/markdown-parser.service.ts`

```ts
@Injectable()
export class MarkdownParser {
  parse(markdown: string): TiptapDoc { … }
}
```

- Uses `marked.lexer(markdown, { gfm: true })` to get a token stream.
- Walks tokens and emits Tiptap nodes mirroring the inverse renderer's vocabulary:
  - `paragraph`, `heading{level}`, `bulletList`/`listItem`, `orderedList`/`listItem`,
    `blockquote`, `codeBlock{language}`, `horizontalRule`, `hardBreak`.
  - Inline marks: `bold`, `italic`, `code`, `link{href}`.
- Any unrecognized block type falls back to a paragraph with its raw text — never
  throws on input shape. Empty input yields `{ type: 'doc', content: [] }`.
- Add `marked` to `apps/engines/package.json` dependencies (was only in
  `@repo/editor` so far). Pin to the same major as the editor uses.

**New unit test** `markdown-parser.service.spec.ts` covering each supported node
type plus a round-trip test: `parser.parse(renderer.render(doc)) ≈ doc` on a
sample doc that uses every block + every mark.

### 2. `apps/engines` — extend `createPage` MCP tool

**Edit** `apps/engines/src/apps/mcp/tools/page.tools.ts`:

```ts
const CreatePageInput = z.object({
  parentId: mcpNullableUuidOptional(),
  title: z.string().min(1).max(255),
  ownership: mcpInput(z.enum(['TEXT', 'SKILL', 'AGENT']).default('TEXT')),
  markdown: z.string().max(50_000).optional(), // ← NEW
})
```

- Description updated to call out the new intent (Russian, intent-first style
  to match neighbors): "Если пользователь просит **создать страницу из
  разговора / чата / диалога**, заранее суммаризируй обсуждение и передай
  результат в `markdown`."
- Tool body: if `markdown` is provided, run it through `MarkdownParser`, pass
  the resulting doc to `PageWriter.createPage` via a new `content` field.
- Response shape changes from `{ pageId }` to `{ pageId, url }` where
  `url = '/workspaces/' + workspaceId + '/pages/' + pageId`. Single source of
  truth for the URL pattern — LLM doesn't reverse-engineer it.

**Edit** `PageWriter.createPage` (same package, page-writer.service.ts):

- Accept optional `content?: unknown` (Tiptap doc JSON).
- When present, set it on `tx.page.create({ data: { ..., content } })` in the
  same transaction as the existing creation + outbox write. No second update,
  no second outbox row.

**Tests** in `page.tools.spec.ts` and `page-writer.service.spec.ts`:
- `createPage` with `markdown` populates `Page.content` (Tiptap doc) and
  returns `{ pageId, url }`.
- `createPage` without `markdown` keeps current behavior (`content === null`).
- Round-trip: re-render the stored content via `MarkdownRenderer` and assert
  the original markdown comes back (subset).

### 3. `apps/agents` — tool registry summary

**Edit** `apps/agents/agents/apps/agent/services/tool_registry.py`:

- `_summary_create_page` already shows the page title in the confirmation modal —
  unchanged. The markdown blob is omitted by `_preview_default`'s 200-char
  truncation, which is fine (we don't want a 4KB modal).
- No new tool entries — `createPage` keeps its `SCOPE_PAGES_WRITE` + `requires_confirmation=True`.

### 4. `apps/web` — nothing functional

- `chat-link-renderer.tsx` already turns `/workspaces/{ws}/pages/{id}` markdown
  links into in-app `<Link>` components. The LLM's reply text "Готово!
  [«Как пожарить яичницу»](/workspaces/.../pages/...)" renders as a clickable
  link out of the box.
- Confirm-modal copy is already driven by `_summary_create_page` from the
  agent side; nothing to change in the web UI.

### 5. Playwright E2E

**New spec** `apps/e2e/agents/create-page-from-chat.spec.ts`:

1. `signUpAndAuthAs(...)` (existing helper, handles consents + verified email).
2. Seed the workspace's AI provider settings programmatically so the chat can
   actually generate (use the same fixture pattern as existing agent E2E
   specs). For the test we point at a fake/mock provider — see "Test infra"
   below.
3. Open `/workspaces/{ws}/chat`.
4. Send 3 turns about frying eggs (deterministic prompts; the mock provider
   replies deterministically so the test doesn't depend on a real LLM).
5. Send "Создай страницу из разговора".
6. Wait for the confirmation modal `data-testid="agent-confirmation-modal"`,
   verify summary text contains "Создать страницу", click Confirm.
7. Wait for the assistant message to settle. Assert it contains an `<a>`/`Link`
   whose `href` matches `/workspaces/<ws>/pages/<id>`.
8. Click the link. Land on the new page. Assert the page title is non-empty
   and the editor body contains at least one heading or paragraph derived from
   the dialog (e.g., "яичниц" substring).
9. Verify directly via Prisma that the page exists with `parentId === null`,
   `type === 'TEXT'`, `content` non-null.

**Test infra**: the test needs a deterministic agent response. Two options:
- (a) Configure the test workspace to use a stub LLM provider that replies with
  a hard-coded plan ("call createPage with title='X' and markdown='Y'"). This
  requires a small mock LLM in `apps/agents` that's enabled by env flag.
- (b) Reuse existing E2E fixtures for the chat happy-path (if there's already
  a stub provider hook — check `apps/agents/agents/apps/agent/llm/` and existing
  Playwright fixtures during plan-writing). Prefer (b) if it exists.

The plan step will resolve which path is feasible; if neither is, fall back to
a Vitest integration test on the MCP tool + a lighter Playwright that only
asserts the UI plumbing using a stubbed SSE response from `/api/agents/generate`.

## Data flow (happy path)

1. Browser POSTs chat message "Создай страницу из разговора" to `/api/agents/generate`.
2. `apps/web` proxies to `apps/agents` POST `/agent/run` with full `chat_history`
   (3 prior turns about eggs + the new user message), JWT, and the workspace's
   MCP server descriptor pointing at engines.
3. LangGraph: planner → executor. LLM sees full history, decides to call
   `anynote__createPage` with arguments `{ title: "Как пожарить яичницу",
   markdown: "## Рецепт\n1. ...\n## Подсказки\n- ...", parentId: null }`.
4. tool_runner sees `requires_confirmation=True`, emits
   `confirmation_required` SSE event with `_summary_create_page(args)` →
   "Создать страницу «Как пожарить яичницу»", interrupts.
5. User clicks Confirm. Frontend POSTs resume to agent. tool_runner executes
   the MCP call.
6. Engines `PageTools.createPage` → `MarkdownParser.parse(markdown)` → Tiptap
   doc → `PageWriter.createPage({ ..., content: doc })`. Returns
   `{ pageId: "uuid", url: "/workspaces/ws-uuid/pages/page-uuid" }`.
7. Tool result flows back through SSE as `tool_result`. Executor re-runs LLM
   with the result; LLM produces the final assistant message:
   `Готово! [«Как пожарить яичницу»](/workspaces/ws-uuid/pages/page-uuid)`.
8. Browser renders the message; `chat-link-renderer.tsx` turns the markdown
   link into a Next.js `<Link>`. Click → page loads via the existing
   PageRenderer + tiptap.

## Error handling

- **Invalid markdown** (e.g. malformed code fence): `MarkdownParser` never
  throws — unrecognized blocks degrade to plain paragraphs. Worst case the
  page is created with verbatim text.
- **Empty markdown**: still creates the page with `content = { type: 'doc',
  content: [] }`. The page just opens empty in the editor — acceptable.
- **Title too long**: existing 255-char Zod cap rejects before write.
- **Markdown too long**: new 50 000-char Zod cap rejects before write. The
  LLM gets a tool error and can retry with a shorter summary.
- **Parent missing / cross-workspace**: existing `ensureParent` guard throws
  `PageNotFoundError` — surfaces back to LLM as a tool error.
- **User denies confirmation**: existing flow — interrupt is cancelled, LLM
  receives a denial result, replies with text explaining nothing was created.

## Backwards compatibility

- The MCP tool's `markdown` parameter is optional. Existing callers that pass
  only `{ title }` continue to work and continue to receive `{ pageId }` plus
  the new `url` field (additive — old code can ignore it).
- `PageWriter.createPage`'s new `content` parameter is optional too. Existing
  callers in engines (only the MCP tool today) keep working.
- No migration. `Page.content` was already nullable JSON in the schema.

## Testing summary

| Layer | Test | What it proves |
| --- | --- | --- |
| Unit | `markdown-parser.service.spec.ts` | Parser covers all supported nodes/marks and is round-trip-safe with the renderer |
| Unit | `page-writer.service.spec.ts` | `createPage` writes `content` when provided, leaves null otherwise |
| Unit | `page.tools.spec.ts` | MCP tool returns `{ pageId, url }`, calls parser + writer, validates Zod cap |
| E2E | `create-page-from-chat.spec.ts` | Full UX: chat → confirm → link → page contents present |

## Open items — resolved

- **`marked` version**: pinned to `^14.1.3` in `apps/engines/package.json` to
  match `packages/editor`.
- **E2E LLM stub**: none built. The new spec
  `apps/e2e/create-page-from-chat.spec.ts` follows the existing pattern from
  `apps/e2e/agent-qa-citations.spec.ts` (`test.skip(!OPENAI_API_KEY)`) so CI
  without LLM keys stays green-by-skip. A future iteration can introduce a
  shared stub provider if flakiness becomes a problem.
