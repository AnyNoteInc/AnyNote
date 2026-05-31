# Chat Timeline & True text↔tool Streaming — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render assistant chat responses as a single MUI Timeline in true chronological order (text and tooling interleaved as they happened), with timeline-dot colour encoding tool state — and make the pipeline actually produce an interleaved stream.

**Architecture:** An assistant response becomes an **ordered list of segments** (`text`/`thinking`/`tool`) in arrival order. `apps/agents` streams answer tokens (filtered to the `executor` node) and emits real `tool_status` events from `tool_runner` via `get_stream_writer()`. `apps/web` replaces its type-grouped accumulator (`content`/`thinking`/`blocks`) with one ordered `segments` list across registry → bridge → mappers → persistence. `packages/ui` renders parts strictly in array order inside `@mui/lab` `<Timeline>`. The persisted `ChatMessage.parts` JSON stays backward-compatible (old `[thinking,text,tools]` rows are a valid ordered list) — **no DB migration**.

**Tech Stack:** Python 3.13 / LangGraph ≥1.1.8 (`stream_mode=['values','updates','messages','custom']`, `get_stream_writer`, `metadata["langgraph_node"]`), Next.js 16 / React 19 / TypeScript, MUI v7 + `@mui/lab`, vitest, pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-31-chat-timeline-true-streaming-design.md`

**Phase order is bottom-up along the data flow** so each phase is testable on its own:
1. Python emits `tool_status` (real tool lifecycle).
2. Python streams answer tokens (node-filtered) + stops the duplicate final `token`.
3. Web registry: ordered `segments` accumulator.
4. Web bridge: translate upstream events into segment mutations + new browser SSE.
5. Web client mappers + `use-chat-stream`: segment-ordered reducers.
6. UI: `@mui/lab` Timeline with coloured dots.
7. E2E (Playwright) + manual live verification.

**Conventions (this repo):**
- Prettier: `semi: false`, single quotes, trailing commas, 100-col. Run `pnpm format` if unsure.
- Commits: Conventional Commits with scope, e.g. `feat(chat): …`. Husky runs gates on commit — **never** `--no-verify`.
- Python: run agents commands via `pnpm --filter agents …` (uv-managed).
- Tests: `pnpm --filter web test` (vitest), `pnpm --filter @repo/ui test` (vitest), `pnpm --filter agents test` (pytest, excludes integration).

---

## Phase 1 — `apps/agents`: emit real `tool_status` from `tool_runner`

**Why first:** it is the most isolated change (one node, one writer), unlocks the "tools as real events" half of interleaving, and `ServerEventSchema.tool_status` + the web bridge's `tool_status` handler already exist — they were never fed.

**Files:**
- Modify: `apps/agents/agents/apps/agent/services/nodes/tool_runner.py`
- Modify: `apps/agents/agents/apps/agent/services/graph_streaming.py`
- Test: `apps/agents/tests/test_graph_streaming_tool_status.py` (create)

### Task 1.1: Failing test — `tool_status` running→done emitted around a tool call

- [ ] **Step 1: Write the failing test**

Create `apps/agents/tests/test_graph_streaming_tool_status.py`. This drives a minimal graph whose single node emits two custom `tool_status` events via the stream writer, and asserts `GraphStreamingService` translates the `custom` stream into `ServerEventSchema` `tool_status` events in order.

```python
import pytest
from langgraph.config import get_stream_writer
from langgraph.graph import START, StateGraph

from agents.apps.agent.schemas import AgentState
from agents.apps.agent.services.graph_streaming import GraphStreamingService


@pytest.mark.asyncio
async def test_tool_status_custom_events_are_translated_in_order():
    def node(state: AgentState):
        writer = get_stream_writer()
        writer({'kind': 'tool_status', 'id': 't1', 'tool': 'search', 'state': 'running', 'title': 'search'})
        writer({'kind': 'tool_status', 'id': 't1', 'tool': 'search', 'state': 'done', 'title': 'search', 'detail': 'ok'})
        return {}

    g = StateGraph(AgentState)
    g.add_node('executor', node)
    g.add_edge(START, 'executor')
    compiled = g.compile()

    initial = AgentState.model_validate({
        'context': {
            'user_id': '00000000-0000-0000-0000-000000000001',
            'workspace_id': '00000000-0000-0000-0000-000000000002',
            'chat_id': '00000000-0000-0000-0000-000000000003',
            'scopes': [],
        },
        'user_message': 'hi',
    })
    config = {'configurable': {'thread_id': 't'}}

    events = [
        ev async for ev in GraphStreamingService().stream(compiled, initial, config, initial)
    ]
    tool_events = [e for e in events if e.type == 'tool_status']
    assert [(e.id, e.state) for e in tool_events] == [('t1', 'running'), ('t1', 'done')]
    assert tool_events[1].detail == 'ok'
```

> Note: `AgentState` requires a `context` with `user_id`/`workspace_id`/`chat_id`/`scopes`. If the minimal `model_validate` above raises for missing required fields, copy the full minimal-state factory from an existing agents test (search `tests/` for `AgentState.model_validate(` and reuse the smallest one). Do not invent fields — mirror an existing test's construction.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter agents test -- tests/test_graph_streaming_tool_status.py -v`
Expected: FAIL — `GraphStreamingService.stream` does not request `custom` mode yet, so no `tool_status` events are produced (assertion on empty list).

### Task 1.2: Translate `custom` stream into `tool_status` events

- [ ] **Step 3: Add `custom` to stream_mode and route tool_status**

In `apps/agents/agents/apps/agent/services/graph_streaming.py`, change the `astream` call and add a `custom` branch. Replace the `async for chunk in graph.astream(...)` loop header and add handling:

```python
        async for chunk in graph.astream(
            input, config, stream_mode=['values', 'updates', 'messages', 'custom'],
        ):
            mode, data = chunk
            if mode == 'values':
                events, last_plan_states = self._process_values_chunk(data, last_plan_states)
                for ev in events:
                    yield ev
                continue
            if mode == 'custom':
                ev = self._process_custom_chunk(data)
                if ev is not None:
                    yield ev
                continue
            if mode == 'messages':
                # token streaming added in Phase 2; ignore here
                continue
            done = False
            async for ev in self._process_updates_chunk(data, initial_state):
                if isinstance(ev, _Done):
                    done = True
                    break
                yield ev
            if done:
                return
```

Add the new method (place after `_process_values_chunk`):

```python
    def _process_custom_chunk(self, data: Any) -> ServerEventSchema | None:
        if not isinstance(data, dict) or data.get('kind') != 'tool_status':
            return None
        return ServerEventSchema.tool_status(
            id=str(data['id']),
            tool=str(data.get('tool', '')),
            state=data['state'],
            title=str(data.get('title', '')),
            detail=data.get('detail'),
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter agents test -- tests/test_graph_streaming_tool_status.py -v`
Expected: PASS.

### Task 1.3: Emit `tool_status` from `tool_runner_node`

- [ ] **Step 5: Write the failing test for tool_runner emission**

Append to `apps/agents/tests/test_graph_streaming_tool_status.py` a test that runs `tool_runner_node` inside a graph with one fake tool and asserts a `running` then `done` event is emitted around it. Reuse the real `tool_runner_node`.

```python
from collections.abc import Sequence

from langchain_core.tools import StructuredTool

from agents.apps.agent.services.nodes.tool_runner import tool_runner_node


@pytest.mark.asyncio
async def test_tool_runner_emits_running_then_done():
    async def _echo(value: str) -> str:
        return f'echoed:{value}'

    tool = StructuredTool.from_function(coroutine=_echo, name='echo', description='echo')

    async def runner(state: AgentState):
        return await tool_runner_node(state, tools=[tool], tool_registry={})

    g = StateGraph(AgentState)
    g.add_node('tool_runner', runner)
    g.add_edge(START, 'tool_runner')
    compiled = g.compile()

    initial = AgentState.model_validate({
        'context': {
            'user_id': '00000000-0000-0000-0000-000000000001',
            'workspace_id': '00000000-0000-0000-0000-000000000002',
            'chat_id': '00000000-0000-0000-0000-000000000003',
            'scopes': [],
        },
        'user_message': 'hi',
        'pending_tool_calls': [{'name': 'echo', 'args': {'value': 'x'}, 'id': 'call-1'}],
    })
    config = {'configurable': {'thread_id': 't2'}}

    events = [e async for e in GraphStreamingService().stream(compiled, initial, config, initial)]
    tool_events = [(e.id, e.state) for e in events if e.type == 'tool_status']
    assert ('call-1', 'running') in tool_events
    assert ('call-1', 'done') in tool_events
    assert tool_events.index(('call-1', 'running')) < tool_events.index(('call-1', 'done'))
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter agents test -- tests/test_graph_streaming_tool_status.py::test_tool_runner_emits_running_then_done -v`
Expected: FAIL — `tool_runner_node` does not call the stream writer yet (no `tool_status` events).

- [ ] **Step 7: Emit tool_status around each tool call**

In `apps/agents/agents/apps/agent/services/nodes/tool_runner.py`:

Add the import near the top (with the other `langgraph` import):

```python
from langgraph.config import get_stream_writer
```

Add a small helper above `tool_runner_node`:

```python
def _emit_tool_status(call_id: str, name: str, state: str, *, detail: str | None = None) -> None:
    """Best-effort custom event so the web layer can render real tool lifecycle.

    Wrapped in try/except: get_stream_writer() is only bound when the graph is
    consumed with stream_mode including 'custom'; unit tests that call the node
    directly (no stream) must not crash.
    """
    try:
        writer = get_stream_writer()
    except Exception:
        return
    writer({
        'kind': 'tool_status',
        'id': call_id,
        'tool': name,
        'state': state,
        'title': name,
        'detail': detail,
    })
```

Then update the loop body of `tool_runner_node`. Replace the existing `for call in state.pending_tool_calls:` block with one that emits `running` before work and a terminal state after. The dedup-reuse path emits `done` immediately; the executed path derives state from whether the resulting `ToolMessage` content looks like an error:

```python
    for call in state.pending_tool_calls:
        tool_calls_made += 1
        call = _enrich_call_from_chat_history(call, state)
        call_id = str(call['id'])
        name = str(call['name'])
        _emit_tool_status(call_id, name, 'running')
        prior = _prior_tool_result(name, call.get('args') or {}, state.messages)
        if prior is not None:
            log.info(
                'tool_runner: deduping duplicate %s call; reusing prior result',
                call['name'],
            )
            new_tool_messages.append(ToolMessage(content=prior, tool_call_id=call_id))
            _emit_tool_status(call_id, name, 'done', detail=_short(prior))
            continue
        msg = await _run_tool(call, tools, tool_registry, state)
        new_tool_messages.append(msg)
        is_error = isinstance(msg.content, str) and msg.content.lower().startswith(
            (f"tool '{name}' error", 'permission denied', 'user denied')
        )
        _emit_tool_status(
            call_id, name, 'error' if is_error else 'done', detail=_short(str(msg.content)),
        )
```

Add the `_short` helper next to `_emit_tool_status`:

```python
def _short(text: str, limit: int = 500) -> str:
    return text if len(text) <= limit else text[:limit] + '…'
```

> Note on confirmation: when `_run_tool` triggers an `interrupt`, control leaves the node before the terminal emit — that's fine; on resume the loop re-runs and emits `running`→terminal for the approved call. The `confirmation_required` event still flows via the `updates`/interrupt path unchanged.

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter agents test -- tests/test_graph_streaming_tool_status.py -v`
Expected: PASS (both tests).

- [ ] **Step 9: Run the agents suite + lint**

Run: `pnpm --filter agents test`
Expected: PASS (no regressions).
Run: `pnpm --filter agents lint` (if defined; otherwise skip)

- [ ] **Step 10: Commit**

```bash
git add apps/agents/agents/apps/agent/services/nodes/tool_runner.py \
        apps/agents/agents/apps/agent/services/graph_streaming.py \
        apps/agents/tests/test_graph_streaming_tool_status.py
git commit -m "feat(agents): emit real tool_status events from tool_runner via stream writer"
```

---

## Phase 2 — `apps/agents`: stream answer tokens (node-filtered) + drop duplicate final token

**Why:** this is the other half of interleaving — text must arrive as it is generated, attributed to the `executor` node, so the web layer can place it between tool events. The shared `llm` means we filter by `metadata["langgraph_node"] == "executor"`, not by a model tag.

**Files:**
- Modify: `apps/agents/agents/apps/agent/services/graph_streaming.py`
- Test: `apps/agents/tests/test_graph_streaming_tokens.py` (create)

### Task 2.1: Failing test — executor tokens stream, other nodes are filtered out

- [ ] **Step 1: Write the failing test**

Create `apps/agents/tests/test_graph_streaming_tokens.py`. It uses LangChain's `GenericFakeChatModel` to produce deterministic streamed chunks from two nodes (`executor` and `critic`) and asserts only `executor` chunks become `token` events.

```python
import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langgraph.graph import START, StateGraph

from agents.apps.agent.schemas import AgentState
from agents.apps.agent.services.graph_streaming import GraphStreamingService


def _minimal_state() -> AgentState:
    return AgentState.model_validate({
        'context': {
            'user_id': '00000000-0000-0000-0000-000000000001',
            'workspace_id': '00000000-0000-0000-0000-000000000002',
            'chat_id': '00000000-0000-0000-0000-000000000003',
            'scopes': [],
        },
        'user_message': 'hi',
    })


@pytest.mark.asyncio
async def test_only_executor_tokens_become_token_events():
    answer_model = GenericFakeChatModel(messages=iter([AIMessage(content='Hello world')]))
    other_model = GenericFakeChatModel(messages=iter([AIMessage(content='internal reasoning')]))

    async def executor(state: AgentState):
        await answer_model.ainvoke('q')
        return {}

    async def critic(state: AgentState):
        await other_model.ainvoke('q')
        return {}

    g = StateGraph(AgentState)
    g.add_node('executor', executor)
    g.add_node('critic', critic)
    g.add_edge(START, 'executor')
    g.add_edge('executor', 'critic')
    compiled = g.compile()

    initial = _minimal_state()
    config = {'configurable': {'thread_id': 'tok'}}

    events = [e async for e in GraphStreamingService().stream(compiled, initial, config, initial)]
    token_text = ''.join(e.text or '' for e in events if e.type == 'token')
    assert token_text == 'Hello world'
    assert 'internal' not in token_text
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter agents test -- tests/test_graph_streaming_tokens.py -v`
Expected: FAIL — the `messages` branch added in Phase 1 currently `continue`s without emitting tokens, so `token_text` is empty.

### Task 2.2: Emit token events from executor messages

- [ ] **Step 3: Implement the messages branch**

In `apps/agents/agents/apps/agent/services/graph_streaming.py`, replace the placeholder `messages` branch (`# token streaming added in Phase 2; ignore here`) with real handling:

```python
            if mode == 'messages':
                ev = self._process_messages_chunk(data)
                if ev is not None:
                    yield ev
                continue
```

Add the method (after `_process_custom_chunk`):

```python
    def _process_messages_chunk(self, data: Any) -> ServerEventSchema | None:
        """Translate an executor-node LLM token chunk into a token event.

        astream(stream_mode='messages') yields (message_chunk, metadata). The
        same llm is reused by every node, so we filter by langgraph_node to keep
        only the user-facing answer tokens (executor). Empty-content chunks
        (tool-call deltas, role headers) are skipped.
        """
        if not isinstance(data, tuple) or len(data) != 2:
            return None
        msg, metadata = data
        if not isinstance(metadata, dict) or metadata.get('langgraph_node') != 'executor':
            return None
        text = getattr(msg, 'content', None)
        if not isinstance(text, str) or not text:
            return None
        return ServerEventSchema.token(text)
```

> Note: with `stream_mode` as a list, `astream` yields `(mode, data)` and for `messages` the `data` is itself the `(chunk, metadata)` tuple — hence `data` is a 2-tuple here, not a dict. If a provider returns list-of-content-blocks instead of a plain string, `text` will not be `str` and the chunk is skipped (acceptable: those providers fall back to the final-answer path which is removed in Task 2.3 — see the caveat in that task).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter agents test -- tests/test_graph_streaming_tokens.py -v`
Expected: PASS.

### Task 2.3: Stop emitting the final answer as a duplicate token

- [ ] **Step 5: Write the failing test — final answer is not re-emitted**

Append to `apps/agents/tests/test_graph_streaming_tokens.py`:

```python
@pytest.mark.asyncio
async def test_final_answer_not_emitted_twice():
    answer_model = GenericFakeChatModel(messages=iter([AIMessage(content='Answer A')]))

    async def executor(state: AgentState):
        ai = await answer_model.ainvoke('q')
        return {'final_answer': ai.content, 'current_step_id': None}

    g = StateGraph(AgentState)
    g.add_node('executor', executor)
    g.add_edge(START, 'executor')
    compiled = g.compile()

    initial = _minimal_state()
    config = {'configurable': {'thread_id': 'once'}}

    events = [e async for e in GraphStreamingService().stream(compiled, initial, config, initial)]
    token_chunks = [e.text for e in events if e.type == 'token']
    # streamed once from messages; NOT a second time from _yield_final_events
    assert token_chunks == ['Answer A']
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter agents test -- tests/test_graph_streaming_tokens.py::test_final_answer_not_emitted_twice -v`
Expected: FAIL — `_yield_final_events` re-emits `final.final_answer` as a `token`, so `token_chunks == ['Answer A', 'Answer A']`.

- [ ] **Step 7: Remove the final-answer token emission**

In `apps/agents/agents/apps/agent/services/graph_streaming.py`, in `_yield_final_events`, delete the two lines that emit the final answer token, keeping reasoning and citations:

```python
    async def _yield_final_events(self, graph: Any, config: RunnableConfig) -> AsyncIterator[ServerEventSchema]:
        final_snap = await graph.aget_state(config)
        if not final_snap:
            return
        final = AgentState.model_validate(final_snap.values)
        if final.final_reasoning:
            yield ServerEventSchema.thinking(text=final.final_reasoning)
        # NOTE: final_answer is no longer emitted here — it streams live from the
        # executor node via _process_messages_chunk (Phase 2). Emitting it again
        # would duplicate the whole answer.
        for c in final.citations:
            yield ServerEventSchema.citation(
                page_id=c.page_id, workspace_id=c.workspace_id,
                block_number=c.block_number, title=c.title, quote=c.quote,
            )
```

> **CAVEAT — providers that don't stream:** if a configured provider does not yield token chunks under `stream_mode="messages"` (some community wrappers), removing the final emission means no answer text reaches the client. Mitigation lives in Task 2.4 (a fallback guard). Implement 2.4 in the same commit.

### Task 2.4: Fallback — emit final answer only if nothing streamed

- [ ] **Step 8: Write the failing test — non-streaming provider still yields the answer once**

Append to `apps/agents/tests/test_graph_streaming_tokens.py` a test simulating a node that sets `final_answer` WITHOUT producing any `messages` chunk (i.e. no LLM token stream), asserting the answer is emitted exactly once via the fallback:

```python
@pytest.mark.asyncio
async def test_fallback_emits_answer_when_no_tokens_streamed():
    async def executor(state: AgentState):
        # no llm token stream at all
        return {'final_answer': 'Fallback answer', 'current_step_id': None}

    g = StateGraph(AgentState)
    g.add_node('executor', executor)
    g.add_edge(START, 'executor')
    compiled = g.compile()

    initial = _minimal_state()
    config = {'configurable': {'thread_id': 'fallback'}}

    events = [e async for e in GraphStreamingService().stream(compiled, initial, config, initial)]
    token_chunks = [e.text for e in events if e.type == 'token']
    assert token_chunks == ['Fallback answer']
```

- [ ] **Step 9: Run test to verify it fails**

Run: `pnpm --filter agents test -- tests/test_graph_streaming_tokens.py::test_fallback_emits_answer_when_no_tokens_streamed -v`
Expected: FAIL — nothing streamed and the final emission was removed, so `token_chunks == []`.

- [ ] **Step 10: Track streamed-token state and add the fallback**

In `apps/agents/agents/apps/agent/services/graph_streaming.py`, track whether any executor token was streamed, and use it to gate the fallback. Change `stream` to keep a flag and pass it to `_yield_final_events`:

In the `stream` method, initialise near `last_plan_states`:

```python
        last_plan_states: dict[str, str] = {}
        streamed_any_token = False
```

In the `messages` branch, set the flag when a token is produced:

```python
            if mode == 'messages':
                ev = self._process_messages_chunk(data)
                if ev is not None:
                    streamed_any_token = True
                    yield ev
                continue
```

Change the final call:

```python
        async for ev in self._yield_final_events(graph, config, streamed_any_token):
            yield ev
```

And update `_yield_final_events`'s signature + the guard:

```python
    async def _yield_final_events(
        self, graph: Any, config: RunnableConfig, streamed_any_token: bool,
    ) -> AsyncIterator[ServerEventSchema]:
        final_snap = await graph.aget_state(config)
        if not final_snap:
            return
        final = AgentState.model_validate(final_snap.values)
        if final.final_reasoning:
            yield ServerEventSchema.thinking(text=final.final_reasoning)
        if final.final_answer and not streamed_any_token:
            # Provider did not stream tokens — emit the whole answer once so the
            # client still receives text. When tokens streamed, this is skipped
            # to avoid duplicating the answer.
            yield ServerEventSchema.token(final.final_answer)
        for c in final.citations:
            yield ServerEventSchema.citation(
                page_id=c.page_id, workspace_id=c.workspace_id,
                block_number=c.block_number, title=c.title, quote=c.quote,
            )
```

- [ ] **Step 11: Run the token tests**

Run: `pnpm --filter agents test -- tests/test_graph_streaming_tokens.py -v`
Expected: PASS (all four tests).

- [ ] **Step 12: Run the full agents suite**

Run: `pnpm --filter agents test`
Expected: PASS. (Existing `graph_streaming` tests that asserted a single final `token` may need updating — if any now fail because the answer streams instead of arriving once, update them to concatenate `token` chunks. Show the diff; do not delete assertions wholesale.)

- [ ] **Step 13: Commit**

```bash
git add apps/agents/agents/apps/agent/services/graph_streaming.py \
        apps/agents/tests/test_graph_streaming_tokens.py
git commit -m "feat(agents): stream executor answer tokens; drop duplicate final token with non-streaming fallback"
```

---

## Phase 3 — `apps/web` registry: ordered `segments` accumulator

**Why:** the registry entry is the server-side source of truth for order. Replacing `content`/`thinking`/`blocks` with one ordered list is the keystone for the whole web side. New browser SSE event `message.segments` is introduced here (types) and emitted from entry mutations.

**Files:**
- Modify: `apps/web/src/lib/chat/types.ts` (add `OrderedSegment`, `message.segments`, segment index on delta)
- Modify: `apps/web/src/lib/chat/active-stream-registry.ts` (segments + new publish methods)
- Test: `apps/web/test/active-stream-registry.test.ts` (create)

### Task 3.1: Add segment + SSE types

- [ ] **Step 1: Add types**

In `apps/web/src/lib/chat/types.ts`, add the ordered-segment type and extend the browser SSE union. Keep `ServiceBlock` (still used by tool segments). Add after `ServiceBlock`:

```typescript
export type OrderedSegment =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; id: string; kind: 'tool' | 'confirmation'; state: ServiceBlock['state']; title: string; detail?: string; result?: string }
```

In the `WebChatSseEvent` union, change the `message.delta` member to carry a segment index and add `message.segments`:

```typescript
  | { type: 'message.delta'; assistantMessageId: string; segmentIndex: number; text: string }
  | { type: 'message.segments'; assistantMessageId: string; segments: OrderedSegment[] }
```

Leave `message.service` in place for now (removed in Phase 4 once nothing emits it). Leave `message.thinking` as-is (folded into segments in Phase 5).

- [ ] **Step 2: Type-check**

Run: `pnpm --filter web check-types`
Expected: FAIL — `active-stream-registry.ts` and `agent-sse-bridge.ts` still reference the old `publishDelta(text)`/`message.delta` shape. That's expected; fixed in this phase (registry) and Phase 4 (bridge). Proceed.

### Task 3.2: Failing test — ordered segment accumulation

- [ ] **Step 3: Write the failing test**

Create `apps/web/test/active-stream-registry.test.ts`. Assert the segment-ordering invariant: a text delta, then a tool, then another text delta, yields `[text, tool, text]` with two distinct text segments.

```typescript
import { describe, expect, it } from 'vitest'

import { createActiveStreamRegistry } from '../src/lib/chat/active-stream-registry'

function makeEntry() {
  const registry = createActiveStreamRegistry()
  return registry.create({
    assistantMessageId: 'a1',
    chatId: 'c1',
    userMessageId: 'u1',
  })
}

describe('active-stream-registry ordered segments', () => {
  it('opens a new text segment after a tool event', () => {
    const entry = makeEntry()
    entry.publishDelta('Looking… ')
    entry.publishToolStatus({ id: 't1', kind: 'tool', state: 'running', title: 'search' })
    entry.publishToolStatus({ id: 't1', kind: 'tool', state: 'done', title: 'search', result: 'ok' })
    entry.publishDelta('Found it.')

    expect(entry.segments).toEqual([
      { type: 'text', text: 'Looking… ' },
      { type: 'tool', id: 't1', kind: 'tool', state: 'done', title: 'search', result: 'ok' },
      { type: 'text', text: 'Found it.' },
    ])
  })

  it('appends consecutive text deltas into the same open segment', () => {
    const entry = makeEntry()
    entry.publishDelta('Hello ')
    entry.publishDelta('world')
    expect(entry.segments).toEqual([{ type: 'text', text: 'Hello world' }])
  })

  it('upserts a tool segment in place by id', () => {
    const entry = makeEntry()
    entry.publishToolStatus({ id: 't1', kind: 'tool', state: 'running', title: 'x' })
    entry.publishToolStatus({ id: 't1', kind: 'tool', state: 'done', title: 'x' })
    expect(entry.segments).toEqual([
      { type: 'tool', id: 't1', kind: 'tool', state: 'done', title: 'x' },
    ])
  })

  it('emits message.delta with the index of the open text segment', () => {
    const entry = makeEntry()
    const events: unknown[] = []
    entry.subscribe((e) => events.push(e))
    entry.publishToolStatus({ id: 't1', kind: 'tool', state: 'done', title: 'x' })
    entry.publishDelta('after tool')

    const delta = events.find(
      (e): e is { type: 'message.delta'; segmentIndex: number; text: string } =>
        typeof e === 'object' && e !== null && (e as { type?: string }).type === 'message.delta',
    )
    expect(delta?.segmentIndex).toBe(1)
    expect(delta?.text).toBe('after tool')
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter web test -- active-stream-registry`
Expected: FAIL — `entry.segments` and `entry.publishToolStatus` do not exist; `publishDelta` does not set a segment index.

### Task 3.3: Implement segments in the registry entry

- [ ] **Step 5: Rewrite the entry accumulator**

In `apps/web/src/lib/chat/active-stream-registry.ts`:

Update the imports and the `ActiveStreamEntry` type — replace `content`/`thinking`/`blocks` with `segments`, replace `publishDelta`/`publishThinking`/`publishBlocks` signatures:

```typescript
import type { OrderedSegment, ServiceBlock, StreamStatus, WebChatSseEvent } from './types'

type Subscriber = (event: WebChatSseEvent) => void

export type ActiveStreamEntry = {
  assistantMessageId: string
  chatId: string
  userMessageId: string
  segments: OrderedSegment[]
  status: StreamStatus
  errorMessage?: string
  upstreamTask: Promise<void> | null
  lastTouchedAt: number
  subscribe: (subscriber: Subscriber) => () => void
  publishCreated: () => void
  publishDelta: (text: string) => void
  publishThinking: (text: string) => void
  publishToolStatus: (block: Omit<ServiceBlock, never>) => void
  publishStatus: (status: StreamStatus, errorMessage?: string) => void
  publishDone: () => void
  setUpstreamTask: (task: Promise<void>) => void
  scheduleCleanup: (ttlMs?: number) => void
}
```

Initialise `segments: []` instead of the three old fields (replace the `content: ''`, `thinking: ''`, `blocks: []` initialisers).

Replace `publishDelta`, `publishThinking`, `publishBlocks` with segment-aware versions. `publishDelta` appends to a trailing open text segment or opens a new one and emits `message.delta` with that index; `publishThinking` does the same for a trailing thinking segment; `publishToolStatus` upserts by id and emits a `message.segments` snapshot:

```typescript
      publishDelta(text) {
        const last = entry.segments.at(-1)
        let index: number
        if (last && last.type === 'text') {
          last.text += text
          index = entry.segments.length - 1
        } else {
          entry.segments.push({ type: 'text', text })
          index = entry.segments.length - 1
        }
        publish({
          type: 'message.delta',
          assistantMessageId: entry.assistantMessageId,
          segmentIndex: index,
          text,
        })
      },
      publishThinking(text) {
        const last = entry.segments.at(-1)
        if (last && last.type === 'thinking') {
          last.text += text
        } else {
          entry.segments.push({ type: 'thinking', text })
        }
        publish({
          type: 'message.segments',
          assistantMessageId: entry.assistantMessageId,
          segments: structuredClone(entry.segments),
        })
      },
      publishToolStatus(block) {
        const idx = entry.segments.findIndex(
          (s) => s.type === 'tool' && s.id === block.id,
        )
        const seg: OrderedSegment = {
          type: 'tool',
          id: block.id,
          kind: block.kind,
          state: block.state,
          title: block.title,
          detail: block.detail,
          result: block.result,
        }
        if (idx >= 0) {
          entry.segments[idx] = seg
        } else {
          entry.segments.push(seg)
        }
        publish({
          type: 'message.segments',
          assistantMessageId: entry.assistantMessageId,
          segments: structuredClone(entry.segments),
        })
      },
```

> Note: `detail`/`result` keys are kept even when `undefined` to match the `OrderedSegment` shape; the test objects omit them, so strip `undefined` keys if the deep-equal fails — or assert with `expect.objectContaining`. Prefer building `seg` without `undefined` keys: only set `detail`/`result` when defined. Adjust to keep the test green.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter web test -- active-stream-registry`
Expected: PASS. (If the deep-equal fails on `undefined` keys, conditionally include `detail`/`result` in `seg` as the note says, then re-run.)

- [ ] **Step 7: Do NOT commit yet**

The type change in Task 3.1 breaks `agent-sse-bridge.ts` (it still calls the old `publishDelta`/`publishBlocks` and emits the old `message.delta`/`message.service`). Husky runs the gates (incl. `check-types`) on every commit and **must not be bypassed**, so the web side is committed as one green unit at the **end of Phase 4**. Leave the working tree dirty and proceed directly to Phase 4. (Run the registry test as the local gate for this phase — it passes in isolation.)

---

## Phase 4 — `apps/web` bridge: translate upstream events + persist segments

**Why:** wires the new registry into the agent→web translator and the debounced DB persist, and removes the dead `createAssistantParts`/`message.service` paths. Ends with `check-types` green and the whole web server-side committed as one unit.

**Files:**
- Modify: `apps/web/src/lib/chat/agent-sse-bridge.ts` (translator + persist over segments; drop `createAssistantParts`)
- Modify: `apps/web/src/lib/chat/types.ts` (remove `message.service`)
- Test: `apps/web/test/agent-sse-bridge.test.ts` (create or extend)

### Task 4.1: Persist `entry.segments`; rebuild part builders

- [ ] **Step 1: Replace `createAssistantParts` with segment passthrough**

In `apps/web/src/lib/chat/agent-sse-bridge.ts`, `createAssistantParts` previously assembled `[thinking, text, ...tools]` from the three old fields. Now the entry already holds ordered segments. Replace it:

```typescript
export function createAssistantParts(entry: ReturnType<typeof activeStreamRegistry.create>) {
  return entry.segments
}
```

The `createTextPart`/`createThinkingPart`/`createToolPart`/`createAttacmentPart` helpers are no longer used by `createAssistantParts`. Keep `createAttacmentPart` only if referenced elsewhere (grep: `grep -rn createAttacmentPart apps/web/src`); delete the now-unused text/thinking/tool builders if nothing references them. (The persisted shape is identical to a segment, so no transform is needed.)

`createDebouncedPersist` already writes `parts: createAssistantParts(args.entry)` — unchanged, now persists segments.

### Task 4.2: Translate upstream `token`/`tool_status` into segment mutations

- [ ] **Step 2: Write the failing test**

Create `apps/web/test/agent-sse-bridge.test.ts`. Drive `handleAgentEvent` (export it if not already exported) with a `token`, `tool_status`(running/done), `token` sequence and assert the entry's segments interleave.

First ensure `handleAgentEvent` and `AgentRunSseEvent` are exported from `agent-sse-bridge.ts` (add `export` to `function handleAgentEvent` and `type AgentRunSseEvent`). Then:

```typescript
import { describe, expect, it } from 'vitest'

import { createActiveStreamRegistry } from '../src/lib/chat/active-stream-registry'
import { createDebouncedPersist, handleAgentEvent } from '../src/lib/chat/agent-sse-bridge'

// createDebouncedPersist touches prisma; stub schedule/flush to no-ops for unit scope.
function fakePersist() {
  return { schedule() {}, async flush() {} }
}

function makeEntry() {
  return createActiveStreamRegistry().create({
    assistantMessageId: 'a1',
    chatId: 'c1',
    userMessageId: 'u1',
  })
}

describe('agent-sse-bridge translates upstream events to ordered segments', () => {
  it('interleaves token → tool → token', () => {
    const entry = makeEntry()
    const flush = fakePersist() as ReturnType<typeof createDebouncedPersist>

    handleAgentEvent({ type: 'token', text: 'Looking… ' }, entry, flush)
    handleAgentEvent(
      { type: 'tool_status', id: 't1', tool: 'search', state: 'running', title: 'search' },
      entry,
      flush,
    )
    handleAgentEvent(
      { type: 'tool_status', id: 't1', tool: 'search', state: 'done', title: 'search', detail: 'ok' },
      entry,
      flush,
    )
    handleAgentEvent({ type: 'token', text: 'Found.' }, entry, flush)

    expect(entry.segments.map((s) => s.type)).toEqual(['text', 'tool', 'text'])
    expect(entry.segments[0]).toMatchObject({ type: 'text', text: 'Looking… ' })
    expect(entry.segments[1]).toMatchObject({ type: 'tool', id: 't1', state: 'done' })
    expect(entry.segments[2]).toMatchObject({ type: 'text', text: 'Found.' })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter web test -- agent-sse-bridge`
Expected: FAIL — `handleAgentEvent`'s `token` case calls `entry.publishDelta` (now segment-aware, OK) but the `tool_status` case calls `entry.publishBlocks(upsertServiceBlock(entry.blocks, …))`, and `entry.blocks` no longer exists → type error / runtime error.

- [ ] **Step 4: Rewire `handleAgentEvent` tool paths to `publishToolStatus`**

In `apps/web/src/lib/chat/agent-sse-bridge.ts`, the `tool_status`, `plan_step`, `step_started`, `step_completed`, and `confirmation_required` cases all mutate `entry.blocks` via `upsertServiceBlock`. Replace `entry.blocks` bookkeeping with `entry.publishToolStatus(...)`, which now owns upsert-by-id. Update each case:

```typescript
    case 'tool_status':
      entry.publishToolStatus({
        id: event.id,
        kind: 'tool',
        state: event.state,
        title: event.title,
        detail: event.detail,
      })
      flush.schedule()
      return false
    case 'plan_step':
      entry.publishToolStatus({
        id: `plan-${event.id}`,
        kind: 'tool',
        state: mapPlanStepStatus(event.status),
        title: event.title,
      })
      return false
    case 'step_started':
      updateExistingPlanBlock(entry, event.step_id, { state: 'running' })
      return false
    case 'step_completed':
      updateExistingPlanBlock(entry, event.step_id, {
        state: 'done',
        result: event.result_summary,
      })
      return false
    case 'confirmation_required':
      entry.publishToolStatus({
        id: event.confirmation_id,
        kind: 'confirmation',
        state: 'required',
        title: event.summary,
        detail: JSON.stringify({
          confirmation_id: event.confirmation_id,
          tool: event.tool,
          summary: event.summary,
          args_preview: event.args_preview,
        }),
      })
      return false
```

Rewrite `updateExistingPlanBlock` to read the current tool segment from `entry.segments` and re-publish it merged:

```typescript
function updateExistingPlanBlock(
  entry: EntryHandle,
  stepId: string,
  patch: Partial<ServiceBlock>,
): void {
  const planBlockId = `plan-${stepId}`
  const existing = entry.segments.find(
    (s): s is Extract<OrderedSegment, { type: 'tool' }> =>
      s.type === 'tool' && s.id === planBlockId,
  )
  if (!existing) return
  entry.publishToolStatus({
    id: existing.id,
    kind: existing.kind,
    state: patch.state ?? existing.state,
    title: existing.title,
    detail: patch.detail ?? existing.detail,
    result: patch.result ?? existing.result,
  })
}
```

Delete the now-unused `upsertServiceBlock` helper. Update the imports at the top of the file to include `OrderedSegment`:

```typescript
import type { OrderedSegment, ServiceBlock, WebChatSseEvent } from './types'
```

The `translateAgentEvent` function (handles `thinking` → `message.thinking`) stays as-is for now; `message.thinking` is consumed client-side and folded into a thinking segment in Phase 5. The `token` case still calls `entry.publishDelta(event.text)` — already segment-aware.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter web test -- agent-sse-bridge`
Expected: PASS.

### Task 4.3: Remove the dead `message.service` event

- [ ] **Step 6: Drop `message.service` from the union**

In `apps/web/src/lib/chat/types.ts`, remove the `message.service` member from `WebChatSseEvent` (nothing emits it now — tool updates flow via `message.segments`). Grep to confirm no emitter remains:

Run: `grep -rn "message.service" apps/web/src`
Expected: only the client consumer in `use-chat-stream.ts` remains (removed in Phase 5). If the bridge or registry still references it, remove those references.

> If `use-chat-stream.ts` referencing `message.service` causes `check-types` to fail now, that's handled in Phase 5. To keep this phase's commit green, temporarily keep the `message.service` case in `use-chat-stream.ts` as a no-op that does nothing (it will be deleted in Phase 5). Add `case 'message.service': return` if needed so the switch still compiles without the union member — but since removing the union member makes that case a type error, instead **defer** the union removal: comment out the `message.service` line in `types.ts` with a `// removed — see Phase 5` marker and delete it fully in Phase 5 after the consumer is gone. Choose whichever keeps `check-types` green; the end state (Phase 5) is identical.

### Task 4.4: Green the web server-side and commit

- [ ] **Step 7: Type-check the whole web app**

Run: `pnpm --filter web check-types`
Expected: PASS. If `use-chat-stream.ts` errors on `message.delta` (now needs `segmentIndex`) or `message.service`, apply the minimal deferral from the Task 4.3 note so it compiles; the full client rewrite is Phase 5. The bar for this commit: types pass, bridge + registry tests pass.

- [ ] **Step 8: Run the web unit suite**

Run: `pnpm --filter web test`
Expected: PASS (registry + bridge tests included). Pre-existing `chat-message-mappers.test.ts` still passes here because Phase 5 hasn't touched it yet.

- [ ] **Step 9: Commit the web server-side as one green unit**

```bash
git add apps/web/src/lib/chat/types.ts \
        apps/web/src/lib/chat/active-stream-registry.ts \
        apps/web/src/lib/chat/agent-sse-bridge.ts \
        apps/web/test/active-stream-registry.test.ts \
        apps/web/test/agent-sse-bridge.test.ts
git commit -m "feat(chat): translate upstream token/tool_status into ordered segments + persist them"
```

---

## Phase 5 — `apps/web` client: segment-ordered mappers + `use-chat-stream`

**Why:** the browser must apply token deltas by segment index and replace the whole segment list from `message.segments` snapshots, render in array order, and stay compatible with old persisted messages. Optimistic UI / reconciliation / error-recovery are preserved.

**Files:**
- Modify: `apps/web/src/components/workspace/chat/chat-message-mappers.ts`
- Modify: `apps/web/src/components/workspace/chat/use-chat-stream.ts`
- Modify: `apps/web/test/chat-message-mappers.test.ts` (update order assertions + new tests)

### Task 5.1: Replace merge reducers with segment reducers

- [ ] **Step 1: Update the existing order test to expect chronological order**

In `apps/web/test/chat-message-mappers.test.ts`, the test `preserves server order (thinking before text)` already asserts array order is preserved — keep it. Add a new test asserting an interleaved persisted message round-trips unchanged (no re-grouping):

```typescript
describe('segment order is preserved (no type grouping)', () => {
  it('keeps an interleaved text/tool/text message in array order', () => {
    const msg = mapServerMessageToThreadMessage(
      makeServerMessage({
        parts: [
          { type: 'text', text: 'first' },
          { type: 'tool', id: 't1', kind: 'tool', state: 'done', title: 'search' },
          { type: 'text', text: 'second' },
        ],
      }),
    )
    expect(msg.parts.map((p) => p.type)).toEqual(['text', 'tool', 'text'])
  })
})
```

- [ ] **Step 2: Add segment-delta + snapshot reducer tests**

Append to `apps/web/test/chat-message-mappers.test.ts`:

```typescript
import {
  appendAssistantTextDelta,
  replaceAssistantSegments,
} from '../src/components/workspace/chat/chat-message-mappers'

describe('appendAssistantTextDelta', () => {
  it('appends into the text segment at the given index, creating it if absent', () => {
    const msgs = [makeThreadMessage({ parts: [] })]
    const afterFirst = appendAssistantTextDelta(msgs, 'a1', 0, 'Hello ')
    const afterSecond = appendAssistantTextDelta(afterFirst, 'a1', 0, 'world')
    expect(afterSecond[0]?.parts).toEqual([{ type: 'text', text: 'Hello world' }])
  })

  it('targets a later segment index without touching earlier ones', () => {
    const msgs = [
      makeThreadMessage({
        parts: [
          { type: 'text', text: 'intro' },
          { type: 'tool', id: 't1', kind: 'tool', state: 'done', title: 'x' },
        ],
      }),
    ]
    const next = appendAssistantTextDelta(msgs, 'a1', 2, 'after tool')
    expect(next[0]?.parts).toEqual([
      { type: 'text', text: 'intro' },
      { type: 'tool', id: 't1', kind: 'tool', state: 'done', title: 'x' },
      { type: 'text', text: 'after tool' },
    ])
  })
})

describe('replaceAssistantSegments', () => {
  it('replaces parts wholesale from a snapshot', () => {
    const msgs = [makeThreadMessage({ parts: [{ type: 'text', text: 'stale' }] })]
    const next = replaceAssistantSegments(msgs, 'a1', [
      { type: 'text', text: 'fresh' },
      { type: 'tool', id: 't1', kind: 'tool', state: 'running', title: 'x' },
    ])
    expect(next[0]?.parts).toEqual([
      { type: 'text', text: 'fresh' },
      { type: 'tool', id: 't1', kind: 'tool', state: 'running', title: 'x' },
    ])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter web test -- chat-message-mappers`
Expected: FAIL — `appendAssistantTextDelta` and `replaceAssistantSegments` are not exported yet; the interleave test fails because `mapServerMessageToThreadMessage` still routes tools to the end via `withToolParts`.

- [ ] **Step 4: Implement the segment reducers; stop re-grouping**

In `apps/web/src/components/workspace/chat/chat-message-mappers.ts`:

Import `OrderedSegment` from types (it's a UI-side type; mirror it locally to avoid a cross-package import if `@repo/ui` doesn't export it — define a local alias matching `ChatMessagePart` minus attachments). Simplest: reuse `ChatMessagePart` for the snapshot type since segments are a subset.

Add the two reducers:

```typescript
export function appendAssistantTextDelta(
  messages: ChatThreadMessage[],
  assistantMessageId: string,
  segmentIndex: number,
  text: string,
): ChatThreadMessage[] {
  if (!messages.some((message) => message.id === assistantMessageId)) {
    return messages
  }
  return messages.map((message) => {
    if (message.id !== assistantMessageId) {
      return message
    }
    const nextParts = [...message.parts]
    const existing = nextParts[segmentIndex]
    if (existing && existing.type === 'text') {
      nextParts[segmentIndex] = { ...existing, text: existing.text + text }
    } else {
      // index points past the end (or at a non-text slot): append a new text segment
      nextParts[segmentIndex] = { type: 'text', text }
    }
    return {
      ...message,
      parts: nextParts,
      status: 'streaming',
      updatedAt: new Date().toISOString(),
    }
  })
}

export function replaceAssistantSegments(
  messages: ChatThreadMessage[],
  assistantMessageId: string,
  segments: ChatMessagePart[],
): ChatThreadMessage[] {
  if (!messages.some((message) => message.id === assistantMessageId)) {
    return messages
  }
  return messages.map((message) =>
    message.id === assistantMessageId
      ? { ...message, parts: [...segments], updatedAt: new Date().toISOString() }
      : message,
  )
}
```

> Note: `appendAssistantTextDelta` assigning `nextParts[segmentIndex]` when `segmentIndex === nextParts.length` extends the array by one (JS arrays allow index===length assignment). If `segmentIndex > length` it would create holes — in practice the registry only ever emits the current open-text index (always `length-1` or `length`), so this is safe. Do not add hole-filling logic (YAGNI).

Remove `appendAssistantText` (the old merge-into-first-text reducer) and `appendAssistantThinking`'s text-merging is replaced by snapshot application; if `appendAssistantThinking` is still referenced by `use-chat-stream` for `message.thinking`, keep a thin version that appends a thinking segment at the end (mirrors registry `publishThinking`):

```typescript
export function appendAssistantThinking(
  messages: ChatThreadMessage[],
  assistantMessageId: string,
  text: string,
): ChatThreadMessage[] {
  if (!messages.some((message) => message.id === assistantMessageId)) {
    return messages
  }
  return messages.map((message) => {
    if (message.id !== assistantMessageId) {
      return message
    }
    const nextParts = [...message.parts]
    const last = nextParts.at(-1)
    if (last && last.type === 'thinking') {
      nextParts[nextParts.length - 1] = { ...last, text: last.text + text }
    } else {
      nextParts.push({ type: 'thinking', text })
    }
    return { ...message, parts: nextParts, status: 'streaming', updatedAt: new Date().toISOString() }
  })
}
```

Remove `replaceAssistantToolBlocks`, `stripToolParts`, `toToolParts`, and the `withToolParts` call inside `mapServerMessageToThreadMessage`. Update `mapServerMessageToThreadMessage` to keep `parts` in order (only append the generated error part on ERROR):

```typescript
export function mapServerMessageToThreadMessage(message: ServerChatMessage): ChatThreadMessage {
  const parts = [...message.parts]
  if (message.status === 'ERROR' && message.errorMessage) {
    parts.push(createErrorStatusPart(message.id, message.errorMessage))
  }
  return {
    id: message.id,
    role: mapRole(message.role),
    status: mapStatus(message.status),
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    parts,
  }
}
```

Keep `createErrorStatusPart`, `updateAssistantStatus` (used for terminal ERROR in `use-chat-stream`), `reconcileOptimisticIds`, `markAssistantErrored`, `createPendingMessagePair`, `appendPendingMessagePair`, `findResumableAssistantMessageId`, `findAssistantMessageIdByBlockId`. In `updateAssistantStatus`, the `withToolParts(...)` call for appending the error part must be replaced with a plain push:

```typescript
    const terminalParts =
      args.status === 'ERROR' && args.errorMessage
        ? [...partsWithoutGeneratedError, createErrorStatusPart(message.id, args.errorMessage)]
        : partsWithoutGeneratedError
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter web test -- chat-message-mappers`
Expected: PASS.

### Task 5.2: Wire `use-chat-stream` to the new events

- [ ] **Step 6: Update the stream handler**

In `apps/web/src/components/workspace/chat/use-chat-stream.ts`, update `applyEvent`:

- `message.delta` → pass the segment index:

```typescript
      case 'message.delta': {
        activeAssistantMessageIdRef.current = event.assistantMessageId
        setMessages((current) =>
          appendAssistantTextDelta(current, event.assistantMessageId, event.segmentIndex, event.text),
        )
        return
      }
```

- Add `message.segments`:

```typescript
      case 'message.segments': {
        activeAssistantMessageIdRef.current = event.assistantMessageId
        setMessages((current) =>
          replaceAssistantSegments(current, event.assistantMessageId, event.segments),
        )
        return
      }
```

- Remove the `message.service` case (the event no longer exists). `message.thinking` stays, still calling `appendAssistantThinking`.

Update the imports from `chat-message-mappers` accordingly (drop `appendAssistantText`/`replaceAssistantToolBlocks`, add `appendAssistantTextDelta`/`replaceAssistantSegments`).

- [ ] **Step 7: Finish removing `message.service` from types**

If deferred in Phase 4, now delete the `message.service` line from `WebChatSseEvent` in `apps/web/src/lib/chat/types.ts`. Confirm:

Run: `grep -rn "message.service" apps/web/src`
Expected: no matches.

- [ ] **Step 8: Type-check + unit suite**

Run: `pnpm --filter web check-types`
Expected: PASS.
Run: `pnpm --filter web test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/workspace/chat/chat-message-mappers.ts \
        apps/web/src/components/workspace/chat/use-chat-stream.ts \
        apps/web/src/lib/chat/types.ts \
        apps/web/test/chat-message-mappers.test.ts
git commit -m "feat(chat): segment-ordered client reducers; apply token deltas by index, replace from snapshots"
```

---

## Phase 6 — `packages/ui`: MUI Timeline with coloured dots

**Why:** the user-visible payoff (request items 1 & 2). Render parts strictly in array order inside `@mui/lab` `<Timeline>`; the dot colour encodes tool state; remove the textual state label.

**Files:**
- Modify: `packages/ui/package.json` (add `@mui/lab`)
- Modify: `packages/ui/src/components/index.ts` (re-export Timeline primitives)
- Modify: `packages/ui/src/components/chat/chat-message-content.tsx` (Timeline, array order)
- Modify: `packages/ui/src/components/chat/chat-service-block.tsx` (drop state label)
- Test: `packages/ui/test/chat-service-block.test.tsx` (update label assertion + add dot-colour assertion via a new small helper export)

### Task 6.1: Add `@mui/lab` and re-export Timeline

- [ ] **Step 1: Install `@mui/lab`**

Run: `pnpm --filter @repo/ui add @mui/lab@^7.0.0-beta.0`
(Use the version that resolves against the installed `@mui/material@^7.3.10`; `@mui/lab` for MUI v7 is published under the `7.x` beta line. If `^7.0.0-beta.0` does not resolve, run `pnpm view @mui/lab versions --json` and pick the highest `7.x` tag, then pin it.)

- [ ] **Step 2: Re-export Timeline primitives through the UI barrel**

In `packages/ui/src/components/index.ts`, add (follow the existing `export { default as X, type XProps } from '@mui/material/...'` pattern, but from `@mui/lab/...`):

```typescript
export { default as Timeline, type TimelineProps } from '@mui/lab/Timeline'
export { default as TimelineItem, type TimelineItemProps } from '@mui/lab/TimelineItem'
export { default as TimelineSeparator, type TimelineSeparatorProps } from '@mui/lab/TimelineSeparator'
export { default as TimelineConnector, type TimelineConnectorProps } from '@mui/lab/TimelineConnector'
export { default as TimelineContent, type TimelineContentProps } from '@mui/lab/TimelineContent'
export { default as TimelineDot, type TimelineDotProps } from '@mui/lab/TimelineDot'
```

- [ ] **Step 3: Type-check the UI package**

Run: `pnpm --filter @repo/ui check-types`
Expected: PASS (imports resolve). If `@mui/lab` ships its own peer of `@mui/material` that mismatches, pnpm will warn — resolve by aligning versions, not by `--force`.

### Task 6.2: Dot-colour helper (pure, unit-testable)

- [ ] **Step 4: Write the failing test for the colour mapping**

In `packages/ui/test/chat-service-block.test.tsx`, add a test importing a new pure helper `toolDotColor` (exported from `chat-service-block.tsx`):

```typescript
import { toolDotColor } from '../src/components/chat/chat-service-block'

describe('toolDotColor', () => {
  it('maps tool state to timeline dot colour', () => {
    expect(toolDotColor('running')).toBe('grey')
    expect(toolDotColor('pending')).toBe('grey')
    expect(toolDotColor('done')).toBe('primary')
    expect(toolDotColor('error')).toBe('error')
    expect(toolDotColor('required')).toBe('warning')
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @repo/ui test -- chat-service-block`
Expected: FAIL — `toolDotColor` is not exported.

- [ ] **Step 6: Implement `toolDotColor` and drop the state label**

In `packages/ui/src/components/chat/chat-service-block.tsx`:

Add the exported helper near the top (replaces the role of `getStateLabel`; keep colours aligned with MUI `TimelineDot` `color` values which include `'grey' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning' | 'inherit'`):

```typescript
export function toolDotColor(
  state: ChatToolPart['state'],
): 'grey' | 'primary' | 'error' | 'warning' {
  switch (state) {
    case 'done':
      return 'primary'
    case 'error':
      return 'error'
    case 'required':
      return 'warning'
    default:
      return 'grey'
  }
}
```

Delete `getStateLabel` and remove the meta `<Typography>` that printed `{getStateLabel(part.state)}`. Keep the tool name. The summary row becomes just the title + (optional tool name) + expand chevron:

```typescript
        <Typography
          color="text.secondary"
          component="span"
          sx={{ flexShrink: 0, fontSize: 12.5 }}
        >
          {detail.tool ?? ''}
        </Typography>
```

(If `detail.tool` is empty, this renders nothing — acceptable.)

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @repo/ui test -- chat-service-block`
Expected: PASS for `toolDotColor`. The existing test `renders the tool name and state label in the meta column` will now FAIL because the state label is gone — update it in the next step.

- [ ] **Step 8: Update the stale state-label test**

In `packages/ui/test/chat-service-block.test.tsx`, find the test asserting the state label (`/Done/` or similar in the meta column) and change it to assert only the tool name is rendered and the label is absent:

```typescript
  it('renders the tool name without a textual state label', () => {
    render(
      <ChatServiceBlock
        part={part({ state: 'done', detail: JSON.stringify({ tool: 'search_workspace_pages' }) })}
      />,
    )
    expect(screen.getByText('search_workspace_pages')).toBeInTheDocument()
    expect(screen.queryByText('Done')).not.toBeInTheDocument()
  })
```

Run: `pnpm --filter @repo/ui test -- chat-service-block`
Expected: PASS (all).

### Task 6.3: Render parts in a Timeline, in array order

- [ ] **Step 9: Add a Timeline render test**

In a new test file `packages/ui/test/chat-message-content.test.tsx`, assert that an interleaved parts array renders text and tool content in DOM order and that a tool dot reflects state. Keep it light (structure, not pixel colour):

```typescript
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ChatMessageContent } from '../src/components/chat/chat-message-content'
import type { ChatMessagePart } from '../src/components/chat/chat-types'

describe('ChatMessageContent timeline order', () => {
  it('renders parts in array order (no type grouping)', () => {
    const parts: ChatMessagePart[] = [
      { type: 'text', text: 'first answer' },
      { type: 'tool', id: 't1', kind: 'tool', state: 'done', title: 'search' },
      { type: 'text', text: 'second answer' },
    ]
    render(<ChatMessageContent parts={parts} />)
    const text = screen.getByText('first answer').compareDocumentPosition(
      screen.getByText('second answer'),
    )
    // FOLLOWING bit set → "second answer" comes after "first answer"
    expect(text & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
```

- [ ] **Step 10: Run test to verify it fails**

Run: `pnpm --filter @repo/ui test -- chat-message-content`
Expected: FAIL — current `chat-message-content.tsx` sorts by type; with these parts the order happens to be preserved, so this specific test may PASS by accident. To make the test meaningful, reorder the fixture so grouping WOULD change it: put a tool BEFORE the first text:

```typescript
    const parts: ChatMessagePart[] = [
      { type: 'tool', id: 't1', kind: 'tool', state: 'done', title: 'search' },
      { type: 'text', text: 'answer after tool' },
    ]
    render(<ChatMessageContent parts={parts} />)
    // Under the OLD type-sort, text (order 1) would render before tool (order 2),
    // i.e. "answer after tool" would come FIRST. Assert the tool comes first.
    const toolTitle = screen.getByText('search')
    const answer = screen.getByText('answer after tool')
    expect(
      toolTitle.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
```

Re-run; expected FAIL under the current type-sort (text would precede the tool).

- [ ] **Step 11: Rewrite `chat-message-content.tsx` to a Timeline in array order**

Replace the body of `packages/ui/src/components/chat/chat-message-content.tsx`. Remove `getPartOrder` and the sort; wrap parts in `<Timeline>`. Import Timeline primitives from the local barrel-free `@mui/lab` paths (this file lives inside `@repo/ui`, so it may import `@mui/lab/*` directly — the no-`@mui/*`-in-app-code rule applies to *app* code, not to `@repo/ui` internals):

```typescript
'use client'

import Box from '@mui/material/Box'
import Timeline from '@mui/lab/Timeline'
import TimelineConnector from '@mui/lab/TimelineConnector'
import TimelineContent from '@mui/lab/TimelineContent'
import TimelineDot from '@mui/lab/TimelineDot'
import TimelineItem from '@mui/lab/TimelineItem'
import TimelineSeparator from '@mui/lab/TimelineSeparator'
import { timelineItemClasses } from '@mui/lab/TimelineItem'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'

import { ChatFileChip } from './chat-file-chip'
import { ChatServiceBlock, toolDotColor } from './chat-service-block'
import { ChatThinkingBlock } from './chat-thinking-block'
import type { ChatConfirmHandler, ChatMessagePart } from './chat-types'

export type ChatRenderLink = (href: string, children: ReactNode) => ReactNode

type ChatMessageContentProps = Readonly<{
  parts: ChatMessagePart[]
  renderLink?: ChatRenderLink
  onConfirm?: ChatConfirmHandler
}>

function linkifyWorkspacePageReferences(text: string): string {
  return text.replace(
    /(здесь)\s*:\s*(\/workspaces\/[0-9a-f-]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{12}\/pages\/[0-9a-f-]{8}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{4}-[0-9a-f-]{12})/giu,
    '[$1]($2)',
  )
}

function dotColorForPart(part: ChatMessagePart): TimelineDotColor {
  return part.type === 'tool' ? toolDotColor(part.state) : 'grey'
}

type TimelineDotColor = 'grey' | 'primary' | 'error' | 'warning'

// eslint-disable-next-line react/prop-types -- plugin can't unwrap Readonly<> generic
export function ChatMessageContent({ parts, renderLink, onConfirm }: ChatMessageContentProps) {
  const markdownComponents = renderLink
    ? {
        a: ({ href, children }: { href?: string; children?: ReactNode }) =>
          href ? <>{renderLink(href, children)}</> : <>{children}</>,
      }
    : undefined

  return (
    <Timeline
      sx={{
        m: 0,
        p: 0,
        // left-align: drop the default left "opposite content" column
        [`& .${timelineItemClasses.root}:before`]: { flex: 0, p: 0 },
      }}
    >
      {parts.map((part, index) => {
        const isLast = index === parts.length - 1
        return (
          <TimelineItem key={part.type === 'tool' ? part.id : `${part.type}-${index}`}>
            <TimelineSeparator>
              <TimelineDot color={dotColorForPart(part)} variant="outlined" />
              {isLast ? null : <TimelineConnector />}
            </TimelineSeparator>
            <TimelineContent sx={{ pb: 1.25, pt: 0 }}>
              {part.type === 'thinking' ? <ChatThinkingBlock text={part.text} /> : null}
              {part.type === 'text' ? (
                <Box
                  sx={{
                    '& code': { bgcolor: 'action.hover', borderRadius: 1, px: 0.5, py: 0.125 },
                    '& ol, & ul': { m: 0, pl: 3 },
                    '& p': { m: 0 },
                    '& p + p': { mt: 1 },
                    '& pre': {
                      bgcolor: 'grey.100',
                      borderRadius: 2,
                      m: 0,
                      overflowX: 'auto',
                      p: 1,
                    },
                    '& strong': { fontWeight: 600 },
                    overflowWrap: 'anywhere',
                  }}
                >
                  <ReactMarkdown components={markdownComponents}>
                    {linkifyWorkspacePageReferences(part.text)}
                  </ReactMarkdown>
                </Box>
              ) : null}
              {part.type === 'attacment' ? (
                <ChatFileChip
                  href={part.downloadUrl}
                  name={part.name}
                  secondaryLabel={part.fileSize}
                />
              ) : null}
              {part.type === 'tool' ? (
                <ChatServiceBlock onConfirm={onConfirm} part={part} />
              ) : null}
            </TimelineContent>
          </TimelineItem>
        )
      })}
    </Timeline>
  )
}
```

> Note: `variant="outlined"` keeps neutral (text/thinking) dots subtle while still tinting tool dots by `color`. If the design reads better with filled dots, drop `variant="outlined"` — purely cosmetic, decide during manual verification (Phase 7).

- [ ] **Step 12: Run the content + service-block tests**

Run: `pnpm --filter @repo/ui test -- chat-message-content chat-service-block`
Expected: PASS.

- [ ] **Step 13: Type-check + lint the UI package**

Run: `pnpm --filter @repo/ui check-types`
Expected: PASS.
Run: `pnpm --filter @repo/ui lint`
Expected: PASS (fix any unused-import warnings from the removed `getPartOrder`/`getStateLabel`).

- [ ] **Step 14: Commit**

```bash
git add packages/ui/package.json packages/ui/src/components/index.ts \
        packages/ui/src/components/chat/chat-message-content.tsx \
        packages/ui/src/components/chat/chat-service-block.tsx \
        packages/ui/test/chat-service-block.test.tsx \
        packages/ui/test/chat-message-content.test.tsx \
        pnpm-lock.yaml
git commit -m "feat(chat): render assistant timeline with state-coloured dots in @mui/lab"
```

---

## Phase 7 — Integration, full gates, Playwright E2E + manual verification

**Why:** the unit tests in Phases 1–6 prove each layer in isolation; this phase proves the whole pipeline together, runs the merge gate, and resolves the one observation-gated UI decision (flat tool segments vs nesting under plan steps). Request item 3 ("verify with Playwright").

**Files:**
- Modify: `apps/e2e/chat-timeline.spec.ts` (create) — or extend the existing chat spec
- Possibly modify: `packages/ui/src/components/chat/chat-message-content.tsx` (only if the flat-vs-nested decision requires it)

### Task 7.1: Full merge gate

- [ ] **Step 1: Run the merge gate across the monorepo**

Run: `pnpm gates`
Expected: PASS (`check-types` + `lint` + `build` + `test` across all workspaces). Fix anything that regressed. Common offender: `apps/web` `check-types` if any `message.service`/old-reducer reference survived — grep and remove.

> Per memory `feedback_web_stale_next_types`: if web `check-types` reports `TS2307 cannot find module '.../route.js'` for a route you did not touch, it's a stale `.next/types` artifact — `rm -rf apps/web/.next/types` and re-run, it's not a real break.

### Task 7.2: Observation-gated decision — flat tools vs nested under plan steps

- [ ] **Step 2: Observe one real run and decide**

Start the stack and run one real chat that triggers tooling:

```bash
docker compose up -d
pnpm --filter @repo/yjs-server dev &   # if the chat path needs it; otherwise skip
pnpm --filter agents dev &
pnpm --filter engines dev &
pnpm --filter web dev
```

Open a workspace chat, send a prompt that forces a tool call (e.g. "найди страницы про X и сделай сводку"). Watch the Timeline. Decide:
- If `plan_step` blocks (`plan-*`) and real `tool_status` blocks both appear and read as duplicates/noise, choose **one**: either suppress `plan_step` tool segments in the UI (filter `part.id.startsWith('plan-')` in `chat-message-content.tsx`) OR keep plan steps and suppress tool_status. Document the choice in a one-line code comment.
- If they read as complementary (plan = coarse, tools = fine), keep both flat.

This is a judgement call on real output — the spec deliberately deferred it. Make the minimal change, re-run the affected `@repo/ui` test if you filtered, and commit separately:

```bash
git add packages/ui/src/components/chat/chat-message-content.tsx
git commit -m "feat(chat): <flat tools | suppress plan-step dupes> after observing live timeline"
```

(Skip the commit if no change was needed.)

### Task 7.3: Playwright E2E

- [ ] **Step 3: Write the E2E spec**

Per memory (`feedback_e2e_no_yjs_persistence`, `project_workspace_chat_expansion`): the Playwright `webServer` is just `next dev` with **no agents backend**, so a live streamed run is not reproducible in E2E. Two-part strategy:

(a) **Renderer assertion against seeded data** — the reliable, CI-safe part. Reuse the harness from `apps/e2e/chat-expansion.spec.ts` (the one confirmed green at 3/3). Seed or drive the chat UI to a message whose `parts` are an interleaved `[text, tool, text]` (via the same mechanism `chat-expansion.spec.ts` uses to populate chat — follow that spec; do not invent a new seeding path). Assert:
- the tool row and the later text appear in DOM order (tool before second text),
- a tool in `error` state renders a red dot, a `done` tool renders a primary dot.

```typescript
import { expect, test } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

test('assistant timeline renders interleaved parts with state-coloured dots', async ({ page }) => {
  await signUpAndAuthAs(page)
  // TODO(executor): reach a chat showing an interleaved assistant message using
  // the SAME navigation/seeding the green chat-expansion.spec.ts uses. Mirror it.
  // Then assert order + dot colours. Example assertions once the message is visible:
  const toolRow = page.getByText('search', { exact: false }).first()
  const laterText = page.getByText('second answer', { exact: false })
  await expect(toolRow).toBeVisible()
  await expect(laterText).toBeVisible()
  // MUI TimelineDot colour classes: .MuiTimelineDot-colorError / -colorPrimary
  await expect(page.locator('.MuiTimelineDot-colorError')).toHaveCount(0) // adjust to fixture
})
```

> The `TODO(executor)` is intentional scaffolding, not a placeholder to ship: the executor must wire the seeding exactly as `chat-expansion.spec.ts` does (that spec is the source of truth for how to get an assistant message on screen in E2E). Read it first, mirror its setup, then fill the assertions. Do not fabricate a seeding API.

(b) **Live stream — manual via Playwright MCP** — covered in Task 7.4 (not in CI).

- [ ] **Step 4: Run the spec warm**

Per memory (`feedback_e2e_cold_compile_retries`, `feedback_e2e_cold_worktree_parallel_meltdown`): cold compile flakes the signup step. Run with retries so attempt-1 warms the shared server, and run this spec in isolation (not the full suite in parallel):

Run: `pnpm exec playwright test apps/e2e/chat-timeline.spec.ts --retries=2`
Expected: PASS (possibly on retry #1 after warm compile).

- [ ] **Step 5: Commit the E2E spec**

```bash
git add apps/e2e/chat-timeline.spec.ts
git commit -m "test(e2e): assert assistant timeline order and state-coloured dots"
```

### Task 7.4: Manual live verification (Playwright MCP browser)

- [ ] **Step 6: Verify the real streamed timeline by hand**

With the full stack running (Task 7.2), drive the real chat via the Playwright MCP browser tools (`browser_navigate`, `browser_snapshot`, `browser_take_screenshot`) — this exercises the actual agents SSE stream that E2E cannot. Confirm, against the spec's acceptance:
1. While a tool runs, its dot is **grey**; on completion it turns **primary**; a forced failure turns it **red**.
2. Text and tool entries appear **interleaved top-to-bottom in arrival order** — a text segment that the model emits after a tool appears **below** that tool, as its own timeline entry (not hoisted above).
3. The final answer is the **last** timeline entry.
4. After the stream ends and the post-stream `getChat` refetch runs, the timeline does **not** flicker, reorder, or duplicate (the persisted segment order matches the live order).

Capture a screenshot for the record. If any of 1–4 fail, that's a real bug — fix in the owning phase's files and re-run that phase's tests before re-verifying. Do not mark the plan complete until 1–4 hold on a live run.

### Task 7.5: Final state

- [ ] **Step 7: Re-run the full gate once more**

Run: `pnpm gates`
Expected: PASS.

- [ ] **Step 8: Confirm the working tree is clean and summarise**

Run: `git status --short`
Expected: clean (all changes committed across the phase commits).

The feature is complete when: `pnpm gates` is green, the E2E spec passes warm, and the four manual live-verification criteria (Task 7.4) hold.

---

## Spec coverage map

- **Request 1 (tool colours grey/primary/red):** Phase 6 Task 6.2 (`toolDotColor`) + Task 6.3 (dot wired into Timeline); verified Phase 7 Task 7.4(1).
- **Request 2 (Timeline, interleaved top-to-bottom, text inline):** Phases 1–5 produce/accumulate the interleaved segment stream; Phase 6 Task 6.3 renders it in array order inside `<Timeline>`; verified Phase 7 Tasks 7.3 + 7.4(2,3).
- **Request 3 (verify with Playwright):** Phase 7 Tasks 7.3 (CI renderer spec) + 7.4 (manual live via Playwright MCP).
- **Spec Layer 1 (agents token + tool_status):** Phases 1–2.
- **Spec Layer 2 (web registry/bridge/persist segments):** Phases 3–4.
- **Spec Layer 3 (client mappers + use-chat-stream):** Phase 5.
- **Spec Layer 4 (UI @mui/lab Timeline):** Phase 6.
- **Backward-compat (no migration):** Phase 5 Task 5.1 (`mapServerMessageToThreadMessage` keeps array order; old `[thinking,text,tools]` rows render as-is).
- **Observation-gated flat-vs-nested:** Phase 7 Task 7.2.
