import json
from unittest.mock import AsyncMock

import pytest
from langchain_core.messages import AIMessage

from agents.apps.agent.enums import RoutingKind
from agents.apps.agent.services.nodes.router import route_node
from tests.apps.agent.factories import make_state


@pytest.mark.asyncio
async def test_router_returns_complex_when_llm_says_complex():
    fake_llm = AsyncMock()
    fake_llm.ainvoke = AsyncMock(return_value=AIMessage(
        content=json.dumps({'kind': 'complex', 'reason': 'multi step'}),
    ))
    state = make_state(user_message='Найди и собери summary всех встреч')
    out = await route_node(state, llm=fake_llm)
    assert out.routing_kind == RoutingKind.COMPLEX


@pytest.mark.asyncio
async def test_router_returns_trivial_for_lookup():
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
async def test_router_falls_back_to_complex_on_bad_json():
    fake_llm = AsyncMock()
    fake_llm.ainvoke = AsyncMock(return_value=AIMessage(content='not json'))
    state = make_state(user_message='X')
    out = await route_node(state, llm=fake_llm)
    assert out.routing_kind == RoutingKind.COMPLEX
