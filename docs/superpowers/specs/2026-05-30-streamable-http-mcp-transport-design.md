# Streamable-HTTP MCP transport + Context7 integration

**Date:** 2026-05-30
**Status:** Approved (design); implementation pending
**Author:** brainstormed with the user

## Problem

AnyNote already ships a "Custom MCP servers" feature (branch `feat/workspace-custom-ai-providers`,
merged `79e0bb8`, 2026-05-28): a `WorkspaceMcpServer` table with encrypted headers, a Settings → MCP
UI with an "Добавить сервер" dialog, a connection-validation step on create
(`validateMcp` → agents `/validation/mcp`), and a runtime path in `apps/agents` that discovers tools
from any configured server and forwards custom headers (incl. `Authorization: Bearer …`) on every call.

That feature supports exactly two MCP transports:

- `HTTP_JSONRPC` — a single stateless JSON-RPC POST (`tools/list` / `tools/call`), no handshake, no session.
- `SSE` — the classic HTTP+SSE transport, opened with an HTTP `GET`.

We want to add **Context7** (`https://mcp.context7.com/mcp`), which provides up-to-date library
documentation as MCP tools (`resolve-library-id`, `query-docs`). Context7 speaks the **modern
Streamable HTTP** transport, which neither existing transport can talk to.

### Evidence (live probes, 2026-05-30)

| Request | Result | Meaning |
| --- | --- | --- |
| `POST` bare `{"method":"tools/list"}` (what `HTTP_JSONRPC` sends) | `400 {"error":{"code":-32000,"message":"Bad Request: No valid session ID provided"}}` | Stateless POST rejected; a session is required. |
| `GET` with `Accept: text/event-stream` (what `SSE` opens) | `405 {"error":{"message":"Server does not support GET requests"}}` | Classic SSE transport not supported. |
| `POST initialize` with `Accept: application/json, text/event-stream` + `Authorization: Bearer …` | `200`, `Content-Type: text/event-stream`, response header `mcp-session-id: <uuid>`, SSE body with `serverInfo {name: "Context7", version: "2.3.0"}` and `capabilities.tools` | Streamable HTTP handshake works; server is stateful and SSE-frames responses. |

Conclusion: Context7 cannot be added with the current transports. We must add a third transport.

**Hosted toolset (verified via the implemented client, 2026-05-30).** The hosted endpoint
`https://mcp.context7.com/mcp` exposes exactly two tools — `resolve-library-id` and `query-docs`
(NOT the older `get-library-docs` name some clients ship). `resolve-library-id` requires both
`query` and `libraryName`; `query-docs` requires `libraryId` and `query`. Gate 2 (below) drove the
real server through the new `STREAMABLE_HTTP` client and got 2176 chars of genuine Next.js App Router
routing docs back, confirming the transport end-to-end without any LLM.

## Approach

Add a third transport value, **`STREAMABLE_HTTP`**, and wire it through the layers that already exist.
This is not a new feature surface — it is one new enum value threaded through the stack, plus one new
client path in the agents service.

The agents service already depends on the `mcp` Python SDK (v1.27.1) and uses
`mcp.client.sse.sse_client` for the SSE path. The same SDK ships
`mcp.client.streamable_http.streamablehttp_client` (verified present at
`mcp/client/streamable_http.py:686`), which performs the entire handshake/session/SSE-framing for us.
Its signature is `streamablehttp_client(url, headers=None, ...)` and it yields a 3-tuple
`(read, write, get_session_id)` — structurally identical to the SSE path's 2-tuple `(read, write)`,
differing only by the extra (ignorable) session-id callback. `headers` is forwarded to the underlying
httpx client, so `Authorization: Bearer …` is sent on `initialize` exactly as Context7 requires.

So the agents-side change is, in effect, a copy of the existing `_open_sse_session` swapping one import
and unpacking three values instead of two.

### Considered alternatives

1. **Add `STREAMABLE_HTTP` transport (chosen).** Native, correct, reuses the shipped SDK client. Small,
   well-bounded change spread across the existing layers. Future MCP servers (most new ones are
   Streamable HTTP) work too.
2. **Proof-of-concept script only.** A standalone script doing the handshake against Context7. Proves the
   server works but adds nothing to the product; rejected because the user wants Context7 usable from chat.
3. **Use Context7 only via the Claude Code session.** Demonstrates Context7 but never touches AnyNote;
   does not satisfy the request ("add to apps/web and test via the LLM").

## Components & changes (7 touch-points)

All are small; (C) is the only non-trivial one.

### A. Prisma enum + migration — `packages/db/prisma/schema.prisma:284`
```prisma
enum McpTransport {
  HTTP_JSONRPC
  SSE
  STREAMABLE_HTTP   // new
}
```
Then `pnpm --filter @repo/db exec prisma migrate dev --name add_streamable_http_transport` and
`prisma generate`.

### B. Agents request schema — `apps/agents/agents/apps/agent/schemas.py:53`
```python
transport: Literal['HTTP_JSONRPC', 'SSE', 'STREAMABLE_HTTP'] = 'HTTP_JSONRPC'
```

### C. Agents MCP client — `apps/agents/agents/apps/agent/repositories/mcp_client.py`
- New module-level `_open_streamable_session(url, headers)` async context manager, mirroring
  `_open_sse_session` (lines 27–34) but using `streamablehttp_client` and unpacking the 3-tuple:
  ```python
  @asynccontextmanager
  async def _open_streamable_session(url, headers):
      from mcp import ClientSession
      from mcp.client.streamable_http import streamablehttp_client
      async with streamablehttp_client(url, headers=headers) as (read, write, _get_session_id):
          async with ClientSession(read, write) as session:
              await session.initialize()
              yield session
  ```
- Refactor the SSE list/call bodies (`_sse_list_tools` / `_sse_call_tool`, lines 191–212) to take a
  session-opener so the streamable path reuses the same list/call logic with no duplication. `_filter`
  and `_inject_workspace` remain shared.
- Branch in `list_tools` / `call_tool` (lines 125–133): `'SSE'` → SSE opener; `'STREAMABLE_HTTP'` →
  streamable opener; else → HTTP JSON-RPC. (`_transport()` default stays `HTTP_JSONRPC`.)

### D. tRPC — `packages/trpc/src/routers/mcp-server.ts:10` and `packages/trpc/src/helpers/agents-validate.ts`
- `transportSchema = z.enum(['HTTP_JSONRPC', 'SSE', 'STREAMABLE_HTTP'])`.
- `validateMcp` input `transport` union: add `'STREAMABLE_HTTP'`.

### E. UI — `apps/web/src/components/workspace/settings/mcp-section.tsx:196`
Add `<MenuItem value="STREAMABLE_HTTP">Streamable HTTP</MenuItem>`. The form's `transport` union widens
to include the new value.

### F. Test-user plan
Creating a custom MCP server requires the `customMcpEnabled` plan feature (`mcp-server.ts:78`), which is
true only on МАКС/Corporate (`seed.ts:131`). The Playwright `signUpAndAuthAs` helper creates a Free user,
so the spec/test must seed a МАКС subscription (or directly grant `customMcpEnabled`) for the test user
via Prisma — the same "set up DB state the UI assumes" pattern the helper already uses for
`emailVerified` and consents.

### G. Tests
- Agents unit test for the streamable path: monkeypatch `_open_streamable_session` (the SSE tests already
  monkeypatch `_open_sse_session`) and assert `list_tools` / `call_tool` route through it for
  `transport='STREAMABLE_HTTP'`.
- tRPC/web: the new enum value type-checks through `transportSchema` and `validateMcp`.

## Verification (Playwright) — three gates

1. **Connection gate (no LLM key needed).** Drive the UI: Settings → MCP → Добавить сервер →
   name `context7`, URL `https://mcp.context7.com/mcp`, transport **Streamable HTTP**, headers
   `{"Authorization":"Bearer ctx7sk-…"}` → Save. Pass = the success alert lists discovered tools
   (`resolve-library-id`, `query-docs`). Exercises transport + validation end-to-end.
2. **Direct tool-call gate (no LLM key needed).** Invoke the agents `tools/call` path for
   `query-docs` against a Next.js library id and assert real documentation text returns. Proves the
   *call* path independent of any LLM.
3. **LLM chat gate (requires a working LLM key — provided by the user).** With a real LLM configured in
   Settings → AI, open a chat and ask *"Найди актуальную документацию по роутингу в Next.js"*. Assert via
   Playwright that the agent invokes the Context7 tool (HitL tool-confirmation card appears, as in the
   2026-05-30 smoke tests) and returns Next.js content. This is the full end-to-end the user asked for.

Gates 1–2 run with no LLM key. Gate 3 is the only step that waits on the user's LLM key.

## Decisions (from brainstorming)

- **Transport:** add `STREAMABLE_HTTP` natively (not a PoC, not Claude-Code-only).
- **Context7 API key:** use the user-provided `ctx7sk-…` key locally; entered only in the UI/runtime,
  never committed to any file. Rotated by the user after testing.
- **Success criterion:** full e2e through chat with a real LLM (gate 3). The user will supply a working
  LLM key (OpenAI or GigaChat) configured in Settings → AI. Code + connection work (gates 1–2) is fully
  testable without it.

## Out of scope

- No changes to the `HTTP_JSONRPC` or `SSE` transports.
- No new MCP servers beyond Context7.
- No change to how headers are encrypted/stored or to the plan-gating model itself (only the test user's
  plan is seeded for the test).

## Risks

- **Streamable session lifecycle.** Each `list_tools` / `call_tool` opens a fresh session (same as the SSE
  path does today). Acceptable; matches existing behaviour. If Context7's per-request handshake latency is
  high, the 30s client timeout still covers it (probe handshake was sub-second).
- **`verify`/`retries` not forwarded by `validateMcp`.** The validation helper forwards `verify` but not
  `retries`; the streamable opener doesn't need either for Context7 (public TLS, fast). Left as-is to
  match the existing SSE/HTTP validation behaviour.
- **LLM availability for gate 3.** No working LLM key exists locally (recorded 2026-05-30). Gate 3 is
  explicitly gated on the user supplying one; gates 1–2 de-risk everything else first.
