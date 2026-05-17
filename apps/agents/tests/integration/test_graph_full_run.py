"""Integration test: full graph run end-to-end through Postgres checkpointer."""

from __future__ import annotations

import functools
import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage

from agents.apps.agent.services.graph import build_agent_graph
from agents.apps.agent.services.nodes.critic import critic_node
from agents.apps.agent.services.nodes.executor import executor_node
from agents.apps.agent.services.nodes.memory_writer import memory_writer_node
from agents.apps.agent.services.nodes.planner import planner_node
from agents.apps.agent.services.nodes.router import route_node
from agents.apps.agent.schemas import AgentState
from tests.apps.agent.factories import make_state


def _fake_llm(outputs: list[str]):
    seq = iter(outputs)
    llm = MagicMock()
    llm.bind_tools = lambda tools: llm

    async def _ainvoke(messages):
        return AIMessage(content=next(seq))

    llm.ainvoke = AsyncMock(side_effect=_ainvoke)
    return llm


@pytest.mark.integration
@pytest.mark.asyncio
async def test_full_run_router_planner_executor_critic_memory(pg_saver):
    """End-to-end through real Postgres checkpointer.

    Uses COMPLEX routing so the planner runs and sets current_step_id; trivial
    routing skips the planner and leaves current_step_id=None which causes the
    executor to return early without calling the LLM.
    """
    outputs = [
        json.dumps({'kind': 'complex', 'reason': 'lookup'}),  # router → complex
        json.dumps({'plan': [{'id': '1', 'title': 'Найти id страницы X'}]}),  # planner
        'найдено: 42',  # executor
        json.dumps({'verdict': 'approve', 'feedback': 'ok'}),  # critic
    ]
    llm = _fake_llm(outputs)

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
            executor_node, llm=llm, tools=[], tool_registry={}, renderer=renderer,
        ),
        critic_node=functools.partial(critic_node, llm=llm, renderer=renderer),
        memory_writer_node=functools.partial(
            memory_writer_node, memory_client=memory_client, jwt='test-jwt',
        ),
    )

    state = make_state(user_message='Какой id страницы X?')
    # Pass the AgentState instance directly — LangGraph channels use Python field
    # names (e.g. model_config_), not Pydantic aliases (e.g. model), so passing
    # a dict with by_alias=True would drop the model field from the channel map.
    cfg = {'configurable': {'thread_id': str(state.context.chat_id)}}

    out = await graph.ainvoke(state, cfg)
    final = AgentState.model_validate(out)
    assert final.final_answer == 'найдено: 42'
    assert final.critic_verdict is not None
    assert final.critic_verdict.value == 'approve'
