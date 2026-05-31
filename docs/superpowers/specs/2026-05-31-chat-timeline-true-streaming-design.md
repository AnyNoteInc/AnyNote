# Chat Timeline & True text↔tool Streaming — Design Spec

**Date:** 2026-05-31
**Status:** Approved (brainstorm complete, awaiting implementation plan)
**Scope:** Single feature branch, one end-to-end spec across `apps/agents`, `apps/web`, and `packages/ui`.

## Goal

Render an assistant chat response as a single **MUI Timeline**, top-to-bottom, in the true
chronological order events occurred — tooling steps and answer text interleaved as they actually
happened — with the timeline dot colour encoding tool state. Three user-facing outcomes (the original
request):

1. **Tool-call colours** on the timeline dot:
   - grey while in progress (`running` / `pending`)
   - `primary` when finished (`done`)
   - red when failed (`error`)
2. **MUI Timeline** rendering tooling and LLM text **interleaved, top-to-bottom in arrival order** —
   not the current "all text first, all tools after" grouping. Text appears **inside** the timeline as
   a normal entry, not as a separate block above the tools.
3. **Verify the whole change with Playwright.**

Delivering (2) honestly requires the assistant pipeline to actually **produce** an interleaved stream.
Today it does not (see Background). So this spec also makes `apps/agents` stream answer tokens in real
time and emit real `tool_status` events, and reworks the `apps/web` accumulator + persistence + the
`packages/ui` renderer onto an **ordered segment model**.

This was explicitly chosen as one large end-to-end spec (not staged) by the user, with full awareness
of the regression risk to the core chat flow.

## Background — verified current behaviour

Code-verified during brainstorming (not assumed). **Corrects an inaccuracy in the prior
`2026-05-31-workspace-chat-expansion-design.md`, which claimed `tool_status` is "already in the
stream".**

- **`apps/agents` does NOT stream answer tokens.** Every node uses `await llm.ainvoke(...)`
  (router, planner, executor, critic). The graph is consumed via
  `graph.astream(stream_mode=['values','updates'])` in
  `agents/apps/agent/services/graph_streaming.py`. The full answer is emitted as **one** `token` event
  at the very end, in `_yield_final_events` (`final.final_answer`).
- **`apps/agents` never emits `tool_status`.** `grep` proves `ServerEventSchema.tool_status(...)` has
  zero call sites — it exists only as a schema/factory in `agents/apps/agent/schemas.py`. What the UI
  currently shows as "tooling" is actually `plan_step` events (`plan-${id}` blocks) diffed from
  `state.plan` in `_diff_plan_events`.
- **No sequence/timestamp on SSE events.** Ordering today is implied only by emission order.
- **The web accumulator groups by type.** `apps/web/src/lib/chat/active-stream-registry.ts` keeps three
  separate fields — `content: string`, `thinking: string`, `blocks: ServiceBlock[]`.
  `agent-sse-bridge.ts#createAssistantParts` assembles them as `[thinking, text, ...tools]`.
- **Client mappers reinforce the grouping.**
  `apps/web/src/components/workspace/chat/chat-message-mappers.ts`:
  - `appendAssistantText` merges **all** text deltas into the single first `text` part.
  - `replaceAssistantToolBlocks` → `withToolParts` appends **all** tool parts to the end.
  So a real `text→tool→text→tool` sequence is stored as `[thinking, text, tool, tool]` — chronology is
  lost by construction.
- **Persistence mirrors the grouping.** `createDebouncedPersist` writes
  `parts: createAssistantParts(entry)` to `ChatMessage.parts` (JSON) — also `[thinking, text, tools]`.
- **The UI re-sorts by type.** `packages/ui/src/components/chat/chat-message-content.tsx#getPartOrder`
  sorts `thinking(0) → text(1) → tool(2) → attacment(3)` and renders a plain `Box` column.
  `chat-service-block.tsx` shows state as **grey text only** (`getStateLabel`), no colour, no dot.
- **`@mui/lab` (Timeline) is NOT installed** in `packages/ui` or `apps/web`.

### Library capability (Context7-verified, LangGraph ≥ 1.1.8, Python 3.13)

- **Token streaming:** `graph.astream(..., stream_mode="messages")` yields `(message_chunk, metadata)`.
  Tokens can be filtered to a specific LLM call by **tag**: build the model with
  `init_chat_model(..., tags=[...])` (or attach tags to the model) and keep only chunks whose
  `metadata["tags"]` contains the answer tag. This excludes router/planner/critic LLM tokens.
- **Custom events from inside a node:** `from langgraph.config import get_stream_writer`;
  `writer({...})` inside `tool_runner_node`, consumed via `stream_mode="custom"`. Python 3.13 means
  context-vars propagate without threading `config` through.
- **Combined modes:** `stream_mode=['values','updates','messages','custom']`; `astream` yields
  `(mode, data)` tuples (the existing code already destructures `mode, data`).

## Architecture — the ordered segment model (cross-cutting)

The single core idea: an assistant response is an **ordered list of segments** in arrival order.

```
Segment =
  | { type: 'thinking'; text }
  | { type: 'text';     text }
  | { type: 'tool';     id; kind; state; title; detail?; result? }
  | { type: 'attacment'; ... }   // user messages only, unchanged
```

**Invariant:** a text segment is *open* until any non-text event (a `tool_status`) arrives; the next
token after a tool opens a **new** text segment. Tools no longer float to the end — each occupies its
arrival position. This rule lives in exactly one place: the web registry entry (§Web bridge/registry).

**Backward compatibility (no DB migration).** Already-persisted messages are `[thinking, text, ...tools]`
— a *valid* ordered segment list (it just happens to be "text then tools"). The new renderer draws
`ChatMessage.parts` strictly in array order, so old rows render correctly as
thinking → tools → text and new rows render interleaved. **No data migration, no backfill.**

Per-layer mapping:

| Layer | Today | After |
|---|---|---|
| Python `AgentState` | `draft_answer`, `draft_reasoning` (final, once) | stream tokens live; emit `tool_status` live |
| SSE (agents→web) | `token` once at end; `plan_step` | `token` streamed; real `tool_status`; arrival order = chronology |
| web registry entry | `content` / `thinking` / `blocks` | `segments: OrderedSegment[]` (one ordered list) |
| SSE (web→browser) | `message.delta` / `message.service` | `message.segments` snapshot + `message.delta` carrying a **segment index** |
| client mappers | merge into one text part; tools to end | append delta by segment index; replace segments from snapshot |
| DB `ChatMessage.parts` | `[thinking, text, tools]` | ordered segment array (old rows still valid) |
| UI | sort by type, `Box` column | render in array order inside `<Timeline>` |

## Layer 1 — `apps/agents` (Python): real token + tool_status streaming

**1a. Tag the answer model.** In `agents/apps/agent/repositories/model_factory.py`, tag the model used
for the user-facing answer with an `answer` tag so its tokens are distinguishable in
`stream_mode="messages"`. Router/planner/critic models stay untagged (their tokens are dropped).

**1b. Emit `tool_status` from `tool_runner_node`.** In
`agents/apps/agent/services/nodes/tool_runner.py`, around each `_run_tool`:
```python
writer = get_stream_writer()
writer({'kind': 'tool_status', 'id': call_id, 'tool': name, 'state': 'running', 'title': ...})
msg = await _run_tool(...)
writer({'kind': 'tool_status', 'id': call_id, 'tool': name,
        'state': 'done' | 'error', 'detail': ..., 'result': <short result>})
```
Confirmation/`interrupt`, dedup reuse, scope-denied, and create-page paths each map to an appropriate
terminal `tool_status` (e.g. denied → `error`/short message). Interrupt-resume re-runs `tool_runner`,
so a resumed tool re-emits `running`→`done` naturally.

**1c. Extend `graph_streaming.py`.** `stream_mode = ['values','updates','messages','custom']`. Routing:
- `messages` → keep chunks whose `metadata` carries the `answer` tag → emit streamed `token` events as
  generated.
- `custom` with `kind=='tool_status'` → emit `tool_status` SSE events.
- `values`/`updates` → unchanged (`plan_step`, `router_decision`, `critic_verdict`,
  `confirmation_required`).
- `_yield_final_events` **stops** emitting `final_answer` as a `token` (otherwise the answer arrives
  twice: streamed + final). It still emits `citation`s and may emit a terminal `thinking` if reasoning
  is only available post-hoc.

**Not changed:** graph topology and node logic (executor↔tool_runner loop, plan diffing, dedup,
confirmation/interrupt semantics, the create-page shortcut). Token streaming applies to the executor's
answer turn; when the model instead returns tool calls, no answer tokens are emitted for that turn.

**plan_step vs tool_status.** They are distinct: `plan_step` = high-level plan steps (`plan-${id}`),
`tool_status` = concrete tool invocations within a step. Both become timeline dots, distinguished by id
prefix; the UI treats both as `type:'tool'` segments. Whether both are shown flat or tool segments nest
under their plan step is **deliberately deferred to implementation**: it depends on what the real
combined stream looks like at runtime (single-step plans may make `plan_step` redundant). The plan must
include a checkpoint that observes one real run and picks flat-vs-nested before finalizing the UI — not
a design gap, an observation-gated decision.

## Layer 2 — `apps/web` bridge + registry: ordered accumulator

**2a. `entry.segments`.** Replace `content`/`thinking`/`blocks` on `ActiveStreamEntry`
(`active-stream-registry.ts`) with `segments: OrderedSegment[]` — the single source of truth for order.
New entry methods:
- `publishDelta(text)` — find the **last** segment; if it is an open `text`, append; else push a new
  `{ type:'text' }`. Emits `message.delta` with that segment's index.
- `publishThinking(text)` — same for `thinking`.
- `publishToolStatus(block)` — upsert by `id`: update in place (`running`→`done`/`error`) if present,
  else push a new tool segment. This closes any open text segment (the next `publishDelta` starts a new
  one). Emits a `message.segments` snapshot.

**2b. SSE protocol browser←web.** Add `message.segments` (full ordered snapshot, analogous to today's
`message.service` which already ships the whole blocks array). `message.delta` gains a **segment index**.
Decision: **snapshot for structure + deltas for smooth text** — the snapshot is the source of truth for
tool/segment boundaries (trivial, flicker-free reconciliation), deltas give smooth typing between
snapshots. Both mutate the same `entry.segments`.

**2c. Persistence.** `createDebouncedPersist` writes `parts: entry.segments` (already ordered). Old rows
stay readable (Architecture §backward compatibility).

**2d. `agent-sse-bridge.ts` translator.** `handleAgentEvent`:
- `token` → `entry.publishDelta` (now "into the current open text segment").
- `tool_status` (new upstream) → `entry.publishToolStatus(...)` → triggers `message.segments`.
- `plan_step` → tool segment (`plan-${id}`), occupying its arrival position.
- `thinking`, `confirmation_required`, `error`, `done` → as today, via segments.

## Layer 3 — `apps/web` client: mappers + use-chat-stream

**3a. New reducers in `chat-message-mappers.ts` (replacing the merge reducers):**
- `appendAssistantTextDelta(messages, assistantId, segmentIndex, text)` — append into the segment at
  `segmentIndex` (create if absent). Replaces `appendAssistantText`.
- `replaceAssistantSegments(messages, assistantId, segments)` — replace `parts` wholesale from a
  `message.segments` snapshot. Replaces `replaceAssistantToolBlocks` + the manual `withToolParts` merge.
- Snapshot is the structural source of truth; deltas fast-path text between snapshots.

**3b. `use-chat-stream.ts`:**
- `message.delta` → `appendAssistantTextDelta(..., event.segmentIndex, event.text)`.
- `message.segments` (new) → `replaceAssistantSegments(..., event.segments)`.
- `message.service` (old) → removed / folded into segments.
- `message.thinking` → a thinking segment via the same mechanism.
- Optimistic UI, `reconcileOptimisticIds`, and `markAssistantErrored` are **kept**, operating over the
  segment array.

**3c. Post-stream `getChat` refetch.** Because the DB now stores the same ordered segments, the live→server
swap matches order — no flicker/dupes. This retires the "thinking-before-text" ordering trick documented
in today's `appendAssistantThinking`.

**3d. Old-message compatibility.** `mapServerMessageToThreadMessage` stops doing `withToolParts(...)`
(which pulled tools to the end); it takes `message.parts` in array order. The generated error part for
`status==='ERROR'` is still appended at the end.

## Layer 4 — `packages/ui`: MUI Timeline with coloured dots

**4a. Dependency.** Add `@mui/lab` to `packages/ui/package.json` (compatible with `@mui/material@7`).
Re-export the Timeline primitives through `@repo/ui/components` (project rule: no direct `@mui/*` imports
in app code). `@mui/lab` is consumed by `apps/web` only via `@repo/ui`, so no `transpilePackages` change
is required beyond the existing `@repo/ui` entry. Confirm during implementation that `@mui/lab` resolves
under Next 16 / Turbopack.

**4b. Rework `chat-message-content.tsx`.** Remove `getPartOrder` sorting — render **strictly in array
order**. Wrap parts in `<Timeline position="right">` with MUI's default left padding/margins zeroed so
content aligns left. Each part → `<TimelineItem>`:
```
<TimelineSeparator>
  <TimelineDot color={dotColor(part)} />
  <TimelineConnector />   // omit on the last item
</TimelineSeparator>
<TimelineContent>
  text     → ReactMarkdown (current markdown styling)
  tool     → <ChatServiceBlock> (current collapsible args/result)
  thinking → <ChatThinkingBlock>
  attacment→ <ChatFileChip>
</TimelineContent>
```
Top-to-bottom in arrival order; text is a normal timeline entry, not a separate block.

**4c. Dot colour by state (request item 1):**
- `running` / `pending` → grey (`color="grey"`)
- `done` → `color="primary"`
- `error` → `color="error"`
- `required` (confirmation) → keep the warning accent (inline confirm unchanged)
- `text` / `thinking` segments → neutral dot (grey/outlined; no "state")

**4d. `chat-service-block.tsx`.** Internals unchanged (expand args/result; inline confirmation). The
textual state label (`Done`/`Running`/`Error`) is **removed** — state is conveyed solely by the dot
colour (consistent with the recent "quiet tooling" changes). Tool name stays.

## Testing

- **Unit (vitest):**
  - `chat-message-mappers.test.ts` — segment ordering: a `text→tool→text→tool` event sequence yields
    `parts` in that exact order; `appendAssistantTextDelta` targets the right segment; snapshot replace
    preserves order; old `[thinking,text,tools]` rows map unchanged.
  - registry/bridge — `publishToolStatus` closes the open text segment; the next delta opens a new one;
    `tool_status` upsert by id flips state in place.
  - `chat-service-block.test.tsx` (11 existing) — keep green; add a dot-colour-by-state assertion.
- **Python (pytest):** `graph_streaming` emits streamed `token`s (tagged) and `tool_status` (running→
  terminal) in chronological order; no duplicate final `token`.
- **E2E (Playwright, request item 3):** an authed chat run that triggers tooling; assert the Timeline
  renders interleaved (a tool entry, then a later text entry), dot colours reflect state, and the final
  answer is the last timeline entry. Per memory, the Playwright dev server has no agents backend — use
  the established chat-spec harness / mock path used by `chat-expansion.spec.ts`; if a live agent run is
  not reproducible in E2E, assert the renderer against seeded segment data and verify the live stream
  manually with the Playwright MCP browser.

## Risks (acknowledged)

- Core chat-flow regressions span the whole pipeline (agents stream → web accumulator → persistence →
  UI). Mitigated by keeping graph topology untouched and by the no-migration compatibility design.
- Executor turns that both emit text *and* request tools: answer tokens stream only on non-tool turns;
  verify no stray partial text leaks into a tool turn's segment.
- Snapshot+delta consistency: the `message.segments` snapshot is authoritative for structure; deltas
  must target the correct segment index or text lands in the wrong entry.
- `tool_status` from `plan_step` vs real tool calls could double-represent a step; keep id prefixes
  distinct and decide per-render whether both are shown or tools nest under their plan step.

## Out of scope

- Changing the LangGraph topology, planner/critic/router behaviour, or confirmation semantics.
- Persisting per-token timing or sequence numbers.
- Any DB schema/migration (the `parts` JSON shape is backward-compatible).
