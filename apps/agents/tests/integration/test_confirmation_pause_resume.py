"""Integration test: confirmation interrupt pause + resume across requests."""

from __future__ import annotations

import functools
import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from agents.apps.agent.schemas import AgentState
from agents.apps.agent.services.graph import build_agent_graph
from agents.apps.agent.services.nodes.critic import critic_node
from agents.apps.agent.services.nodes.executor import executor_node
from agents.apps.agent.services.nodes.memory_writer import memory_writer_node
from agents.apps.agent.services.nodes.planner import planner_node
from agents.apps.agent.services.nodes.router import route_node
from agents.apps.agent.services.tool_registry import ToolMeta
from langchain_core.messages import AIMessage
from langchain_core.tools import StructuredTool
from langgraph.types import Command
from pydantic import BaseModel

from tests.apps.agent.factories import make_state


class _CreatePageArgs(BaseModel):
    title: str


async def _create_page(title: str) -> str:
    return f'created page: {title}'


_CREATE_PAGE_TOOL = StructuredTool.from_function(
    coroutine=_create_page,
    name='anynote__createPage',
    description='Create a new page',
    args_schema=_CreatePageArgs,
)

_TOOL_REGISTRY: dict[str, ToolMeta] = {
    'anynote__createPage': ToolMeta(
        name='anynote__createPage',
        required_scope='pages:write',
        requires_confirmation=True,
        summarize=lambda args: f'Создать страницу «{args.get("title")}»',
        preview=lambda args: {'title': args.get('title')},
    ),
}


def _llm_complex_then_tool_then_done():
    """LLM sequence: router(complex) → planner(plan) → executor(tool call) → (after resume) executor(done) → critic(approve)."""
    seq = iter([
        AIMessage(content=json.dumps({'kind': 'complex', 'reason': 'create something'})),
        AIMessage(content=json.dumps({'plan': [{'id': '1', 'title': 'Create the page'}]})),
        # executor first call: emit a tool_call (triggers interrupt)
        AIMessage(
            content='',
            tool_calls=[{
                'name': 'anynote__createPage',
                'args': {'title': 'Test Page'},
                'id': 'tc1',
            }],
        ),
        # executor after resume: plain text answer
        AIMessage(content='Page created successfully'),
        # critic: approve
        AIMessage(content=json.dumps({'verdict': 'approve', 'feedback': 'ok'})),
    ])
    llm = MagicMock()
    llm.bind_tools = lambda tools: llm
    llm.ainvoke = AsyncMock(side_effect=lambda m: next(seq))
    return llm


@pytest.mark.integration
@pytest.mark.asyncio
async def test_confirmation_pause_then_resume_allow(pg_saver) -> None:
    """Interrupt on a confirmation-gated tool call, then resume with allow."""
    llm = _llm_complex_then_tool_then_done()

    renderer = MagicMock()
    renderer.render_router = lambda **kw: 'router-prompt'
    renderer.render_planner = lambda **kw: 'planner-prompt'
    renderer.render_executor = lambda **kw: 'executor-prompt'
    renderer.render_critic = lambda **kw: 'critic-prompt'

    memory_client = AsyncMock()
    memory_client.write_batch = AsyncMock(return_value=None)

    graph = build_agent_graph(
        checkpointer=pg_saver,
        router_node=functools.partial(route_node, llm=llm, renderer=renderer),
        planner_node=functools.partial(planner_node, llm=llm, renderer=renderer),
        executor_node=functools.partial(
            executor_node,
            llm=llm,
            tools=[_CREATE_PAGE_TOOL],
            tool_registry=_TOOL_REGISTRY,
            renderer=renderer,
        ),
        critic_node=functools.partial(critic_node, llm=llm, renderer=renderer),
        memory_writer_node=functools.partial(
            memory_writer_node, memory_client=memory_client, jwt='test-jwt',
        ),
    )

    state = make_state(user_message='create a page')
    cfg = {'configurable': {'thread_id': str(state.context.chat_id)}}

    # First invocation — should interrupt on confirmation.
    await graph.ainvoke(state, cfg)
    # AsyncPostgresSaver requires the async interface; get_state is sync-only for
    # in-thread use, so we use aget_state here.
    snapshot = await graph.aget_state(cfg)
    interrupts = getattr(snapshot, 'interrupts', [])
    assert interrupts, 'expected a pending confirmation interrupt'

    # Resume with allow — graph should complete.
    out2 = await graph.ainvoke(Command(resume={'action': 'allow'}), cfg)
    final = AgentState.model_validate(out2)
    assert final.final_answer != '', 'expected a non-empty final_answer after resume'
