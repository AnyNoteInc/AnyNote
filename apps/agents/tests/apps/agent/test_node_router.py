import json
from unittest.mock import AsyncMock

import pytest
from agents.apps.agent.enums import RoutingKind
from agents.apps.agent.services.nodes.router import route_node
from langchain_core.messages import AIMessage

from tests.apps.agent.factories import make_state


@pytest.mark.asyncio
async def test_router_returns_complex_when_llm_says_complex() -> None:
    fake_llm = AsyncMock()
    fake_llm.ainvoke = AsyncMock(return_value=AIMessage(
        content=json.dumps({'kind': 'complex', 'reason': 'multi step'}),
    ))
    state = make_state(user_message='Найди и собери summary всех встреч')
    out = await route_node(state, llm=fake_llm)
    assert out.routing_kind == RoutingKind.COMPLEX


@pytest.mark.asyncio
async def test_router_returns_trivial_for_lookup() -> None:
    fake_llm = AsyncMock()
    fake_llm.ainvoke = AsyncMock(return_value=AIMessage(
        content=json.dumps({'kind': 'trivial', 'reason': 'pure lookup'}),
    ))
    state = make_state(user_message='Какой id страницы X?')
    out = await route_node(state, llm=fake_llm)
    assert out.routing_kind == RoutingKind.TRIVIAL
    # trivial path also seeds a single-step plan
    assert len(out.plan) == 1


@pytest.mark.asyncio
async def test_router_trivial_points_current_step_at_seeded_step() -> None:
    """Trivial routing skips the planner, so the router itself must point
    current_step_id at the single step it seeds. Otherwise the executor sees
    current_step_id=None, returns early without calling the LLM, and the turn
    yields an empty plan stub with no answer (every follow-up turn breaks)."""
    fake_llm = AsyncMock()
    fake_llm.ainvoke = AsyncMock(return_value=AIMessage(
        content=json.dumps({'kind': 'trivial', 'reason': 'pure lookup'}),
    ))
    state = make_state(user_message='Суммаризируй это в 3 предложениях')
    out = await route_node(state, llm=fake_llm)
    assert out.routing_kind == RoutingKind.TRIVIAL
    assert len(out.plan) == 1
    assert out.current_step_id == out.plan[0].id


@pytest.mark.asyncio
async def test_router_falls_back_to_complex_on_bad_json() -> None:
    fake_llm = AsyncMock()
    fake_llm.ainvoke = AsyncMock(return_value=AIMessage(content='not json'))
    state = make_state(user_message='X')
    out = await route_node(state, llm=fake_llm)
    assert out.routing_kind == RoutingKind.COMPLEX
