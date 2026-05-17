# AnyNote Agent OS — v1 (Infra-first) Design

**Status:** draft, ready for plan
**Date:** 2026-05-17
**Author:** Victor (Claude)
**Scope:** apps/agents, apps/web, apps/engines, packages/db, packages/trpc, packages/auth, apps/e2e

## 1. Context

### 1.1 What we have today (verified against repo at HEAD = e3c800b)

**apps/agents** — minimal LangGraph 1.1.8 service:
- Single graph `START → prepare_prompt → llm → (tools? → llm)* → END` in
  `apps/agents/agents/apps/chat/services/graph.py`.
- One Jinja system prompt in `apps/agents/agents/apps/chat/templates/system_prompt.j2`,
  one user prompt in `user_prompt.j2`.
- MCP client is a custom `httpx`-based JSON-RPC client in
  `apps/agents/agents/apps/chat/repositories/mcp_tools.py` — HTTP only, no SSE/stdio.
- LLM providers: OpenAI, Ollama, GigaChat via `ModelFactoryRepository`. Per-request
  `model.connection.api_key` — no server-side storage.
- Postgres checkpointer via `AsyncPostgresSaver` connected to `AGENTS_DATABASE_URL`,
  but the only persistence is graph state — there is no application-level memory or
  audit trail.
- HTTP API: `POST /chat/generate` (SSE), `POST /vectorization`,
  `DELETE /vectorization/pages/{id}`, `DELETE /vectorization/workspaces/{id}`,
  healthcheck.
- Auth: `X-User-Id` + `X-Workspace-Id` headers (`UserContextSchema`), no JWT, no
  signature verification — caller can impersonate anyone.

**apps/engines MCP** (`apps/engines/src/apps/mcp/`) — 15 tools across three modules:
- `workspace.tools.ts`: `getWorkspaceStats`, `listWorkspaceFiles`, `listSkills`,
  `listAgents`, `createPageFromFile`.
- `page.tools.ts`: `createPage`, `updatePage`, `movePage`, `getPageMarkdown`,
  `getPageStats`.
- `page-file.tools.ts`: `uploadFileToPage`, `uploadImageToPage`, `attachFileToPage`,
  `attachImageToPage`, `listPageFiles`.
- Auth via `WorkspaceMemberGuard` reading `X-User-Id` + `X-Workspace-Id`.

**packages/trpc** — 13 routers (workspace, page, file, reminder, notification, chat,
search, ai-settings, kanban/\*, auth, user, subscription, integration). The
`chat`/`ChatMessage` models in Prisma are already streaming-friendly
(`status: STREAMING|DONE|ERROR`, `parts: Json`, `sources: Json`).

**Prisma:** `WorkspaceAiSettings { defaultModelId, embeddingsModelId, systemPrompt,
temperature, topP }` exists. No table for per-workspace MCP servers, secrets, or
long-term memory.

**Auth in repo:** better-auth with the `jwt` plugin (already wired for `apps/yjs`
via `BETTER_AUTH_JWT_AUDIENCE`). JWKS endpoint at `/api/auth/jwks`. The agents
service does not currently consume this.

### 1.2 What we are inspired by

**openclaw** (`/Users/victor/Research/agents/openclaw`):
- Auth profile rotation with cooldown on rate-limit/auth errors.
- Compaction strategy: summarize old turns via LLM and retry with compacted state
  instead of brute truncation.
- Tool availability conditions evaluated at runtime.
- Multi-agent workspace isolation via id-based routing.
- Stream-first event protocol (deltas, tool_calls, delivery, lifecycle).
- Anti-patterns: 979-LOC monolithic run loop, prompt construction scattered across
  15+ files, retry logic duplicated everywhere.

**claudecode** (`/Users/victor/Research/agents/claudecode`):
- ReAct + Plan-Execute hybrid built as an async generator yielding events.
- Polymorphic typed `Tool` interface with per-tool `checkPermissions`.
- 3-level memory: in-session messages, file-based MEMORY.md, LLM-summarized compact
  boundaries.
- Prompt caching split between static and dynamic sections.
- MCP servers as a first-class config category with multiple transports.
- Hooks system for declarative pre/post tool policy.
- Anti-patterns: 1000+ LOC QueryEngine, synchronous compaction blocks the loop,
  string-based prompt assembly.

### 1.3 What we want to deliver (v1)

A multi-tenant cloud SaaS agent inside AnyNote that can serve as the foundation
for 12 product scenarios (Q&A with citations, page authoring, kanban planning,
reminder management, executive summaries, file helper, transcript parsing,
duplicate detection, exports, page-agents, etc.). **v1 ships infra and one
end-to-end scenario; remaining 11 scenarios are subsequent small iterations,
each adding tools and prompts on top of the v1 substrate.**

## 2. Goals and non-goals

**Goals (v1):**
1. Plan-Execute-Critic graph that supports multi-step reasoning with a visible
   plan in the UI.
2. Per-workspace LLM configuration with API keys encrypted at rest in the main
   Postgres.
3. Per-workspace MCP server registry (default engines MCP always on, plus
   user-supplied HTTP + SSE servers) with per-tool allowlist and confirmation
   policy.
4. Three-layer memory: chat session (existing `ChatMessage`) + RAG (existing
   Qdrant per-workspace) + new long-term `WorkspaceAgentMemory`.
5. Short-lived JWT auth between web and agents with scope-based tool gating.
6. Destructive operations pause via LangGraph `interrupt()` and resume via a
   second HTTP call; UI shows a confirmation dialog.
7. Extended SSE event protocol that lets the UI render plan steps, tool status,
   citations, confirmations, critic verdicts, and usage.
8. One end-to-end scenario: "Q&A over workspace pages with citations" working
   through a Playwright spec.
9. Test pyramid: unit (mocked LLM) + integration (real Postgres checkpointer,
   mock MCP server, vcrpy LLM replay) + one Playwright golden path.

**Non-goals (v1, deferred to v2+):**
- Page-agents (`ownership=AGENT`) — defer.
- Adaptive thinking budget, per-role model selection (planner=mini etc.) — defer.
- LLM-driven compaction — v1 uses simple truncation (first 5 + last 15).
- Cross-workspace user-global memory (4th layer) — defer.
- Auto-extraction of facts into long-term memory without explicit `save_memory`
  call — defer.
- Bulk confirmation, persistent per-tool allowlists, counter-proposals — defer.
- stdio MCP transport — never (cloud SaaS constraint).
- Parallel plan-step execution — defer.
- OAuth flows for MCP servers — defer; v1 uses static headers only.
- Performance/load testing, observability stack (OpenTelemetry, etc.) — defer.

## 3. Decision matrix (recap from brainstorm)

| Decision | Choice | Why |
|---|---|---|
| Scope of v1 | Infra-first + 1 etalon scenario | 12 scenarios decompose into post-infra iterations |
| Graph pattern | Plan-Execute-Critic | Visible plan, structured revision, less LLM-prompt complexity than supervisor-workers |
| Memory layers | 3-layer (session + RAG + long-term) | Long-term needed for persona/preferences; cross-org user memory premature |
| Secret storage | Encrypted in main Postgres | Avoids extra infra; web stays single source of truth |
| Service auth | Short-lived JWT (better-auth jwt plugin) | Reuses existing yjs pattern; per-request audience |
| Destructive ops | SSE `confirmation_required` + LangGraph `interrupt()` resume | Safer than auto-allow + audit; uses native LangGraph primitive |
| Etalon scenario | Q&A with citations | Exercises RAG + tools + streaming end-to-end |
| MCP transports | HTTP JSON-RPC + SSE (streamable HTTP) | Standard remote MCP; no stdio in cloud |
| Model strategy | 1 model for everything | Cheaper to debug; per-role split is a v2 cost optimization |
| Page-agents | Defer to v2 | Outside infra scope |
| Code organization | Extend `apps/agents` (option A) | Minimal migration; agents stays single deployable |

## 4. Architecture and data flow

### 4.1 Services

| Service | Role in v1 |
|---|---|
| `apps/web` | Issues short-lived JWT; resolves per-workspace AI settings + MCP servers (decrypts secrets); proxies SSE between browser and agents; persists `ChatMessage` rows; renders chat, plan, confirmation dialogs |
| `apps/agents` | New Plan-Execute-Critic graph; MCP client (HTTP+SSE); JWT verification via JWKS; LangGraph checkpointer (pause/resume); RAG retrieval (unchanged); vectorization (unchanged) |
| `apps/engines` | Existing MCP server (15 tools) — gets a new HMAC-based auth header `Authorization: Bearer <agents-internal-token>` replacing today's `X-User-Id`/`X-Workspace-Id`; cron workers unchanged |
| `apps/yjs` | Unchanged in v1 |

### 4.2 Storage

| Store | Purpose | Changes |
|---|---|---|
| main Postgres | `ChatMessage` (history), `WorkspaceAiSettings`, new `WorkspaceMcpServer`, new `WorkspaceAgentMemory`, new `AgentActionLog` | Schema migrations |
| agents Postgres (`AGENTS_DATABASE_URL`) | LangGraph checkpoints only | No new tables |
| Qdrant | RAG per-workspace collections | Unchanged |

### 4.3 Per-turn data flow

```
[UI] POST /api/agent/generate { chatId, messageText }
   |
   v
[apps/web /api/agent/generate]
   - verifySession → userId
   - assertWorkspaceMember(workspaceId derived from chatId)
   - loadAiSettings + decrypt(model.connection.api_key)
   - loadMcpServers (default engines + WorkspaceMcpServer where enabled=true)
     and decrypt their headers
   - loadRecentMessages from ChatMessage (last N=20) → ConversationMessageSchema[]
   - loadLongTermMemories via lexical search on user_message → top 5
   - signAgentsJwt({sub: userId, aud: "agents", wsid, scopes, cid: chatId}, ttl=300s)
   - POST agents:/agent/run (SSE proxy) with payload
   |
   v
[apps/agents /agent/run]
   - verify_agents_jwt → AgentContext { user_id, workspace_id, scopes, chat_id }
   - load checkpoint by thread_id=chatId (resume if interrupted) or fresh state
   - run graph; stream SSE: router_decision | plan_step | step_started |
     tool_status | token | citation | confirmation_required |
     memory_write_proposed | critic_verdict | usage | done | error
   |
   v
[apps/web] proxies SSE to browser; on `done`:
   - insert ChatMessage(role=ASSISTANT, status=DONE,
     parts=[{type:'text', text}, {type:'tool_call', ...}, ...],
     sources=[{pageId, blockNumber, title, ...}])
   - on `confirmation_required`: hold UI dialog; on Allow/Deny call
     POST /api/agent/resume
```

### 4.4 Pause/resume flow

```
[UI confirmation dialog] click Allow|Deny
   |
   v
[POST /api/agent/resume] { chatId, confirmationId, action }
   - verifySession, assertMember
   - signAgentsJwt(...)
   - POST agents:/agent/resume { chat_id, confirmation_id, action }
        |
        v
   - verify_jwt, load checkpoint by thread_id=chatId
   - assert pending interrupt.id == confirmation_id
   - graph.ainvoke(Command(resume={"action": action}), config={thread_id: chatId})
   - SSE proxy continues
```

## 5. Database schema (main Postgres, Prisma)

All changes in `packages/db/prisma/schema.prisma` with one Alembic-style migration
`<n>_agent_os_v1.sql` covering all five table changes.

### 5.1 Extend `WorkspaceAiSettings`

```prisma
model WorkspaceAiSettings {
  // existing fields kept
  workspaceId            String  @id
  defaultModelId         String
  embeddingsModelId      String?
  systemPrompt           String?
  temperature            Float?
  topP                   Float?

  // NEW
  chatModelConnection      Json?   // {ciphertext, iv, tag} — AES-256-GCM
  embeddingModelConnection Json?   // {ciphertext, iv, tag}
  agentSystemPrompt        String? // persona override at workspace level
  allowDestructive         Boolean @default(false) // opt-in to skip confirmations

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
}
```

Decrypted `chatModelConnection` payload shape:
`{ apiKey?: string, baseUrl?: string, organization?: string, clientId?: string,
clientSecret?: string, scope?: string }` — same shape as
`agents/apps/processing/schemas.py:ModelConnectionSchema`.

### 5.2 New `WorkspaceMcpServer`

```prisma
enum McpTransport {
  HTTP_JSONRPC
  SSE
}

model WorkspaceMcpServer {
  id              String       @id @default(uuid())
  workspaceId     String
  name            String       // user-facing label, e.g. "Notion"
  description     String?
  url             String
  transport       McpTransport @default(HTTP_JSONRPC)
  headers         Json         // {ciphertext, iv, tag}; decrypted = Record<string, string>
  toolsAllowlist  String[]     // empty array = all tools allowed
  enabled         Boolean      @default(true)
  verifyTls       Boolean      @default(true)
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  createdById     String

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, name])
  @@index([workspaceId, enabled])
}
```

Per-tool `requiresConfirmation` is **not** stored here in v1 — it is derived at
runtime: default engines tools have a hard-coded list in `apps/agents`; for
user-supplied servers everything destructive defaults to requiring confirmation
unless the workspace has `allowDestructive=true`. Per-tool override moves to v1.1.

### 5.3 New `WorkspaceAgentMemory`

```prisma
enum AgentMemoryScope {
  WORKSPACE  // visible to all members
  USER       // only this user (workspace-scoped)
}

enum AgentMemorySource {
  USER
  AGENT
}

model WorkspaceAgentMemory {
  id          String             @id @default(uuid())
  workspaceId String
  scope       AgentMemoryScope
  userId      String?            // null for scope=WORKSPACE
  key         String             // canonical slug, e.g. "user-prefers-russian-replies"
  content     String             // markdown, soft limit 2000 chars
  source      AgentMemorySource
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, scope, userId, key])
  @@index([workspaceId, scope])
}
```

### 5.4 New `AgentActionLog`

```prisma
enum AgentActionStatus {
  OK
  ERROR
  DENIED
}

model AgentActionLog {
  id            String            @id @default(uuid())
  chatId        String?
  messageId     String?
  workspaceId   String
  userId        String
  toolName      String            // namespaced: "anynote__createPage"
  toolInput     Json
  toolOutput    Json?
  status        AgentActionStatus
  durationMs    Int
  errorMessage  String?
  createdAt     DateTime          @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, createdAt])
  @@index([chatId, createdAt])
}
```

### 5.5 Secret encryption (new package utility)

New file `packages/auth/src/secret-encryption.ts`:

```ts
type EncryptedPayload = { iv: string; ciphertext: string; tag: string } // all base64

export function encryptSecret(plaintext: string): EncryptedPayload
export function decryptSecret(payload: EncryptedPayload): string
```

- AES-256-GCM via Node `crypto`.
- Master key from `SECRETS_ENCRYPTION_KEY` env (32 random bytes, base64).
- Add to `.env.example`, `turbo.json` `globalEnv`, and document rotation procedure
  in a follow-up runbook (not in v1 scope).
- On decryption failure (tampered ciphertext, wrong key) throw — never silently
  return empty string.

## 6. Auth between web and agents

### 6.1 JWT issuance in apps/web

New file `apps/web/src/lib/agents-token.ts`:

```ts
export type AgentsScope =
  | "pages:read" | "pages:write" | "pages:delete"
  | "files:read" | "files:write"
  | "kanban:read" | "kanban:write"
  | "reminders:read" | "reminders:write"
  | "notifications:read"
  | "memory:read" | "memory:write"
  | "search:query"

export async function signAgentsJwt(args: {
  userId: string
  workspaceId: string
  chatId: string
  role: WorkspaceRole  // owner | member | viewer
}): Promise<string>
```

- Audience: `BETTER_AUTH_JWT_AGENTS_AUDIENCE` env (default `"agents"`).
- TTL: 300 seconds.
- Claims: `sub, aud, exp, iat, wsid, cid, scopes[]`.
- Scopes computed from role:
  - `owner` — all scopes.
  - `member` — all except `pages:delete`.
  - `viewer` — only `:read` and `search:query` and `memory:read`.

### 6.2 JWT verification in apps/agents

New file `apps/agents/agents/apps/agent/depends.py`:

```python
@inject
async def verify_agents_jwt(
    authorization: Annotated[str, Header()],
    jwks_repository: FromDishka[JwksRepository],
) -> AgentContext: ...
```

- `JwksRepository` fetches `apps/web /api/auth/jwks` and caches via
  `cachetools.TTLCache(maxsize=4, ttl=600)`.
- Verifies signature (PyJWT), `aud=="agents"`, `exp > now`.
- Returns `AgentContext { user_id, workspace_id, scopes, chat_id }`.

New dependencies in `apps/agents/pyproject.toml`:
```
pyjwt[crypto]>=2.9
cachetools>=5.5
```

### 6.3 Scope enforcement in tools

Each registered tool carries a `required_scope` attribute. Executor sub-loop
checks before invocation:

```python
if tool.required_scope and tool.required_scope not in state.context.scopes:
    return ToolMessage(
        content=f"Permission denied: tool {tool.name} requires scope "
                f"{tool.required_scope}",
        tool_call_id=call.id,
    )
```

The model sees the denial as a normal tool failure and decides what to do
(usually: explain the limitation to the user). No exception bubbles to web.

### 6.4 Default engines MCP auth

Engines guard switches from `X-User-Id`/`X-Workspace-Id` headers to a shared
HMAC token:

- New env `AGENTS_TO_ENGINES_SECRET` (32-byte base64, shared between apps/agents
  and apps/engines).
- agents signs `HMAC-SHA256(secret, userId || ":" || workspaceId || ":" || timestamp)`
  and sends `Authorization: Bearer <token>; X-Agents-User: <userId>;
  X-Agents-Workspace: <workspaceId>; X-Agents-Timestamp: <ts>`.
- engines verifies HMAC and rejects if `|now - timestamp| > 60s`.

Replaces today's trust-the-caller header model with a verifiable one.

## 7. The graph (Plan-Execute-Critic)

### 7.1 New module layout

```
apps/agents/agents/apps/agent/
├── __init__.py
├── depends.py                     # Dishka providers, verify_agents_jwt
├── enums.py                       # PlanStepStatus, CriticVerdict, etc.
├── errors.py
├── router.py                      # POST /agent/run, POST /agent/resume
├── schemas.py                     # AgentState, ServerEvent (extended), AgentContext, ...
├── utils.py                       # serialize_server_event, etc.
├── repositories/
│   ├── __init__.py
│   ├── jinja_renderer.py
│   ├── jwks.py                    # JWKS cache + signature verify
│   ├── mcp_client.py              # HTTP + SSE via official `mcp` SDK
│   ├── model_factory.py           # reused from chat/, kept here
│   └── action_log.py              # writes AgentActionLog rows
├── services/
│   ├── __init__.py
│   ├── graph.py                   # builds Plan-Execute-Critic StateGraph
│   ├── nodes/
│   │   ├── router.py
│   │   ├── planner.py
│   │   ├── executor.py
│   │   ├── critic.py
│   │   └── memory_writer.py
│   ├── rag_retrieval.py           # reused from chat/
│   └── tool_registry.py           # required_scope, requires_confirmation map
├── use_cases/
│   ├── __init__.py
│   ├── run_agent.py               # /agent/run handler logic
│   └── resume_agent.py            # /agent/resume handler logic
└── templates/
    ├── router.j2
    ├── planner.j2
    ├── executor.j2
    └── critic.j2
```

The existing `agents/apps/chat/` module stays in place for one release with
`/chat/generate` returning **HTTP 308 + Deprecation header** pointing at
`/agent/run`. After the transition release it can be deleted.

### 7.2 State schema

```python
class PlanStep(BaseModel):
    id: str          # "1", "2", ... or uuid
    title: str
    status: PlanStepStatus  # PENDING | RUNNING | DONE | FAILED | SKIPPED
    result_summary: str | None = None

class MemoryWrite(BaseModel):
    scope: AgentMemoryScope
    key: str
    content: str

class Citation(BaseModel):
    page_id: UUID
    workspace_id: UUID
    block_number: int
    title: str
    quote: str | None = None

class AgentState(BaseModel):
    # input
    context: AgentContext
    user_message: str
    chat_history: list[ConversationMessageSchema]
    model_config: ModelConfigSchema
    embedding_config: EmbeddingProviderConfigSchema | None
    mcp_servers: list[McpServerSchema]
    agent_system_prompt: str | None
    long_term_memories: list[MemoryItem]
    rag_documents: list[RagDocumentSchema]

    # planning
    routing_kind: Literal["trivial", "complex"] = "complex"
    plan: list[PlanStep] = []
    current_step_id: str | None = None

    # execution
    messages: list[BaseMessage] = []
    tool_calls_made: int = 0
    last_critic_feedback: str | None = None
    revision_count: int = 0
    pending_memory_writes: list[MemoryWrite] = []
    pending_confirmations: dict[str, dict] = {}  # confirmation_id -> {tool, args}

    # output
    final_answer: str = ""
    citations: list[Citation] = []
```

### 7.3 Graph definition

```python
def make_graph(state: AgentState, checkpointer) -> CompiledGraph:
    g = StateGraph(AgentState)
    g.add_node("router", route_node)
    g.add_node("planner", planner_node)
    g.add_node("executor", executor_node)   # internally a ReAct sub-loop
    g.add_node("critic", critic_node)
    g.add_node("memory_writer", memory_writer_node)

    g.add_edge(START, "router")
    g.add_conditional_edges("router", route_after_router, {
        "planner": "planner",
        "executor": "executor",  # trivial → skip planner
    })
    g.add_edge("planner", "executor")
    g.add_conditional_edges("executor", route_after_executor, {
        "critic": "critic",
        "executor": "executor",  # next plan step
    })
    g.add_conditional_edges("critic", route_after_critic, {
        "planner": "planner",     # revise (revision_count++)
        "memory_writer": "memory_writer",
    })
    g.add_edge("memory_writer", END)

    return g.compile(checkpointer=checkpointer)
```

Hard caps enforced in routers: `revision_count <= 2`, `tool_calls_made <= 25`.

All four LLM-using nodes (router, planner, executor, critic) use the same
`state.model_config` resolved once from `WorkspaceAiSettings`. Per-role model
selection (cheap planner / smart executor / cheap critic) is deferred to v2.

### 7.4 Prompts (full text)

#### `router.j2`
```
You classify the user message into one category for routing.

Conversation history (last few turns):
{% for msg in chat_history %}
{{ msg.role }}: {{ msg.content }}
{% endfor %}

Current user message:
{{ user_message }}

Categories:
- "trivial": pure factual lookup that needs at most one tool call.
  Examples: "What is the URL of page X?", "Who created this page?",
  "When is the next sprint?"
- "complex": multi-step task or anything requiring synthesis, planning,
  multiple tool calls, or judgment.
  Examples: "Summarize all client meetings", "Refactor my project structure",
  "Create kanban tasks from this transcript", "Find duplicate pages".

Return JSON only:
{"kind": "trivial" | "complex", "reason": "<one short sentence>"}
```

#### `planner.j2`
```
You are the planning brain of an assistant that helps users work with their
notes inside a workspace called AnyNote. {% if agent_system_prompt %}

Additional workspace instructions:
{{ agent_system_prompt }}
{% endif %}

You will be given:
- the user's current request
- recent conversation history
- the list of MCP tools available (with descriptions)
- relevant facts from long-term memory
- relevant page excerpts from RAG search (if any)
{% if last_critic_feedback %}
- feedback from a previous critic verdict — incorporate it
{% endif %}

Produce a SHORT plan (1–6 steps). Each step must be:
- concretely actionable by the executor in one or a few tool calls
- written so a user reading the plan understands what will happen
- ordered: prerequisites first

Do NOT execute anything. Do NOT call tools. Just output the plan.

If the user's request is unclear, output a single step:
{"id": "1", "title": "Ask the user a clarifying question: <question>"}

Output JSON only:
{"plan": [{"id": "1", "title": "..."}, ...]}

## Conversation history
{% for msg in chat_history %}
{{ msg.role }}: {{ msg.content }}
{% endfor %}

## Long-term memory
{% if long_term_memories %}
{% for m in long_term_memories %}
- [{{ m.key }}] {{ m.content }}
{% endfor %}
{% else %}
(no relevant facts recorded)
{% endif %}

## Available tools
{% for srv in mcp_servers %}
### {{ srv.name }}
{% for t in srv.tools %}
- {{ srv.name }}__{{ t.name }}: {{ t.description }}
{% endfor %}
{% endfor %}

## Relevant page excerpts (RAG)
{% if rag_documents %}
{% for d in rag_documents %}
### {{ d.title }} (pageId={{ d.page_id }}, block={{ d.block_number }})
{{ d.content }}
{% endfor %}
{% else %}
(no excerpts retrieved)
{% endif %}

## Current user request
{{ user_message }}
{% if last_critic_feedback %}

## Critic feedback to address
{{ last_critic_feedback }}
{% endif %}
```

#### `executor.j2`
```
You are the execution engine. You are working on plan step {{ current_step.id }}:
"{{ current_step.title }}"

Use the tools to accomplish this step. When the step is done, respond with
plain text only (no tool calls). If you discover the step is impossible or
wrong, say so in plain text — the critic will decide what to do next.

Rules:
- Prefer reading before writing. Always read the full page before rewriting.
- For destructive operations (delete, mass-update), the tool layer will pause
  and ask the user for confirmation. You do not need to ask first.
- Cite sources for any factual claim about workspace content using this exact
  markdown format:
    [{title}](/workspaces/{workspaceId}/pages/{pageId}#{blockNumber})
  Use only pageIds, blockNumbers, and titles from tool results. Do not invent.
- Output language and format follow the user's request; default to Russian
  markdown unless asked otherwise.

Plan (so you know context):
{% for step in plan %}
{{ step.id }}. [{{ step.status }}] {{ step.title }}
{% endfor %}

Long-term memory facts that may help:
{% for m in long_term_memories %}
- [{{ m.key }}] {{ m.content }}
{% endfor %}
```

#### `critic.j2`
```
You are reviewing the assistant's draft answer before it goes to the user.

User's original request:
{{ user_message }}

The plan executed:
{% for step in plan %}
{{ step.id }}. [{{ step.status }}] {{ step.title }}{% if step.result_summary %}
   → {{ step.result_summary }}{% endif %}
{% endfor %}

Draft answer:
{{ draft_answer }}

Check:
1. Does the draft actually address the user's original request?
2. Are all factual claims about workspace content backed by citations from the
   executor's tool results? Flag any unsupported claim.
3. Is the answer in the right format and language?
4. Did the executor skip a plan step or fabricate tool results?

Return JSON only:
{
  "verdict": "approve" | "revise" | "reject",
  "feedback": "<one paragraph explaining why>",
  "revised_plan": [...] | null
}

- approve: ship the draft as-is.
- revise: re-plan and re-execute; provide a revised_plan that fixes the gaps.
- reject: the task is unrecoverable; the feedback is shown to the user as the
  final response.

Constraints:
- You may approve a draft with minor stylistic issues; revise only for missing
  evidence, wrong content, or skipped requirements.
- Revision count so far: {{ revision_count }} / 2.
  At 2 you may only approve or reject.
```

### 7.5 Compaction (v1: simple truncation)

Helper in `agent/services/history_compactor.py`:

```python
def trim_chat_history(history: list[ConversationMessageSchema], max_messages: int = 30
                     ) -> list[ConversationMessageSchema]:
    if len(history) <= max_messages:
        return history
    head = history[:5]
    tail = history[-15:]
    placeholder = ConversationMessageSchema(
        role=RoleEnum.USER,
        content="[earlier messages omitted for length]",
    )
    return [*head, placeholder, *tail]
```

LLM-summarized compaction is v2.

## 8. MCP integration

### 8.1 Server list per turn

Built by `apps/web` before calling `/agent/run`:

```ts
const defaultServer: McpServerSchema = {
  name: "anynote",
  description: "AnyNote engines MCP — workspace, page, and file tools.",
  url: env.ENGINES_MCP_URL,
  transport: "HTTP_JSONRPC",
  headers: signEnginesAuthHeaders(userId, workspaceId),
  verifyTls: true,
}
const userServers = await mcpServer.listEnabled(workspaceId).then(decryptHeaders)
payload.mcp.servers = [defaultServer, ...userServers]
```

`apps/agents` is stateless about which workspace has which servers — the payload
is the contract.

### 8.2 Client implementation

`agent/repositories/mcp_client.py` replaces the bespoke httpx client with the
official `mcp` SDK:

```python
class McpClient:
    async def list_tools(self, server: McpServerSchema) -> list[McpToolSchema]:
        async with self._session_for(server) as session:
            await session.initialize()
            return await session.list_tools()

    async def call_tool(self, server: McpServerSchema, tool: str, args: dict) -> str: ...

    def _session_for(self, server: McpServerSchema) -> AsyncContextManager[ClientSession]:
        if server.transport == "SSE":
            return sse_client_session(server.url, headers=server.headers, ...)
        return http_jsonrpc_session(server.url, headers=server.headers, ...)
```

- New dependency: `mcp>=1.10` in `apps/agents/pyproject.toml`.
- `asyncio.gather(..., return_exceptions=True)` for parallel `list_tools` across
  servers; one server failing does not block the others.
- Tools registered into the graph under the namespaced name
  `{server.name}__{tool.name}` (double underscore).

### 8.3 Allowlist filter

After `list_tools`, the client filters by `server.toolsAllowlist`
(empty list = all tools). Filtered tools are wrapped into LangChain
`StructuredTool` (same shape as today's `wrap_tool`) and passed to `llm.bind_tools(...)`.

### 8.4 New tRPC router for MCP CRUD

New file `packages/trpc/src/routers/mcp-server.ts`:

```ts
export const mcpServerRouter = router({
  list: workspaceMemberProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => { /* returns rows without decrypted headers */ }),

  create: workspaceOwnerProcedure
    .input(z.object({
      workspaceId, name, description?, url, transport, headers, toolsAllowlist?, verifyTls?
    }))
    .mutation(async ({ ctx, input }) => {
      const encryptedHeaders = encryptSecret(JSON.stringify(input.headers))
      return prisma.workspaceMcpServer.create({ data: { ...input, headers: encryptedHeaders } })
    }),

  update: workspaceOwnerProcedure.input(...).mutation(...),
  delete: workspaceOwnerProcedure.input(...).mutation(...),

  discoverTools: workspaceMemberProcedure
    .input(z.object({ serverId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // delegates to a thin agents endpoint POST /agent/discover-tools
      // (apps/agents owns the MCP client; web should not duplicate it).
      // Returns [{name, description, inputSchema}]; writes nothing.
    }),
})
```

UI: new page `apps/web/src/app/(protected)/settings/integrations/mcp/page.tsx`
with a table of servers, a create dialog, a per-server detail view that runs
`discoverTools` and shows tool toggles wired to `update.toolsAllowlist`.

## 9. Memory layers

### 9.1 Session (existing `ChatMessage`)

- `apps/web` reads last N=20 `ChatMessage` rows for the chat and passes them as
  `chat_history: ConversationMessageSchema[]` in the payload.
- After SSE `done`, `apps/web` inserts a new `ChatMessage`:
  - `role = ASSISTANT`
  - `status = DONE`
  - `parts = [{type:"text", text: finalAnswer}, {type:"tool_call", ...} * N]`
  - `sources = citations[]`
- On `error`, inserts `ChatMessage` with `status=ERROR`, `errorMessage=event.message`.
- On `confirmation_required`, the user's message is already persisted; assistant
  message creation is deferred until either `done` or `error` arrives after
  resume.

LangGraph checkpointer in `AGENTS_DATABASE_URL` is treated as **opaque
machinery** for pause/resume only. It is not authoritative for chat history.

### 9.2 RAG (existing Qdrant)

Unchanged plumbing. Two integration changes:
- RAG retrieval moves from `chat/services/graph.py:prepare_prompt` to
  `agent/services/nodes/planner.py` so the **plan** sees the excerpts.
- New tool `anynote__search_pages(query: string, k: int = 10)` is exposed via
  the default engines MCP (added to `apps/engines/src/apps/mcp/tools/`) so the
  executor can re-search with a refined query if needed.

### 9.3 Long-term (`WorkspaceAgentMemory`)

- New tools (exposed by `apps/agents` itself, not via engines MCP — to keep them
  inside the agent process and avoid roundtrips):
  - `save_memory(scope: "workspace"|"user", key: string, content: string)` —
    appends to `state.pending_memory_writes`. Does not write to DB until
    `memory_writer` node after critic-approve.
  - `recall_memory(query: string, k: int = 5)` — lexical search over
    `key + content`, returns matches. Note: planner already gets top-K
    pre-loaded by web; this tool lets the executor fetch more if needed.
- Reading from web: lexical (`ILIKE`) search at request time, top-5, passed in
  payload as `long_term_memories[]`.
- UI: new page `apps/web/src/app/(protected)/settings/memory/page.tsx` — table
  view with delete. No edit in v1.
- New tRPC router `packages/trpc/src/routers/agent-memory.ts` exposing `list`
  (workspace member) and `delete` (writer of the row or workspace owner)
  procedures backing the UI. No `create`/`update` in v1 — agents-only writes
  via `save_memory` tool.

## 10. Confirmation flow

### 10.1 Confirmation-requiring tools (v1 defaults)

| Source | Tool | Requires confirmation? |
|---|---|---|
| engines | `getWorkspaceStats`, `getPageMarkdown`, `getPageStats`, `listSkills`, `listAgents`, `listWorkspaceFiles`, `listPageFiles`, `search_pages` (new) | No |
| engines | `createPage`, `updatePage`, `movePage`, `createPageFromFile`, `uploadFileToPage`, `uploadImageToPage`, `attachFileToPage`, `attachImageToPage` | Yes |
| agents internal | `save_memory` | No (revocable via UI) |
| agents internal | `recall_memory` | No |
| user-supplied | any | Yes (until user marks otherwise; per-tool override in v1.1) |

Workspace setting `allowDestructive=true` skips all confirmations — opt-in for
power users.

### 10.2 Pause via LangGraph `interrupt()`

Inside the executor's tool dispatch:

```python
async def dispatch_tool(state, call):
    tool_meta = tool_registry[call.name]
    if tool_meta.requires_confirmation and not state.context.allow_destructive:
        confirmation_id = str(uuid4())
        decision = interrupt({
            "confirmation_id": confirmation_id,
            "tool": call.name,
            "args_preview": tool_meta.preview(call.args),
            "summary": tool_meta.summarize(call.args),
        })
        if decision["action"] == "deny":
            return ToolMessage(
                content=f"User denied calling {call.name}.",
                tool_call_id=call.id,
            )
        # action == "allow" — fall through
    return await actually_call(call)
```

Checkpointer auto-saves state at `interrupt()`. Resume:

```python
await graph.ainvoke(
    Command(resume={"action": "allow" | "deny"}),
    config={"configurable": {"thread_id": chat_id}},
)
```

### 10.3 SSE event format

```python
class ServerEvent(BaseModel):
    type: Literal[
        "router_decision", "plan_step", "step_started", "step_completed",
        "token", "tool_status",
        "confirmation_required", "memory_write_proposed",
        "critic_verdict", "citation", "usage",
        "done", "error",
    ]
    # union of fields, validated per type via model_validator
    ...
```

Full event-type contract is enumerated in Section 11 below.

After emitting `confirmation_required`, the SSE stream closes cleanly with no
`done`/`error`. The UI knows to render a dialog and call `/api/agent/resume`.

### 10.4 Resume endpoint

`apps/web/src/app/api/agent/resume/route.ts`:

```ts
POST /api/agent/resume
Body: { chatId: string, confirmationId: string, action: "allow" | "deny" }

→ verifySession + assertMember
→ signAgentsJwt(...)
→ POST {AGENTS_URL}/agent/resume (SSE proxy)
```

`apps/agents /agent/resume`:

```python
@router.post("/agent/resume")
async def resume(payload: ResumeRequest, ctx: AgentContext = Depends(verify_agents_jwt)):
    # assert ctx.chat_id == payload.chat_id
    # load pending interrupt and assert id match
    # stream graph.ainvoke(Command(resume={"action": payload.action}), config={thread_id: ctx.chat_id})
```

### 10.5 Cleanup of orphaned interrupts

New cron in `apps/engines/src/apps/cleanup/` (new module):
- Runs every hour.
- Queries `langgraph_checkpoints` table for rows older than 24h with pending
  interrupts (LangGraph table layout TBD when implementing — the migration
  surface tells us exact column).
- Deletes them.

Web policy: if user submits a new message in a chat that has a pending
interrupt, web first calls `/api/agent/resume {action:"deny"}` and only then
the new `/api/agent/generate`. Baked into the route handler.

## 11. Streaming protocol (full event spec)

All events are emitted as `event: message\ndata: <json>\n\n` via `sse_starlette`.

| `type` | Producer | Required fields | Notes |
|---|---|---|---|
| `router_decision` | router | `kind` (`"trivial"\|"complex"`), `reason` (str) | One per turn |
| `plan_step` | planner | `id`, `title`, `position`, `status` | Emitted once per step at creation, then again whenever status changes |
| `step_started` | executor | `step_id` | |
| `step_completed` | executor | `step_id`, `result_summary` (str) | |
| `token` | executor (final answer) | `text` (str), `step_id?` | Streaming text deltas; same shape as today |
| `tool_status` | executor | `id`, `tool` (namespaced), `state` (`"running"\|"done"\|"error"`), `title`, `detail?`, `duration_ms?` | Renamed from current `status` |
| `confirmation_required` | executor | `confirmation_id`, `tool`, `summary`, `args_preview` | SSE stream closes after this event |
| `memory_write_proposed` | executor | `scope`, `key`, `content_preview` | Informational; actual write happens after critic-approve |
| `critic_verdict` | critic | `verdict` (`"approve"\|"revise"\|"reject"`), `feedback`, `revision_count` | |
| `citation` | executor or finalize | `page_id`, `workspace_id`, `block_number`, `title`, `quote?` | |
| `usage` | finalize | `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost_usd?` | One per turn near the end |
| `done` | finalize | — | Terminal |
| `error` | any | `code`, `message`, `recoverable` (bool) | Terminal |

Invariants enforced in implementation:
- `step_started` always precedes a matching `step_completed`.
- `confirmation_required` is always the last event of a stream (followed by
  socket close).
- Exactly one of `done` or `error` terminates a non-confirmation stream.
- `critic_verdict` with `revise` is followed by a new `plan_step` set; the
  client should reset the visible plan.

Backwards compatibility: `/chat/generate` continues to respond with the old
`token | status | done | error` set for one release window. New `/agent/run`
returns the extended set above.

## 12. The etalon scenario: "Q&A with citations"

Realised end-to-end as the v1 acceptance criterion.

### 12.1 Fixture

- Test workspace `qa-fixture` provisioned via tRPC `workspace.create`.
- 8 pages seeded: 1 `EXCALIDRAW`, 7 `TEXT`. Content drawn from a fixed Russian
  text fixture committed under `apps/e2e/fixtures/qa-pages/*.md` so assertions
  can match exact strings.
- `WorkspaceAiSettings` set to OpenAI: `defaultModelId="gpt-4o-mini"`,
  `embeddingsModelId="text-embedding-3-small"`, `chatModelConnection` encrypted
  with the test secret key, `apiKey` from `OPENAI_API_KEY` CI env.
- Vectorization triggered by calling the indexer endpoint directly (test-only
  route in `apps/engines`, gated by `PLAYWRIGHT=true`).

### 12.2 Flow and asserts

1. Sign up and authenticate (`signUpAndAuthAs`, existing helper).
2. Open `/workspaces/{id}/chats/new`.
3. Type: «Какие у нас были решения по поводу архитектуры платежей? Дай ссылки на
   конкретные блоки.»
4. Wait for SSE events:
   - `router_decision{kind:"complex"}`
   - Two or three `plan_step` events.
   - Per step: `step_started`, `tool_status(anynote__search_pages | anynote__getPageMarkdown)`,
     `step_completed`.
   - `token` deltas streaming the final answer.
   - `citation` events with valid `pageId`/`blockNumber`.
   - `critic_verdict{verdict:"approve"}`.
   - `usage`, `done`.
5. Asserts:
   - DOM contains at least one anchor whose href matches
     `/workspaces/[uuid]/pages/[uuid]#\\d+` and whose target page is in the
     fixture set.
   - Side-panel "План" lists all the plan steps with status DONE.
   - Direct Prisma read confirms one new `ChatMessage` with role=ASSISTANT,
     status=DONE, non-empty `sources`.
   - Direct Prisma read confirms `AgentActionLog` rows for each tool call.
   - The final text does not contain page titles or numeric facts absent from
     the fixture (controlled bag of allowed substrings).

## 13. Test strategy

### 13.1 Unit tests (`apps/agents/tests/apps/agent/`)

- `test_router.py` — trivial/complex classification with mock LLM (Dishka
  override returning a fake `BaseChatModel`).
- `test_planner.py` — JSON output shape, clarifying-question single-step plan,
  RAG documents incorporation.
- `test_executor.py` — ReAct loop transitions, scope enforcement (`pages:delete`
  missing → denied), tool namespacing, `tool_calls_made` cap.
- `test_critic.py` — verdict parsing, `revision_count <= 2` cap, reject path.
- `test_memory_writer.py` — DB write only when approved; rollback when rejected.
- `test_confirmation.py` — interrupt() + resume() round-trip via in-memory
  checkpointer.
- `test_mcp_client.py` — HTTP and SSE transports against an aiohttp test
  server; failure isolation; allowlist filter.
- `test_jwt_verify.py` — JWKS cache hit/miss, expired token, wrong `aud`, scope
  extraction, malformed `Authorization` header.
- `test_secret_encryption.py` — round-trip AES-GCM; tampered ciphertext raises;
  wrong key raises.

Existing tests under `apps/agents/tests/apps/chat/` get migrated to `agent/` or
removed when `/chat/generate` is dropped.

### 13.2 Integration tests (`apps/agents/tests/integration/`)

- `test_graph_full_run.py` — real `AsyncPostgresSaver` against a temp DB,
  in-process mock MCP server (aiohttp), vcrpy-recorded LLM responses. Runs
  router → planner → executor → critic → memory_writer end-to-end.
- `test_confirmation_pause_resume.py` — split across two processes via subprocess
  or two `graph.ainvoke` calls to prove state survives.

### 13.3 E2E Playwright (`apps/e2e/agent-qa-citations.spec.ts`)

- One golden-path spec for the etalon scenario.
- Runs against the existing `playwright.config.ts` webServer (port 3100, real
  Postgres + Qdrant from compose).
- Skipped if `OPENAI_API_KEY` is absent.
- Edge cases (confirmation dialog, error recovery, memory write) covered in
  integration tests, not Playwright, to keep the browser suite small.

### 13.4 LLM mocking

- **Unit:** Dishka provider override injects a fake `BaseChatModel` returning a
  scripted `AIMessage`.
- **Integration:** vcrpy cassettes in `apps/agents/tests/integration/cassettes/`,
  committed. Live LLM via `pytest -m live` marker; not in default CI.
- **Playwright:** real OpenAI via `OPENAI_API_KEY` from CI secret. One run per
  smoke pipeline.

### 13.5 CI gates

- `pnpm --filter agents test` — fast (<30s), all mocked.
- `pnpm --filter agents test:integration` — graph + confirmation integration;
  requires Postgres from compose.
- `pnpm gates` (turbo) includes the first two but **not** Playwright.
- `pnpm exec playwright test apps/e2e/agent-qa-citations.spec.ts` — separate
  job, runs nightly or on demand.

## 14. Files to create / modify

### 14.1 Create

```
apps/agents/agents/apps/agent/__init__.py
apps/agents/agents/apps/agent/depends.py
apps/agents/agents/apps/agent/enums.py
apps/agents/agents/apps/agent/errors.py
apps/agents/agents/apps/agent/router.py
apps/agents/agents/apps/agent/schemas.py
apps/agents/agents/apps/agent/utils.py
apps/agents/agents/apps/agent/repositories/__init__.py
apps/agents/agents/apps/agent/repositories/jinja_renderer.py
apps/agents/agents/apps/agent/repositories/jwks.py
apps/agents/agents/apps/agent/repositories/mcp_client.py
apps/agents/agents/apps/agent/repositories/model_factory.py
apps/agents/agents/apps/agent/repositories/action_log.py
apps/agents/agents/apps/agent/services/__init__.py
apps/agents/agents/apps/agent/services/graph.py
apps/agents/agents/apps/agent/services/history_compactor.py
apps/agents/agents/apps/agent/services/rag_retrieval.py
apps/agents/agents/apps/agent/services/tool_registry.py
apps/agents/agents/apps/agent/services/nodes/__init__.py
apps/agents/agents/apps/agent/services/nodes/router.py
apps/agents/agents/apps/agent/services/nodes/planner.py
apps/agents/agents/apps/agent/services/nodes/executor.py
apps/agents/agents/apps/agent/services/nodes/critic.py
apps/agents/agents/apps/agent/services/nodes/memory_writer.py
apps/agents/agents/apps/agent/use_cases/__init__.py
apps/agents/agents/apps/agent/use_cases/run_agent.py
apps/agents/agents/apps/agent/use_cases/resume_agent.py
apps/agents/agents/apps/agent/templates/router.j2
apps/agents/agents/apps/agent/templates/planner.j2
apps/agents/agents/apps/agent/templates/executor.j2
apps/agents/agents/apps/agent/templates/critic.j2
apps/agents/tests/apps/agent/__init__.py
apps/agents/tests/apps/agent/test_router.py
apps/agents/tests/apps/agent/test_planner.py
apps/agents/tests/apps/agent/test_executor.py
apps/agents/tests/apps/agent/test_critic.py
apps/agents/tests/apps/agent/test_memory_writer.py
apps/agents/tests/apps/agent/test_confirmation.py
apps/agents/tests/apps/agent/test_mcp_client.py
apps/agents/tests/apps/agent/test_jwt_verify.py
apps/agents/tests/integration/__init__.py
apps/agents/tests/integration/test_graph_full_run.py
apps/agents/tests/integration/test_confirmation_pause_resume.py

apps/web/src/lib/agents-token.ts
apps/web/src/lib/decrypt-workspace-secrets.ts
apps/web/src/app/api/agent/generate/route.ts
apps/web/src/app/api/agent/resume/route.ts
apps/web/src/app/(protected)/settings/integrations/mcp/page.tsx
apps/web/src/app/(protected)/settings/memory/page.tsx
apps/web/src/components/chat/PlanPanel.tsx
apps/web/src/components/chat/ConfirmationDialog.tsx
apps/web/src/lib/agent-stream-client.ts (if missing)

apps/engines/src/apps/cleanup/cleanup.module.ts
apps/engines/src/apps/cleanup/cleanup.service.ts
apps/engines/src/apps/cleanup/cleanup.spec.ts
apps/engines/src/apps/mcp/tools/search.tools.ts          # exposes search_pages
apps/engines/src/apps/mcp/tools/search.tools.spec.ts
apps/engines/src/auth/agents-internal-auth.guard.ts      # HMAC verification
apps/engines/src/auth/agents-internal-auth.guard.spec.ts

packages/auth/src/secret-encryption.ts
packages/auth/src/secret-encryption.test.ts

packages/trpc/src/routers/mcp-server.ts
packages/trpc/src/routers/mcp-server.test.ts
packages/trpc/src/routers/agent-memory.ts
packages/trpc/src/routers/agent-memory.test.ts

packages/db/prisma/migrations/<timestamp>_agent_os_v1/migration.sql

apps/e2e/agent-qa-citations.spec.ts
apps/e2e/fixtures/qa-pages/*.md
```

### 14.2 Modify

```
apps/agents/pyproject.toml                       # + pyjwt[crypto], cachetools, mcp
apps/agents/agents/router.py                     # include agent_router
apps/agents/agents/apps/chat/router.py           # add 308 redirect deprecation
apps/agents/agents/apps/chat/schemas.py          # mark legacy
apps/agents/agents/settings.py                   # + agents-internal secret, jwt settings
apps/agents/agents/bootstrap.py                  # register agent Dishka provider

apps/web/.env.example                            # + SECRETS_ENCRYPTION_KEY,
                                                 #   BETTER_AUTH_JWT_AGENTS_AUDIENCE,
                                                 #   AGENTS_TO_ENGINES_SECRET, etc.
apps/web/src/lib/auth.ts                         # add jwt audience config
apps/web/src/trpc/server.ts                      # expose new routers

apps/engines/src/apps/mcp/mcp.module.ts          # register search.tools + auth guard
apps/engines/src/apps/mcp/mcp-request-context.ts # accept new auth headers
apps/engines/src/main.ts                         # bootstrap cleanup module

packages/db/prisma/schema.prisma                 # WorkspaceAiSettings extension,
                                                 # WorkspaceMcpServer, WorkspaceAgentMemory,
                                                 # AgentActionLog, enums
packages/trpc/src/index.ts                       # register new routers
packages/trpc/src/routers/ai-settings.ts         # add encrypted connection getters/setters
packages/auth/src/index.ts                       # export secret encryption helpers

turbo.json                                       # globalEnv: + SECRETS_ENCRYPTION_KEY,
                                                 #   BETTER_AUTH_JWT_AGENTS_AUDIENCE,
                                                 #   AGENTS_TO_ENGINES_SECRET
.env.example                                     # mirror turbo.json additions
playwright.config.ts                             # ensure OPENAI_API_KEY passed through
```

### 14.3 Delete (after deprecation window — NOT in v1)

Nothing deleted in v1. `apps/agents/agents/apps/chat/*` remains until a follow-up
release.

## 15. Risks and open questions

1. **LangGraph `interrupt()` + `AsyncPostgresSaver` SSE compatibility.** Need to
   verify that `astream` correctly raises a `GraphInterrupt` and that we can
   detect it from inside the SSE generator to emit `confirmation_required`
   cleanly. If not, fall back to a manual checkpointer + state machine. Decide
   in task 1 of the plan; spike if uncertain.
2. **Python `mcp` SDK SSE stability.** Library is young; if SSE transport is
   flaky we may temporarily keep our `httpx` JSON-RPC client and add SSE later
   in v1.1.
3. **Cron column layout for orphaned interrupts.** `langgraph_checkpoints` table
   schema is owned by the library; the cleanup query needs verification when
   the migration runs.
4. **Lexical search on `WorkspaceAgentMemory` may be insufficient** for many
   workspaces. Plan a v1.5 add-on for embeddings if users complain.
5. **OpenAI cost in CI.** One Playwright run per commit hitting GPT-4o-mini is
   ~$0.01; one nightly run is fine. If we move to per-commit, gate by file
   touched (only run if `apps/agents/**` or `apps/web/src/app/api/agent/**`
   changed).
6. **`fast-clean` framework support for FastAPI dependencies returning custom
   contexts.** `verify_agents_jwt` shape needs to match the existing
   `Header()`-based dependency pattern. Confirm during implementation.

## 16. Out of scope for v1 (explicit defer list)

- Scenarios 2 through 12 (page authoring, kanban planning, executive summaries,
  reminder management, transcript parsing, duplicate detection, file helper,
  export/publish, page-agents). Each becomes a small follow-up iteration:
  add 1–3 tools to the engines MCP, optional new prompt section, integration
  test, optional new Playwright spec.
- Per-role model selection.
- LLM-summarized compaction.
- 4th memory layer (cross-workspace user-global).
- stdio MCP transport.
- OAuth flows for MCP servers.
- Per-tool persistent confirmation allowlists.
- Bulk confirmations.
- Counter-proposals during confirmation.
- Parallel plan-step execution.
- Adaptive thinking budget.
- Performance/load tests.
- Observability (OpenTelemetry, structured logging beyond `logger.info/error`).
- UI for editing `WorkspaceAgentMemory` rows (only view + delete in v1).
- Auth profile rotation for upstream LLM API keys.
